/**
 * Agentic - Main Entry Point
 * Express server with API routes for task management and agent coordination
 */

import cors from 'cors';
import 'dotenv/config';
import express from 'express';
import { join } from 'path';
import swaggerUi from 'swagger-ui-express';
import { preWarmClaude } from './claude-runner';
import { setOrchestrator } from './controllers/orchestration.controller';
import { RegisterRoutes } from './generated/routes';
import { AgentOrchestrator } from './orchestrator';
import { slackService } from './slack';
import { taskDb } from './taskdb';

const app = express();
const PORT = process.env.PORT || 3000;

// Basic Auth credentials from environment
const AUTH_USER = process.env.AUTH_USER || 'admin';
const AUTH_PASS = process.env.AUTH_PASS || '';

// Basic Auth middleware
function basicAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  // Skip auth if no password is set
  if (!AUTH_PASS) {
    return next();
  }

  // Skip auth for Slack webhooks (they use their own verification)
  if (req.path === '/api/slack/events') {
    return next();
  }

  // Skip auth for health check
  if (req.path === '/health') {
    return next();
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.setHeader('WWW-Authenticate', 'Basic realm="Agentic Dashboard"');
    return res.status(401).send('Authentication required');
  }

  const base64Credentials = authHeader.split(' ')[1];
  const credentials = Buffer.from(base64Credentials, 'base64').toString('utf-8');
  const [username, password] = credentials.split(':');

  if (username === AUTH_USER && password === AUTH_PASS) {
    return next();
  }

  res.setHeader('WWW-Authenticate', 'Basic realm="Agentic Dashboard"');
  return res.status(401).send('Invalid credentials');
}

app.use(cors());
app.use(express.json());

// Apply basic auth before static files
app.use(basicAuth);
app.use(express.static(join(__dirname, '../public')));

// Initialize orchestrator
const orchestrator = new AgentOrchestrator({
  onNotification: async (message) => {
    console.log(`[Notification] ${message}`);
  },
});

setOrchestrator(orchestrator);

app.use('/api-docs', swaggerUi.serve, async (req: express.Request, res: express.Response) => {
  const swaggerSpec = (await import('../public/swagger.json')).default;
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  swaggerSpec.servers = [{ url: `${protocol}://${host}` }];
  return res.send(swaggerUi.generateHTML(swaggerSpec));
});

RegisterRoutes(app);

// Claude CLI setup - run setup-token from server and capture the token
let setupProcess: ReturnType<typeof import('child_process').spawn> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyProcess: any = null;  // node-pty IPty process
let setupOutput = '';
let setupToken = '';
let setupPort: number | null = null;
let setupStartTime: number | null = null;
let setupAuthUrl: string | null = null;  // Store the full auth URL when detected

// Keep browser session alive between browser-auth and browser-magic-link
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authBrowser: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authPage: any = null;

// Screenshot the auth page to see what we're working with (with stealth to bypass Cloudflare)
app.get('/api/claude-setup/screenshot-auth', async (req, res) => {
  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    const { spawn } = await import('child_process');
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');

    // Add stealth plugin to avoid Cloudflare detection
    puppeteerExtra.default.use(StealthPlugin.default());

    console.log('[Screenshot] Starting Claude setup-token to get auth URL...');

    // Start Claude setup-token process
    let authUrl: string | null = null;
    const proc = spawn('unbuffer', ['-p', 'claude', 'setup-token'], {
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'xterm-256color',
        DISPLAY: '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data) => {
      const chunk = data.toString();
      console.log('[Screenshot]', chunk.substring(0, 200));

      // Capture auth URL
      const urlMatch = chunk.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s\n]*state=[a-zA-Z0-9_-]+/);
      if (urlMatch && !authUrl) {
        authUrl = urlMatch[0];
        console.log('[Screenshot] Auth URL captured');
      }
    });

    // Wait for auth URL to appear
    let attempts = 0;
    while (!authUrl && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!authUrl) {
      proc.kill();
      return res.status(500).json({ error: 'Failed to get auth URL from CLI' });
    }

    console.log('[Screenshot] Launching stealth browser...');

    // Launch Puppeteer with stealth plugin
    const browser = await puppeteerExtra.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    // Set a realistic user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to auth URL
    console.log('[Screenshot] Navigating to auth URL...');
    await page.goto(authUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for Cloudflare challenge to complete (up to 30 seconds)
    console.log('[Screenshot] Waiting for Cloudflare challenge...');
    let cfAttempts = 0;
    while (cfAttempts < 30) {
      const title = await page.title();
      if (!title.includes('moment') && !title.includes('Cloudflare')) {
        console.log('[Screenshot] Cloudflare challenge passed!');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      cfAttempts++;
    }

    // Wait a bit more for page to fully load
    await new Promise(resolve => setTimeout(resolve, 3000));

    const currentUrl = page.url();
    const pageTitle = await page.title();
    console.log('[Screenshot] Current URL:', currentUrl);
    console.log('[Screenshot] Page title:', pageTitle);

    // Take screenshot
    const screenshot = await page.screenshot({ encoding: 'base64' });

    // Get page HTML for debugging
    const pageHtml = await page.content();

    // Find all input elements on the page
    const inputs = await page.$$eval('input', (els) =>
      els.map(el => ({
        type: el.getAttribute('type'),
        name: el.getAttribute('name'),
        id: el.getAttribute('id'),
        placeholder: el.getAttribute('placeholder'),
        className: el.className,
      }))
    );

    // Find all buttons
    const buttons = await page.$$eval('button', (els) =>
      els.map(el => ({
        type: el.getAttribute('type'),
        text: el.textContent?.trim(),
        className: el.className,
      }))
    );

    await browser.close();
    proc.kill();

    // Save screenshot to public directory so it can be viewed
    const screenshotPath = join(__dirname, '../public/auth-screenshot.png');
    writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));

    res.json({
      status: 'Screenshot captured',
      pageTitle,
      currentUrl,
      screenshotUrl: '/auth-screenshot.png',
      inputs,
      buttons,
      htmlPreview: pageHtml.substring(0, 3000),
    });
  } catch (error) {
    console.error('[Screenshot] Error:', error);
    res.status(500).json({ error: 'Screenshot failed', details: String(error) });
  }
});

