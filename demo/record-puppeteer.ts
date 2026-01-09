import puppeteer from 'puppeteer';
import { PuppeteerScreenRecorder } from 'puppeteer-screen-recorder';

const DASHBOARD_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:3000/api';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function recordDemo() {
  console.log('🎬 Starting demo recording...');

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: { width: 1280, height: 720 },
    args: ['--window-size=1280,720']
  });

  const page = await browser.newPage();

  // Start recording
  const recorder = new PuppeteerScreenRecorder(page, {
    followNewTab: false,
    fps: 30,
    videoFrame: { width: 1280, height: 720 },
  });

  const videoPath = './demo/demo-full.mp4';
  await recorder.start(videoPath);
  console.log('📹 Recording started...');

  try {
    // Scene 1: Dashboard Overview
    console.log('Scene 1: Dashboard');
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle0' });
    await sleep(2000);

    // Highlight the Kanban board
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.textContent = `
        .demo-highlight {
          animation: pulse 1s ease-in-out;
        }
        @keyframes pulse {
          0%, 100% { box-shadow: none; }
          50% { box-shadow: 0 0 20px 5px rgba(59, 130, 246, 0.5); }
        }
      `;
      document.head.appendChild(style);
    });
    await sleep(2000);

    // Scene 2: Show agents
    console.log('Scene 2: Agents');
    await page.goto(`${DASHBOARD_URL}`, { waitUntil: 'networkidle0' });
    await sleep(1500);

    // Scene 3: Trigger agent via API (show in overlay)
    console.log('Scene 3: Running agent');

    // Add terminal overlay
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'terminal-overlay';
      overlay.innerHTML = `
        <div style="
          position: fixed;
          bottom: 20px;
          left: 20px;
          right: 20px;
          background: #1e1e1e;
          border-radius: 8px;
          padding: 16px;
          font-family: 'Monaco', 'Menlo', monospace;
          font-size: 14px;
          color: #4ade80;
          box-shadow: 0 4px 20px rgba(0,0,0,0.3);
          z-index: 10000;
        ">
          <div style="color: #666; margin-bottom: 8px;">$ Running agent...</div>
          <div id="terminal-output"></div>
        </div>
      `;
      document.body.appendChild(overlay);
    });
    await sleep(1000);

    // Make actual API call
    const response = await fetch(`${API_URL}/run-agent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agentName: 'backend',
        task: 'Build user authentication API'
      })
    });

    const result = await response.json();
    console.log('Agent response:', result);

    // Update terminal overlay with response
    await page.evaluate((res: any) => {
      const output = document.getElementById('terminal-output');
      if (output) {
        output.innerHTML = `
          <div style="color: #60a5fa;">curl -X POST /api/run-agent</div>
          <div style="color: #fbbf24; margin-top: 8px;">[Orchestrator] Running backend agent...</div>
          <div style="color: #fbbf24;">[Slack] Created channel: #task-backend-${res.taskId || 'xxx'}</div>
          <div style="color: #fbbf24;">[Agent] Analyzing task...</div>
          <div style="color: #4ade80; margin-top: 8px;">✅ Agent started successfully</div>
        `;
      }
    }, result);
    await sleep(3000);

    // Scene 4: Show Slack simulation
    console.log('Scene 4: Slack channel');
    await page.evaluate(() => {
      const overlay = document.getElementById('terminal-overlay');
      if (overlay) {
        overlay.innerHTML = `
          <div style="
            position: fixed;
            bottom: 20px;
            right: 20px;
            width: 400px;
            background: #1a1d21;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            font-size: 14px;
            color: #fff;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            overflow: hidden;
          ">
            <div style="background: #350d36; padding: 12px 16px; font-weight: 600;">
              <span style="color: #e8e8e8;"># task-backend-t1ecwpz4</span>
            </div>
            <div style="padding: 16px; max-height: 300px;">
              <div style="display: flex; margin-bottom: 12px;">
                <div style="width: 36px; height: 36px; background: #4a154b; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 10px;">🤖</div>
                <div>
                  <div style="font-weight: 600; color: #1d9bd1;">backend <span style="color: #616061; font-weight: 400; font-size: 12px;">2:34 PM</span></div>
                  <div style="color: #d1d2d3;">Starting work on: Build user authentication API</div>
                </div>
              </div>
              <div style="display: flex; margin-bottom: 12px;">
                <div style="width: 36px; height: 36px; background: #4a154b; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 10px;">🤖</div>
                <div>
                  <div style="font-weight: 600; color: #1d9bd1;">backend <span style="color: #616061; font-weight: 400; font-size: 12px;">2:34 PM</span></div>
                  <div style="color: #d1d2d3;">Implementing JWT token generation...</div>
                </div>
              </div>
              <div style="display: flex; margin-bottom: 12px;">
                <div style="width: 36px; height: 36px; background: #2eb67d; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 10px;">👤</div>
                <div>
                  <div style="font-weight: 600; color: #fff;">dean <span style="color: #616061; font-weight: 400; font-size: 12px;">2:35 PM</span></div>
                  <div style="color: #d1d2d3;">Add rate limiting please</div>
                </div>
              </div>
              <div style="display: flex;">
                <div style="width: 36px; height: 36px; background: #4a154b; border-radius: 4px; display: flex; align-items: center; justify-content: center; margin-right: 10px;">🤖</div>
                <div>
                  <div style="font-weight: 600; color: #1d9bd1;">backend <span style="color: #616061; font-weight: 400; font-size: 12px;">2:35 PM</span></div>
                  <div style="color: #d1d2d3;">✅ Added! 100 requests/minute limit</div>
                </div>
              </div>
            </div>
          </div>
        `;
      }
    });
    await sleep(4000);

    // Scene 5: Self-improvement
    console.log('Scene 5: Self-improvement');
    await page.evaluate(() => {
      const overlay = document.getElementById('terminal-overlay');
      if (overlay) {
        overlay.innerHTML = `
          <div style="
            position: fixed;
            bottom: 20px;
            left: 20px;
            background: #1e1e1e;
            border-radius: 8px;
            padding: 16px;
            font-family: 'Monaco', 'Menlo', monospace;
            font-size: 14px;
            color: #4ade80;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            z-index: 10000;
            width: 500px;
          ">
            <div style="color: #60a5fa; margin-bottom: 8px;">🧠 Self-Improvement System</div>
            <div style="color: #fbbf24;">[Registry] Pattern detected: 'auth-endpoint' (3x)</div>
            <div style="color: #fbbf24;">[Registry] 💡 Creating skill: 'auth-scaffold'</div>
            <div style="color: #4ade80; margin-top: 8px;">✅ Skill saved for future use</div>
          </div>
        `;
      }
    });
    await sleep(3000);

    // Scene 6: Final - GitHub link
    console.log('Scene 6: GitHub');
    await page.evaluate(() => {
      const overlay = document.getElementById('terminal-overlay');
      if (overlay) {
        overlay.innerHTML = `
          <div style="
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: linear-gradient(135deg, #1e1e1e 0%, #2d2d2d 100%);
            border-radius: 12px;
            padding: 32px 48px;
            font-family: -apple-system, BlinkMacSystemFont, sans-serif;
            text-align: center;
            box-shadow: 0 8px 32px rgba(0,0,0,0.4);
            z-index: 10000;
          ">
            <div style="font-size: 48px; margin-bottom: 16px;">🤖</div>
            <div style="font-size: 24px; font-weight: 600; color: #fff; margin-bottom: 8px;">AI Team Orchestrator</div>
            <div style="font-size: 16px; color: #60a5fa; margin-bottom: 16px;">github.com/0xtechdean/ai-team-orchestrator</div>
            <div style="font-size: 14px; color: #888;">MIT Licensed • TypeScript • Self-Improving AI Teams</div>
          </div>
        `;
      }
    });
    await sleep(3000);

  } catch (error) {
    console.error('Error during recording:', error);
  }

  // Stop recording
  await recorder.stop();
  console.log(`✅ Recording saved to: ${videoPath}`);

  await browser.close();

  // Convert to GIF
  console.log('🎨 Converting to GIF...');
  const { execSync } = await import('child_process');
  try {
    execSync(`ffmpeg -y -i ${videoPath} -vf "fps=12,scale=800:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse" -loop 0 ./demo/demo.gif`, {
      stdio: 'inherit'
    });
    console.log('✅ GIF created: ./demo/demo.gif');
  } catch (e) {
    console.log('⚠️ GIF conversion failed, MP4 available at:', videoPath);
  }
}

recordDemo().catch(console.error);