// Puppeteer-based OAuth flow - runs entirely from server's IP (with stealth to bypass Cloudflare)
app.post('/api/claude-setup/browser-auth', express.json(), async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const puppeteerExtra = await import('puppeteer-extra');
    const StealthPlugin = await import('puppeteer-extra-plugin-stealth');
    const { spawn } = await import('child_process');
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');

    // Add stealth plugin to avoid Cloudflare detection
    puppeteerExtra.default.use(StealthPlugin.default());

    // Kill any existing setup process
    if (setupProcess) {
      setupProcess.kill();
      setupProcess = null;
    }

    setupOutput = '';
    setupToken = '';
    setupAuthUrl = null;

    // Start Claude setup-token with node-pty for proper PTY support
    const pty = await import('node-pty');
    ptyProcess = pty.spawn('claude', ['setup-token'], {
      name: 'xterm-256color',
      cols: 200,
      rows: 30,
      cwd: process.cwd(),
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'xterm-256color',
        DISPLAY: '',
      } as { [key: string]: string },
    });

    // Also set setupProcess for compatibility checks
    setupProcess = { stdin: { write: (data: string) => ptyProcess?.write(data) } } as unknown as ReturnType<typeof import('child_process').spawn>;

    ptyProcess.onData((data: string) => {
      setupOutput += data;
      console.log('[BrowserAuth]', data.substring(0, 200));

      // Capture auth URL
      const urlMatch = data.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s\n]*state=[a-zA-Z0-9_-]+/);
      if (urlMatch && !setupAuthUrl) {
        setupAuthUrl = urlMatch[0];
        console.log('[BrowserAuth] Auth URL captured');
      }

      // Capture token
      const tokenMatch = data.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        setupToken = tokenMatch[0];
        console.log('[BrowserAuth] Token captured!');
      }
    });

    // node-pty combines stdout and stderr, no need for separate handler

    // Wait for auth URL to appear
    let attempts = 0;
    while (!setupAuthUrl && attempts < 30) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!setupAuthUrl) {
      return res.status(500).json({ error: 'Failed to get auth URL from CLI' });
    }

    // Store in local variable for type safety (TypeScript needs explicit assertion here)
    const authUrl: string = setupAuthUrl as string;

    // Find localhost callback port in the auth URL
    const portMatch = authUrl.match(/localhost%3A(\d+)/);
    const callbackPort = portMatch ? parseInt(portMatch[1]) : null;

    console.log('[BrowserAuth] Starting stealth browser with auth URL');
    console.log('[BrowserAuth] Callback port:', callbackPort);

    // Launch Puppeteer with stealth plugin to handle OAuth from server's IP
    const browser = await puppeteerExtra.default.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-blink-features=AutomationControlled',
        '--window-size=1280,800',
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Navigate to auth URL
    console.log('[BrowserAuth] Navigating to auth URL...');
    await page.goto(authUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for Cloudflare challenge to complete (up to 30 seconds)
    console.log('[BrowserAuth] Waiting for Cloudflare challenge...');
    let cfAttempts = 0;
    while (cfAttempts < 30) {
      const title = await page.title();
      if (!title.includes('moment') && !title.includes('Cloudflare')) {
        console.log('[BrowserAuth] Cloudflare challenge passed!');
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      cfAttempts++;
    }

    // Wait a bit more for page to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));

    const pageUrl = page.url();
    const pageTitle = await page.title();
    console.log('[BrowserAuth] Current URL:', pageUrl);
    console.log('[BrowserAuth] Page title:', pageTitle);

    // Take screenshot for debugging
    const screenshot = await page.screenshot({ encoding: 'base64' });

    // Look for email input and enter it
    try {
      // First, try to accept cookies if the banner is present
      try {
        const acceptButton = await page.$('button:has-text("Accept All Cookies")');
        if (acceptButton) {
          console.log('[BrowserAuth] Clicking accept cookies...');
          await acceptButton.click();
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      } catch {
        // Cookie banner not present or already dismissed
      }

      // Wait for email input (using the correct selector we discovered)
      console.log('[BrowserAuth] Waiting for email input...');
      await page.waitForSelector('#email', { timeout: 15000 });

      // Type email
      console.log('[BrowserAuth] Typing email:', email);
      await page.type('#email', email, { delay: 50 });

      // Click submit button
      console.log('[BrowserAuth] Clicking submit button...');
      await page.click('button[type="submit"]');

      // Wait for response
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Take another screenshot after submission
      const afterScreenshot = await page.screenshot({ encoding: 'base64' });

      // Save screenshots to public directory
      const screenshotPath = join(__dirname, '../public/auth-before.png');
      const afterPath = join(__dirname, '../public/auth-after.png');
      writeFileSync(screenshotPath, Buffer.from(screenshot, 'base64'));
      writeFileSync(afterPath, Buffer.from(afterScreenshot, 'base64'));

      // Get page content to see response
      const pageContent = await page.content();

      // Check if we're now on a "check your email" page
      const bodyText = await page.evaluate(() => document.body.innerText);

      // KEEP browser session alive for browser-magic-link to reuse
      // Close any previous session first
      if (authBrowser && authBrowser !== browser) {
        try { await authBrowser.close(); } catch {}
      }
      authBrowser = browser;
      authPage = page;
      console.log('[BrowserAuth] Keeping browser session alive for magic link step');

      res.json({
        status: 'Email submitted',
        message: 'Check your email for a magic link. Forward the magic link URL to the next endpoint.',
        pageTitle: await page.title().catch(() => 'unknown'),
        currentUrl: pageUrl,
        bodyPreview: bodyText.substring(0, 500),
        screenshotBefore: '/auth-before.png',
        screenshotAfter: '/auth-after.png',
        nextStep: 'POST /api/claude-setup/browser-magic-link with { "magicLink": "https://..." }',
        callbackPort,
        browserSessionKept: true,
      });
    } catch (e) {
      // Save error screenshot
      const errorPath = join(__dirname, '../public/auth-error.png');
      writeFileSync(errorPath, Buffer.from(screenshot, 'base64'));

      await browser.close();
      res.status(500).json({
        error: 'Failed to interact with login page',
        details: String(e),
        pageUrl,
        pageTitle,
        screenshotUrl: '/auth-error.png',
      });
    }
  } catch (error) {
    console.error('[BrowserAuth] Error:', error);
    res.status(500).json({ error: 'Browser auth failed', details: String(error) });
  }
});

// Continue OAuth flow with magic link - uses the SAME browser session from browser-auth
app.post('/api/claude-setup/browser-magic-link', express.json(), async (req, res) => {
  const { magicLink } = req.body;

  if (!magicLink) {
    return res.status(400).json({ error: 'Magic link URL is required' });
  }

  if (!setupProcess || !setupAuthUrl) {
    return res.status(400).json({
      error: 'No setup process running',
      hint: 'Start with POST /api/claude-setup/browser-auth first',
    });
  }

  if (!authBrowser || !authPage) {
    return res.status(400).json({
      error: 'No browser session found',
      hint: 'Browser session from browser-auth was closed or not started. Restart with POST /api/claude-setup/browser-auth first.',
    });
  }

  try {
    const { writeFileSync } = await import('fs');
    const { join } = await import('path');

    console.log('[BrowserAuth] Using existing browser session to complete OAuth...');

    // Step 1: Open magic link in a NEW TAB in the same browser
    const magicPage = await authBrowser.newPage();
    await magicPage.setViewport({ width: 1280, height: 800 });
    await magicPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    console.log('[BrowserAuth] Opening magic link in new tab...');
    await magicPage.goto(magicLink, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for Cloudflare challenge to complete
    let cfAttempts = 0;
    while (cfAttempts < 30) {
      const title = await magicPage.title();
      if (!title.includes('moment') && !title.includes('Cloudflare')) {
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
      cfAttempts++;
    }

    await new Promise(resolve => setTimeout(resolve, 3000));

    // Take screenshot of magic link page
    const magicScreenshot = await magicPage.screenshot({ encoding: 'base64' });
    writeFileSync(join(__dirname, '../public/magic-link-result.png'), Buffer.from(magicScreenshot, 'base64'));

    // Check what page we're on - could be verification code OR OAuth consent page
    const pageText = await magicPage.evaluate(() => document.body.innerText);
    console.log('[BrowserAuth] Magic link page text:', pageText.substring(0, 300));

    // Check if we're on the OAuth consent page (means we're already logged in from same browser)
    if (pageText.includes('Authorize') && pageText.includes('would like to connect')) {
      console.log('[BrowserAuth] On OAuth consent page - clicking Authorize...');

      // Click the Authorize button
      await magicPage.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        const authBtn = buttons.find(btn => btn.textContent?.includes('Authorize'));
        if (authBtn) authBtn.click();
      });

      // Wait for redirect to callback - shorter wait since page load is quick
      await new Promise(resolve => setTimeout(resolve, 10000));

      const finalUrl = magicPage.url();
      console.log('[BrowserAuth] Final URL after authorize:', finalUrl);

      // Take screenshot
      const finalScreenshot = await magicPage.screenshot({ encoding: 'base64' });
      writeFileSync(join(__dirname, '../public/auth-final.png'), Buffer.from(finalScreenshot, 'base64'));

      // Check if we're on the callback page
      if (finalUrl.includes('console.anthropic.com') && finalUrl.includes('callback')) {
        console.log('[BrowserAuth] On callback page, extracting auth code...');

        const callbackText = await magicPage.evaluate(() => document.body.innerText);
        console.log('[BrowserAuth] Callback page text:', callbackText.substring(0, 500));

        // Extract the auth code in format: code#state (both are long alphanumeric strings)
        const authCodeMatch = callbackText.match(/([A-Za-z0-9_-]{40,}#[A-Za-z0-9_-]{40,})/);
        if (authCodeMatch) {
          const authCode = authCodeMatch[1];
          console.log('[BrowserAuth] Found auth code (code#state):', authCode.substring(0, 30) + '...');

          // Feed the auth code to the CLI
          if (setupProcess && setupProcess.stdin) {
            // Wait for the CLI to be ready for input (look for "Paste code" in output)
            let waitAttempts = 0;
            while (!setupOutput.includes('Paste code') && waitAttempts < 20) {
              await new Promise(resolve => setTimeout(resolve, 500));
              waitAttempts++;
            }
            console.log('[BrowserAuth] CLI ready after', waitAttempts, 'attempts');
            console.log('[BrowserAuth] Sending auth code to CLI:', authCode);

            // Send code via PTY with carriage return
            if (ptyProcess) {
              ptyProcess.write(authCode + '\r');
            }

            // Wait for CLI to process - poll every 2 seconds for up to 10 min
            let tokenMatch = null;
            for (let i = 0; i < 300; i++) {  // 300 * 2s = 10 min
              await new Promise(resolve => setTimeout(resolve, 2000));
              tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
              if (tokenMatch) {
                console.log('[BrowserAuth] Token found after', (i + 1) * 2, 'seconds');
                break;
              }
              // Also check if CLI finished (no longer waiting for input)
              if (setupOutput.includes('successfully') || setupOutput.includes('Token saved')) {
                console.log('[BrowserAuth] CLI completed after', (i + 1) * 2, 'seconds');
                break;
              }
            }

            // Final check for token
            if (tokenMatch) {
              setupToken = tokenMatch[0];
              process.env.CLAUDE_CODE_OAUTH_TOKEN = setupToken;

              // Close browsers and clean up
              await magicPage.close();
              await authBrowser.close();
              authBrowser = null;
              authPage = null;

              return res.json({
                status: 'success',
                token: setupToken,
                message: 'Token captured! OAuth complete via consent page.',
                hint: 'Test with POST /api/run-agent',
              });
            }
          }
        }
      }

      // Close magic page
      await magicPage.close();

      // Check for token one more time
      const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        setupToken = tokenMatch[0];
        process.env.CLAUDE_CODE_OAUTH_TOKEN = setupToken;

        await authBrowser.close();
        authBrowser = null;
        authPage = null;

        return res.json({
          status: 'success',
          token: setupToken,
          message: 'Token captured!',
          hint: 'Test with POST /api/run-agent',
        });
      }

      return res.json({
        status: 'pending',
        finalUrl,
        screenshotUrl: '/auth-final.png',
        message: 'Clicked Authorize but no token captured. Check screenshots.',
        setupOutput: setupOutput.slice(-500),
      });
    }

    // Otherwise, extract the verification code (6-digit number) for the old flow
    const verificationCodeMatch = pageText.match(/(\d{6})/);
    if (!verificationCodeMatch) {
      await magicPage.close();
      return res.status(500).json({
        error: 'Could not find verification code or Authorize button on magic link page',
        screenshotUrl: '/magic-link-result.png',
        pageText: pageText.substring(0, 500),
      });
    }

    const verificationCode = verificationCodeMatch[1];
    console.log('[BrowserAuth] Found verification code:', verificationCode);

    // Close magic link tab
    await magicPage.close();

    // Step 2: Go back to the original page (authPage) which is already on "waiting for magic link"
    console.log('[BrowserAuth] Switching back to original auth page...');

    // Take screenshot of current state
    let currentScreenshot = await authPage.screenshot({ encoding: 'base64' });
    writeFileSync(join(__dirname, '../public/auth-before-verify.png'), Buffer.from(currentScreenshot, 'base64'));

    // Step 3: Click on "Enter verification code" link on the SAME page
    console.log('[BrowserAuth] Looking for verification code option...');
    try {
      // Try clicking by text content - look for "verification code" text
      await authPage.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a, button, span'));
        const verifyLink = links.find(el => el.textContent?.toLowerCase().includes('verification code'));
        if (verifyLink) (verifyLink as HTMLElement).click();
      });
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (e) {
      console.log('[BrowserAuth] Could not find verification code link:', e);
    }

    // Take screenshot after clicking verification link
    const afterClickScreenshot = await authPage.screenshot({ encoding: 'base64' });
    writeFileSync(join(__dirname, '../public/auth-verify-page.png'), Buffer.from(afterClickScreenshot, 'base64'));

    // Step 4: Enter verification code
    console.log('[BrowserAuth] Entering verification code:', verificationCode);
    try {
      // Wait for input field - could be multiple individual digit inputs or one text input
      await authPage.waitForSelector('input', { timeout: 10000 });

      // Check if there are multiple digit inputs (common for verification codes)
      const inputs = await authPage.$$('input');
      console.log('[BrowserAuth] Found', inputs.length, 'input fields');

      if (inputs.length >= 6) {
        // Multiple single-digit inputs - type one digit in each
        console.log('[BrowserAuth] Entering code in individual digit inputs...');
        for (let i = 0; i < Math.min(6, inputs.length); i++) {
          await inputs[i].type(verificationCode[i], { delay: 50 });
        }
      } else {
        // Single input - type the whole code
        console.log('[BrowserAuth] Entering code in single input...');
        const codeInput = await authPage.$('input[type="text"], input[type="number"], input[inputmode="numeric"], input:not([type="email"])');
        if (codeInput) {
          await codeInput.type(verificationCode, { delay: 100 });
        }
      }

      // Click submit/continue button
      await new Promise(resolve => setTimeout(resolve, 1000));
      const submitBtn = await authPage.$('button[type="submit"]');
      if (submitBtn) {
        await submitBtn.click();
      } else {
        // Try any button that looks like continue
        await authPage.evaluate(() => {
          const buttons = Array.from(document.querySelectorAll('button'));
          const continueBtn = buttons.find(btn =>
            btn.textContent?.toLowerCase().includes('continue') ||
            btn.textContent?.toLowerCase().includes('verify') ||
            btn.textContent?.toLowerCase().includes('submit')
          );
          if (continueBtn) continueBtn.click();
        });
      }

      // Wait for redirect to callback
      console.log('[BrowserAuth] Waiting for redirect to callback...');
      await new Promise(resolve => setTimeout(resolve, 10000));

      const finalUrl = authPage.url();
      console.log('[BrowserAuth] Final URL:', finalUrl);

      // Take screenshot of final page
      const finalScreenshot = await authPage.screenshot({ encoding: 'base64' });
      writeFileSync(join(__dirname, '../public/auth-final.png'), Buffer.from(finalScreenshot, 'base64'));

      // Check if we're on the console callback page
      if (finalUrl.includes('console.anthropic.com') && finalUrl.includes('callback')) {
        console.log('[BrowserAuth] On callback page, extracting auth code...');

        const callbackText = await authPage.evaluate(() => document.body.innerText);
        console.log('[BrowserAuth] Callback page text:', callbackText.substring(0, 500));

        // Extract the auth code in format: code#state (both are long alphanumeric strings)
        const authCodeMatch = callbackText.match(/([A-Za-z0-9_-]{40,}#[A-Za-z0-9_-]{40,})/);
        if (authCodeMatch) {
          const authCode = authCodeMatch[1];
          console.log('[BrowserAuth] Found auth code (code#state):', authCode.substring(0, 30) + '...');

          // Feed the auth code to the CLI
          if (setupProcess && setupProcess.stdin) {
            // Wait for the CLI to be ready for input (look for "Paste code" in output)
            let waitAttempts = 0;
            while (!setupOutput.includes('Paste code') && waitAttempts < 20) {
              await new Promise(resolve => setTimeout(resolve, 500));
              waitAttempts++;
            }
            console.log('[BrowserAuth] CLI ready after', waitAttempts, 'attempts');
            console.log('[BrowserAuth] Sending auth code to CLI:', authCode);

            // Send code via PTY with carriage return
            if (ptyProcess) {
              ptyProcess.write(authCode + '\r');
            }

            // Wait for CLI to process - poll every 2 seconds for up to 10 min
            let tokenMatch = null;
            for (let i = 0; i < 300; i++) {  // 300 * 2s = 10 min
              await new Promise(resolve => setTimeout(resolve, 2000));
              tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
              if (tokenMatch) {
                console.log('[BrowserAuth] Token found after', (i + 1) * 2, 'seconds');
                break;
              }
              // Also check if CLI finished (no longer waiting for input)
              if (setupOutput.includes('successfully') || setupOutput.includes('Token saved')) {
                console.log('[BrowserAuth] CLI completed after', (i + 1) * 2, 'seconds');
                break;
              }
            }

            // Final check for token
            if (tokenMatch) {
              setupToken = tokenMatch[0];
              process.env.CLAUDE_CODE_OAUTH_TOKEN = setupToken;

              // Close browser and clean up
              await authBrowser.close();
              authBrowser = null;
              authPage = null;

              return res.json({
                status: 'success',
                token: setupToken,
                message: 'Token captured! OAuth complete.',
                hint: 'Test with POST /api/run-agent',
              });
            }
          }
        }
      }

      // Close browser
      await authBrowser.close();
      authBrowser = null;
      authPage = null;

      // Check for token one more time
      const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        setupToken = tokenMatch[0];
        process.env.CLAUDE_CODE_OAUTH_TOKEN = setupToken;

        return res.json({
          status: 'success',
          token: setupToken,
          message: 'Token captured!',
          hint: 'Test with POST /api/run-agent',
        });
      }

      res.json({
        status: 'pending',
        verificationCode,
        finalUrl,
        screenshotUrl: '/auth-final.png',
        message: 'Verification code entered. Check screenshots for status.',
        setupOutput: setupOutput.slice(-500),
      });

    } catch (e) {
      // Close browser on error
      if (authBrowser) {
        await authBrowser.close();
        authBrowser = null;
        authPage = null;
      }
      res.status(500).json({
        error: 'Failed to enter verification code',
        details: String(e),
        verificationCode,
        screenshotUrl: '/auth-verify-page.png',
      });
    }
  } catch (error) {
    console.error('[BrowserAuth] Magic link error:', error);
    res.status(500).json({ error: 'Failed to open magic link', details: String(error) });
  }
});

app.get('/api/claude-setup/start', async (req, res) => {
  const { spawn } = await import('child_process');
  const { writeFileSync, chmodSync } = await import('fs');

  if (setupProcess) {
    setupProcess.kill();
  }

  setupOutput = '';
  setupToken = '';
  setupPort = null;
  setupStartTime = Date.now();
  setupAuthUrl = null;

  // Create a fake browser script that captures the URL and extracts the port
  const browserScript = '/tmp/capture-url.sh';
  writeFileSync(browserScript, '#!/bin/bash\necho "BROWSER_URL: $1"\necho "$1" >> /tmp/claude-auth-url.txt');
  chmodSync(browserScript, '755');

  // Clear previous URL
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync('/tmp/claude-auth-url.txt');
  } catch {}

  // Run claude setup-token with unbuffer for PTY handling
  setupProcess = spawn('unbuffer', ['-p', 'claude', 'setup-token'], {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'dumb',  // Use dumb terminal to avoid escape sequences
      BROWSER: browserScript,
      DISPLAY: '',  // Disable X11
      COLUMNS: '200',  // Wide terminal to avoid line wrapping
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  setupProcess.stdout?.on('data', (data) => {
    const chunk = data.toString();
    setupOutput += chunk;
    console.log('[Setup]', chunk.substring(0, 200));

    // Extract port from localhost URL
    const portMatch = chunk.match(/localhost:(\d+)/);
    if (portMatch) {
      setupPort = parseInt(portMatch[1]);
      console.log('[Setup] Detected callback port:', setupPort);
    }

    // Try to capture the full auth URL (look in accumulated output for complete URL)
    // The URL ends with state=...
    if (!setupAuthUrl) {
      const urlMatch = setupOutput.match(
        /https:\/\/claude\.ai\/oauth\/authorize\?[^\s\n]*state=[a-zA-Z0-9_-]+/
      );
      if (urlMatch) {
        setupAuthUrl = urlMatch[0];
        console.log('[Setup] Auth URL captured:', setupAuthUrl.substring(0, 100) + '...');
      }
    }

    // Try to capture the token from output
    const tokenMatch = chunk.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
    if (tokenMatch) {
      setupToken = tokenMatch[0];
      console.log('[Setup] Token captured!');
    }
  });

  setupProcess.stderr?.on('data', (data) => {
    setupOutput += data.toString();
  });

  setupProcess.on('close', (code) => {
    console.log('[Setup] Process exited with code', code);
    setupProcess = null;
    setupPort = null;
  });

  // Wait longer for the full auth URL to appear
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Extract auth URL - look for the console.anthropic.com fallback URL first
  // which doesn't require localhost callback
  const consoleUrlMatch = setupOutput.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^`\n]*/);
  const urlMatch = consoleUrlMatch || setupOutput.match(/https:\/\/claude\.ai\/oauth[^\s\]\u001b]+/);
  const portMatch = setupOutput.match(/localhost:(\d+)/);

  if (portMatch) {
    setupPort = parseInt(portMatch[1]);
  }

  const serverHost = req.headers.host || 'ai-team-production.up.railway.app';

  // Check if we have the console callback URL (preferred - no localhost needed)
  const hasConsoleCallback = urlMatch && urlMatch[0].includes('console.anthropic.com');

  res.json({
    status: 'started',
    authUrl: urlMatch ? urlMatch[0] : null,
    callbackPort: setupPort,
    serverCallback: `https://${serverHost}/api/claude-setup/callback`,
    processRunning: !!setupProcess,
    instructions: hasConsoleCallback
      ? [
          '1. Open the authUrl in your browser',
          '2. Authenticate with Claude',
          '3. You will see a code on console.anthropic.com',
          '4. Copy that code',
          `5. POST to ${serverHost}/api/claude-setup/send-code with {"code": "YOUR_CODE"}`,
          '6. Check /api/claude-setup/status for the token',
        ]
      : [
          '1. Open the authUrl in your browser',
          '2. Authenticate with Claude',
          '3. When redirected to localhost (page won\'t load), copy the FULL URL from browser',
          `4. Replace "localhost:${setupPort || 'XXXXX'}" with "${serverHost}/api/claude-setup"`,
          '5. Visit that modified URL - it will forward to the server',
          '6. Check /api/claude-setup/status for the token',
        ],
    output: setupOutput.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').substring(0, 1200),
  });
});

app.get('/api/claude-setup/status', async (req, res) => {
  const { readFileSync, existsSync } = await import('fs');

  // Try to read captured URL from file (browser script writes here)
  let capturedUrl = null;
  try {
    if (existsSync('/tmp/claude-auth-url.txt')) {
      const content = readFileSync('/tmp/claude-auth-url.txt', 'utf-8');
      // The URL might be on its own line
      const lines = content.split('\n').filter(l => l.startsWith('https://'));
      if (lines.length > 0) {
        capturedUrl = lines[lines.length - 1].trim();
      }
    }
  } catch {}

  // Find the full console.anthropic.com callback URL from setupOutput
  // The URL ends with the state parameter
  const consoleUrlMatch = setupOutput.match(
    /https:\/\/claude\.ai\/oauth\/authorize\?[^`\n]*redirect_uri=https%3A%2F%2Fconsole\.anthropic\.com[^`\n]*/
  );

  // Also look for any auth URL as fallback
  const anyAuthUrlMatch = setupOutput.match(/https:\/\/claude\.ai\/oauth\/authorize\?[^\s\n]+/);

  const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);

  // Prefer: stored URL > captured file > console URL > any auth URL
  const authUrl = setupAuthUrl || capturedUrl || (consoleUrlMatch ? consoleUrlMatch[0] : null) || (anyAuthUrlMatch ? anyAuthUrlMatch[0] : null);

  res.json({
    running: !!setupProcess,
    authUrl: authUrl,
    token: tokenMatch ? tokenMatch[0] : null,
    output: setupOutput.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').substring(0, 4000),
    instructions: tokenMatch
      ? 'Token captured! Update CLAUDE_CODE_OAUTH_TOKEN in Railway with this token.'
      : authUrl
        ? 'Open authUrl in your browser to authenticate, then check status again.'
        : 'Waiting for auth URL... Check status again in a few seconds.',
  });
});

app.post('/api/claude-setup/stop', (req, res) => {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
  setupProcess = null;
  // Reset all state
  setupOutput = '';
  setupToken = '';
  setupAuthUrl = null;
  if (authBrowser) {
    authBrowser.close().catch(() => {});
    authBrowser = null;
    authPage = null;
  }
  res.json({ status: 'stopped', message: 'CLI process and browser cleaned up' });
});

// Complete setup-token flow - send code to EXISTING CLI process, don't spawn new one
app.post('/api/claude-setup/complete-with-code', express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required (format: code#state)' });
  }

  const { readFileSync, existsSync } = await import('fs');
  const { homedir } = await import('os');
  const { join } = await import('path');

  // Use existing ptyProcess if available (from browser-auth)
  if (ptyProcess) {
    console.log('[Setup] Using existing PTY process, sending code:', code.substring(0, 30) + '...');

    // Send code to existing CLI via PTY
    ptyProcess.write(code + '\r');

    // Wait for token to appear
    let tokenFound = false;
    for (let i = 0; i < 60; i++) {  // 60 * 2s = 2 min
      await new Promise(resolve => setTimeout(resolve, 2000));

      const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);
      if (tokenMatch) {
        setupToken = tokenMatch[0];
        process.env.CLAUDE_CODE_OAUTH_TOKEN = setupToken;
        tokenFound = true;
        console.log('[Setup] Token found from existing CLI!');
        break;
      }

      if (setupOutput.includes('successfully') || setupOutput.includes('Token saved')) {
        console.log('[Setup] CLI completed successfully');
        break;
      }
    }

    // Check token file
    const tokenPath = join(homedir(), '.claude', '.oauth_token');
    let token: string | null = null;
    if (existsSync(tokenPath)) {
      token = readFileSync(tokenPath, 'utf-8').trim();
      process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    }

    return res.json({
      success: tokenFound || !!token,
      token: token || setupToken || null,
      tokenLoaded: !!(token || setupToken),
      message: tokenFound ? 'Token captured from existing CLI' : 'Code sent to existing CLI',
    });
  }

  // No existing process - return error (user should start browser-auth first)
  return res.status(400).json({
    error: 'No CLI process running. Start browser-auth first.',
    hint: 'POST /api/claude-setup/browser-auth with email to start the flow',
  });
});

// Use expect for proper interactive CLI handling
app.post('/api/claude-setup/expect-token', express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required (format: code#state)' });
  }

  const { spawn } = await import('child_process');
  const { writeFileSync, unlinkSync, readFileSync, existsSync } = await import('fs');
  const { homedir } = await import('os');
  const { join } = await import('path');

  // Create expect script that properly handles the interactive CLI
  const expectScript = `#!/usr/bin/expect -f
set timeout 120
log_user 1

# Start claude setup-token
spawn claude setup-token

# Wait for the prompt and send the code
expect {
    "Paste code here" {
        sleep 1
        send "${code}\\r"
        exp_continue
    }
    "paste code" {
        sleep 1
        send "${code}\\r"
        exp_continue
    }
    "Token saved" {
        puts "SUCCESS: Token saved"
    }
    "successfully" {
        puts "SUCCESS: Auth complete"
    }
    "error" {
        puts "ERROR: Auth failed"
    }
    timeout {
        puts "TIMEOUT: No response"
    }
    eof {
        puts "EOF: Process ended"
    }
}

# Wait a bit for file to be written
sleep 2
`;

  const expectPath = '/tmp/claude-expect-token.exp';
  writeFileSync(expectPath, expectScript);

  // Make it executable
  const { execSync } = await import('child_process');
  execSync(`chmod +x ${expectPath}`);

  console.log('[Expect] Running expect script with code:', code.substring(0, 30) + '...');

  try {
    const result = await new Promise<{success: boolean, output: string}>((resolve) => {
      let output = '';
      const proc = spawn('expect', ['-f', expectPath], {
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          HOME: homedir(),
        },
      });

      proc.stdout?.on('data', (data) => {
        const chunk = data.toString();
        output += chunk;
        console.log('[Expect]', chunk.substring(0, 300));
      });
      proc.stderr?.on('data', (data) => {
        output += data.toString();
      });

      proc.on('close', (exitCode) => {
        resolve({
          success: output.includes('SUCCESS') || exitCode === 0,
          output,
        });
      });

      setTimeout(() => {
        proc.kill();
        resolve({ success: false, output: output + '\nTIMEOUT' });
      }, 180000);  // 3 minute timeout
    });

    // Clean up
    try { unlinkSync(expectPath); } catch {}

    // Check if token file was created
    const tokenPath = join(homedir(), '.claude', '.oauth_token');
    let token: string | null = null;
    if (existsSync(tokenPath)) {
      token = readFileSync(tokenPath, 'utf-8').trim();
      if (token.startsWith('sk-ant-')) {
        process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
        console.log('[Expect] Token loaded into environment!');
      }
    }

    res.json({
      success: result.success || !!token,
      token: token ? token.substring(0, 30) + '...' : null,
      tokenLoaded: !!token,
      output: result.output.substring(0, 2000),
    });

  } catch (error) {
    res.status(500).json({ error: 'Failed to run expect script', details: String(error) });
  }
});

// OAuth callback forwarder - forwards the callback to Claude CLI's internal server
app.get('/api/claude-setup/callback', async (req, res) => {
  const queryString = new URL(req.url, `http://${req.headers.host}`).search;

  // Extract the port from the auth URL we captured (default 36755)
  let port = 36755;
  const authUrlMatch = setupOutput.match(/localhost:(\d+)/);
  if (authUrlMatch) {
    port = parseInt(authUrlMatch[1]);
  }

  console.log(`[Setup] Forwarding callback to localhost:${port}${queryString}`);

  try {
    // Forward the callback to Claude CLI's local server
    const response = await fetch(`http://localhost:${port}/callback${queryString}`);
    const text = await response.text();

    console.log('[Setup] Callback response:', text.substring(0, 200));

    res.send(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>✓ Authentication forwarded to Claude CLI</h1>
          <p>Check <code>/api/claude-setup/status</code> for the token.</p>
          <p><a href="/api/claude-setup/status">Check Status</a></p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('[Setup] Callback forward failed:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: system-ui; padding: 40px; text-align: center;">
          <h1>❌ Callback forward failed</h1>
          <p>Claude CLI might not be listening. Start setup first.</p>
          <pre>${error}</pre>
        </body>
      </html>
    `);
  }
});

// Manual token input - writes to Claude config and env
app.post('/api/claude-setup/set-token', express.json(), async (req, res) => {
  const { token } = req.body;

  if (!token || !token.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'Invalid token format. Must start with sk-ant-' });
  }

  const { writeFileSync, mkdirSync, existsSync } = await import('fs');
  const { homedir } = await import('os');
  const { join } = await import('path');

  // Store token in environment
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;

  // Also write to Claude's config directory
  const claudeDir = join(homedir(), '.claude');
  if (!existsSync(claudeDir)) {
    mkdirSync(claudeDir, { recursive: true });
  }

  // Write token to .oauth_token file (Claude CLI format)
  try {
    writeFileSync(join(claudeDir, '.oauth_token'), token);
    console.log('[Setup] Token written to ~/.claude/.oauth_token');
  } catch (e) {
    console.error('[Setup] Failed to write token file:', e);
  }

  res.json({
    status: 'Token set successfully',
    note: 'Token saved to env and ~/.claude/.oauth_token. Test with /api/run-agent',
    tokenPreview: token.substring(0, 20) + '...',
  });
});

// Load token from ~/.claude/.oauth_token file into environment
app.post('/api/claude-setup/load-token', async (req, res) => {
  const { readFileSync, existsSync } = await import('fs');
  const { homedir } = await import('os');
  const { join } = await import('path');

  const oauthTokenPath = join(homedir(), '.claude', '.oauth_token');

  if (!existsSync(oauthTokenPath)) {
    return res.status(404).json({
      error: 'No .oauth_token file found',
      path: oauthTokenPath,
      hint: 'Run browser-auth flow first to generate the token file',
    });
  }

  try {
    const token = readFileSync(oauthTokenPath, 'utf-8').trim();
    if (!token.startsWith('sk-ant-')) {
      return res.status(400).json({ error: 'Invalid token format in file' });
    }

    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    console.log('[Setup] Loaded token from file into environment');

    res.json({
      status: 'Token loaded successfully',
      tokenPreview: token.substring(0, 30) + '...',
      hint: 'Test with POST /api/run-agent',
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to read token file', details: String(e) });
  }
});

// Send code to CLI stdin - for console.anthropic.com callback flow
app.post('/api/claude-setup/send-code', express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!ptyProcess) {
    return res.status(400).json({
      error: 'No PTY process running',
      hint: 'Start the setup first with POST /api/claude-setup/browser-auth',
    });
  }

  console.log('[Setup] Sending code to PTY:', code.substring(0, 20) + '...');

  try {
    // Send the code via PTY
    ptyProcess.write(code + '\r');
    console.log('[Setup] Code sent to PTY');

    // Wait a moment for the CLI to process
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Check if token was captured
    const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);

    res.json({
      status: 'Code sent to CLI',
      token: tokenMatch ? tokenMatch[0] : null,
      processRunning: !!setupProcess,
      hint: tokenMatch
        ? 'Token captured! Setting it now...'
        : 'Check /api/claude-setup/status for the token',
    });

    // If token found, auto-set it
    if (tokenMatch) {
      process.env.CLAUDE_CODE_OAUTH_TOKEN = tokenMatch[0];
      console.log('[Setup] Auto-set token from captured output');
    }
  } catch (error) {
    console.error('[Setup] Failed to send code:', error);
    res.status(500).json({ error: 'Failed to send code to CLI', details: String(error) });
  }
});

// Debug endpoint to check Claude config directory
app.get('/api/claude-setup/debug', async (req, res) => {
  const { readdirSync, readFileSync, existsSync, statSync } = await import('fs');
  const { homedir } = await import('os');
  const { join } = await import('path');

  const claudeDir = join(homedir(), '.claude');
  const oauthTokenPath = join(claudeDir, '.oauth_token');

  // Try to read the .oauth_token file directly
  let oauthToken: string | null = null;
  try {
    if (existsSync(oauthTokenPath)) {
      oauthToken = readFileSync(oauthTokenPath, 'utf-8').trim();
    }
  } catch {}

  const result = {
    homeDir: homedir(),
    claudeDir,
    claudeDirExists: existsSync(claudeDir),
    oauthTokenFile: oauthToken ? oauthToken.substring(0, 40) + '...' : null,
    oauthTokenFileExists: existsSync(oauthTokenPath),
    files: [] as string[],
    tokenFiles: {} as Record<string, string>,
    envTokenPreview: process.env.CLAUDE_CODE_OAUTH_TOKEN
      ? process.env.CLAUDE_CODE_OAUTH_TOKEN.substring(0, 30) + '...'
      : null,
    error: null as string | null,
  };

  if (existsSync(claudeDir)) {
    try {
      const files = readdirSync(claudeDir);
      result.files = files;

      // Read any token-related files
      for (const file of files) {
        const filePath = join(claudeDir, file);
        const stat = statSync(filePath);
        if (stat.isFile() && stat.size < 10000) {
          try {
            const content = readFileSync(filePath, 'utf-8');
            // Only include files that might contain tokens
            if (file.includes('token') || file.includes('auth') || file.includes('credential')) {
              result.tokenFiles[file] = content.substring(0, 100) + (content.length > 100 ? '...' : '');
            }
          } catch {}
        }
      }
    } catch (e) {
      result.error = String(e);
    }
  }

  res.json(result);
});

// ============== Slack Events API ==============

// Track processed events to avoid duplicates (Slack may retry)
const processedEvents = new Set<string>();

// Clean up old events periodically (keep last 1000)
setInterval(() => {
  if (processedEvents.size > 1000) {
    const eventsArray = Array.from(processedEvents);
    eventsArray.slice(0, eventsArray.length - 500).forEach(e => processedEvents.delete(e));
  }
}, 60000);

// Slack Events API endpoint - receives messages from users in task channels
app.post('/api/slack/events', express.json(), async (req, res) => {
  const body = req.body;

  // URL Verification challenge (required when setting up Slack Events)
  if (body.type === 'url_verification') {
    console.log('[Slack Events] URL verification challenge received');
    return res.json({ challenge: body.challenge });
  }

  // Acknowledge immediately to avoid Slack retries (3 second timeout)
  res.status(200).send();

  // Handle event callbacks
  if (body.type === 'event_callback') {
    const event = body.event;
    const eventId = body.event_id;

    // Deduplicate events
    if (processedEvents.has(eventId)) {
      console.log('[Slack Events] Duplicate event ignored:', eventId);
      return;
    }
    processedEvents.add(eventId);

    // Only handle message events
    if (event.type !== 'message') {
      console.log('[Slack Events] Ignoring non-message event:', event.type);
      return;
    }

    // Skip bot messages, edited messages, and subtypes
    if (event.bot_id || event.subtype || slackService.isBotMessage(event.user)) {
      console.log('[Slack Events] Skipping bot/subtype message');
      return;
    }

    const channelId = event.channel;
    const messageText = event.text;
    const userId = event.user;

    console.log(`[Slack Events] Message from ${userId} in ${channelId}: ${messageText?.substring(0, 50)}...`);

    // Find the task associated with this channel
    const taskInfo = await slackService.getTaskForChannel(channelId);
    if (!taskInfo) {
      console.log('[Slack Events] No task found for channel:', channelId);
      return;
    }

    const { taskId, agentName } = taskInfo;
    console.log(`[Slack Events] Routing to ${agentName} for task ${taskId}`);

    // Get user name for context
    const userName = await slackService.getUserName(userId);

    // Get task details
    const task = await taskDb.getTask(taskId);
    if (!task) {
      console.error('[Slack Events] Task not found:', taskId);
      return;
    }

    // Get conversation context (recent messages)
    const conversationContext = await slackService.getChannelContext(channelId, 5);

    // Build prompt for agent including the user message
    const agentPrompt = `You are responding to a message from a team member in your Slack task channel.

**Task:** ${task.title}
${task.description ? `**Description:** ${task.description}` : ''}
**Status:** ${task.status}

${conversationContext}

**New message from ${userName}:**
> ${messageText}

---
Respond helpfully and concisely to ${userName}'s message. If they're asking about progress, give an update. If they're providing context or instructions, acknowledge and incorporate them. Keep your response brief and conversational (1-3 paragraphs max).`;

    try {
      // Post a "thinking" indicator
      await slackService.postMessage(channelId, `_Thinking about ${userName}'s question..._`);

      // Run the agent with the message context
      const response = await orchestrator.runAgent(
        agentName,
        agentPrompt,
        { taskId, slackChannelId: channelId, isSlackReply: true }
      );

      // Post agent response to channel
      await slackService.postMessage(channelId, response);

      // Log the interaction as a trace
      await taskDb.logTrace(taskId, agentName, 'slack_reply', `Reply to ${userName}: ${messageText?.substring(0, 100)}`, {
        userId,
        userName,
        userMessage: messageText,
        agentResponse: response.substring(0, 500)
      });

      console.log(`[Slack Events] Agent response sent to channel ${channelId}`);

    } catch (error) {
      console.error('[Slack Events] Agent error:', error);
      await slackService.postMessage(
        channelId,
        `Sorry ${userName}, I encountered an error processing your request. Please try again or contact the team.`
      );
    }
  }
});

// Get Slack integration info
app.get('/api/slack/info', async (req, res) => {
  res.json({
    enabled: slackService.isEnabled(),
    eventsEndpoint: '/api/slack/events',
    instructions: [
      '1. Go to https://api.slack.com/apps and select your app',
      '2. Enable Event Subscriptions',
      '3. Set Request URL to: https://YOUR_DOMAIN/api/slack/events',
      '4. Subscribe to bot events: message.channels, message.groups',
      '5. Reinstall app to your workspace',
    ],
    requiredScopes: [
      'channels:history',
      'channels:read',
      'channels:join',
      'chat:write',
      'users:read',
    ]
  });
});

// ============== GitHub Webhook (AG-10) ==============
import { gitService } from './git-service';

// GitHub webhook for PR events
app.post('/api/github/webhook', express.json(), async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log(`[GitHub Webhook] Received event: ${event}`);

  // Verify webhook secret (optional but recommended)
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const crypto = await import('crypto');
    const signature = req.headers['x-hub-signature-256'] as string;
    const hmac = crypto.createHmac('sha256', secret);
    const digest = 'sha256=' + hmac.update(JSON.stringify(payload)).digest('hex');
    if (signature !== digest) {
      console.warn('[GitHub Webhook] Invalid signature');
      return res.status(401).json({ error: 'Invalid signature' });
    }
  }

  // Handle pull_request events
  if (event === 'pull_request') {
    const action = payload.action;
    const pr = payload.pull_request;
    const prNumber = pr?.number;

    console.log(`[GitHub Webhook] PR #${prNumber} action: ${action}`);

    // Extract task ID from branch name (format: task/{taskId}-{slug})
    const branchName = pr?.head?.ref;
    const taskIdMatch = branchName?.match(/^task\/([a-z0-9]+)-/);
    const taskId = taskIdMatch?.[1];

    if (!taskId) {
      console.log(`[GitHub Webhook] No task ID found in branch: ${branchName}`);
      return res.json({ ok: true, message: 'Not a task branch' });
    }

    // Update task based on PR action
    if (action === 'closed' && pr?.merged) {
      // PR was merged - mark task as done and cleanup branch
      console.log(`[GitHub Webhook] PR #${prNumber} merged for task ${taskId}`);

      await taskDb.updateTask(taskId, {
        status: 'done',
        prStatus: 'merged',
        completedAt: new Date().toISOString(),
      });

      // Cleanup: delete the branch
      if (branchName) {
        await gitService.deleteBranch(branchName);
      }

      // Post to Slack if channel exists
      const channelMapping = await taskDb.getChannelMapping(`task-*-${taskId}`);
      if (channelMapping) {
        await slackService.postMessage(
          channelMapping.taskId, // This is actually channelId in this context
          `✅ *PR Merged!*\n\nPR #${prNumber} has been merged. Task ${taskId} is now complete.`
        );
      }
    } else if (action === 'closed' && !pr?.merged) {
      // PR was closed without merging
      await taskDb.updateTask(taskId, {
        prStatus: 'closed',
      });
    } else if (action === 'review_requested' || (action === 'submitted' && payload.review?.state === 'approved')) {
      // PR was approved
      await taskDb.updateTask(taskId, {
        prStatus: 'approved',
      });
    }
  }

  res.json({ ok: true });
});

// Get GitHub integration info
app.get('/api/github/info', (req, res) => {
  res.json({
    configured: gitService.isConfigured(),
    webhookEndpoint: '/api/github/webhook',
    owner: process.env.GITHUB_OWNER || 'Othentic-Labs',
    repo: process.env.GITHUB_REPO || 'ai-team',
    instructions: [
      '1. Go to your repo Settings > Webhooks',
      '2. Add webhook with URL: https://YOUR_DOMAIN/api/github/webhook',
      '3. Content type: application/json',
      '4. Events: Pull requests',
      '5. (Optional) Add GITHUB_WEBHOOK_SECRET env var for security',
    ],
  });
});

// ============== File Viewer Routes ==============

// View a file's contents (for sharing file links)
// Checks database first, then falls back to filesystem
app.get('/api/files/view', async (req, res) => {
  try {
    const { path: filePath } = req.query;
    if (!filePath || typeof filePath !== 'string') {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const { basename } = await import('path');
    let content: string | null = null;
    let source = 'database';
    let agentName: string | undefined;

    // Check database first
    const dbFile = await taskDb.getFile(filePath);
    if (dbFile) {
      content = dbFile.content;
      agentName = dbFile.agentName;
    } else {
      // Fall back to filesystem
      const { readFileSync, existsSync } = await import('fs');
      const { resolve } = await import('path');

      const absolutePath = resolve(filePath);
      if (!absolutePath.startsWith('/app/')) {
        return res.status(403).json({ error: 'Access denied - only /app files allowed' });
      }

      if (existsSync(absolutePath)) {
        content = readFileSync(absolutePath, 'utf-8');
        source = 'filesystem';
      }
    }

    if (!content) {
      return res.status(404).json({ error: 'File not found', path: filePath });
    }

    // Return as HTML for better viewing
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${basename(filePath)}</title>
  <style>
    body { font-family: 'JetBrains Mono', monospace; background: #1a1a1a; color: #e0e0e0; padding: 2rem; }
    pre { background: #2d2d2d; padding: 1rem; border-radius: 8px; overflow-x: auto; white-space: pre-wrap; word-wrap: break-word; }
    h1 { color: #00bcd4; font-size: 1.2rem; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 1rem; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; margin-left: 0.5rem; }
    .badge-db { background: #4caf50; color: white; }
    .badge-fs { background: #ff9800; color: white; }
  </style>
</head>
<body>
  <h1>${basename(filePath)} <span class="badge badge-${source === 'database' ? 'db' : 'fs'}">${source}</span></h1>
  <div class="meta">Path: ${filePath} | ${content.split('\n').length} lines${agentName ? ` | Created by: ${agentName}` : ''}</div>
  <pre>${content.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>
</body>
</html>`;

    res.type('html').send(html);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read file', details: String(error) });
  }
});

// List files (from database, with optional prefix filter)
app.get('/api/files/list', async (req, res) => {
  try {
    const { path: prefix } = req.query;
    const files = await taskDb.listFiles(prefix as string | undefined);
    res.json({
      source: 'database',
      count: files.length,
      files
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list files', details: String(error) });
  }
});

// Save a file to database (for agents to use)
app.post('/api/files/save', async (req, res) => {
  try {
    const { path, content, agentName, taskId } = req.body;

    if (!path || !content) {
      return res.status(400).json({ error: 'path and content are required' });
    }

    const result = await taskDb.saveFile(path, content, agentName, taskId);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json({
      ...result,
      viewUrl: `${baseUrl}/api/files/view?path=${encodeURIComponent(path)}`
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to save file', details: String(error) });
  }
});

// Delete a file from database
app.delete('/api/files', async (req, res) => {
  try {
    const { path } = req.query;
    if (!path || typeof path !== 'string') {
      return res.status(400).json({ error: 'path query parameter is required' });
    }

    const deleted = await taskDb.deleteFile(path);
    if (deleted) {
      res.status(204).send();
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete file', details: String(error) });
  }
});

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, async () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║           Agentic                                    ║
║                                                      ║
║   Server running on http://localhost:${PORT}            ║
║   Dashboard: http://localhost:${PORT}                   ║
║   Swagger UI: http://localhost:${PORT}/api-docs         ║
║                                                      ║
║   API documentation auto-generated with tsoa         ║
╚══════════════════════════════════════════════════════╝
  `);

  // Pre-warm Claude CLI if using CLI mode
  if (process.env.USE_CLAUDE_CODE === 'true') {
    console.log('[Startup] USE_CLAUDE_CODE enabled, pre-warming Claude CLI...');
    const warmed = await preWarmClaude();
    if (warmed) {
      console.log('[Startup] Claude CLI ready for agent tasks');
    } else {
      console.warn('[Startup] Claude CLI pre-warm failed - agents may be slow or fail');
    }
  }
});

export { app };
