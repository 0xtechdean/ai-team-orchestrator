/**
 * Agentic - Main Entry Point
 * Express server with API routes for task management and agent coordination
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { taskDb } from './taskdb';
import { AgentOrchestrator } from './orchestrator';
import { agentRegistry } from './agent-registry';
import { preWarmClaude } from './claude-runner';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(join(__dirname, '../public')));

// Initialize orchestrator
const orchestrator = new AgentOrchestrator({
  onNotification: async (message) => {
    console.log('[Notification]', message);
  },
});

// Claude CLI setup - run setup-token from server and capture the token
let setupProcess: ReturnType<typeof import('child_process').spawn> | null = null;
let setupOutput = '';
let setupToken = '';
let setupPort: number | null = null;
let setupStartTime: number | null = null;
let setupAuthUrl: string | null = null;  // Store the full auth URL when detected

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

  // Run claude setup-token with unbuffer for TTY
  // stdin will be available for sending the code
  setupProcess = spawn('unbuffer', ['-p', 'claude', 'setup-token'], {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'xterm-256color',
      BROWSER: browserScript,
      DISPLAY: '',  // Disable X11
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
  if (setupProcess) {
    setupProcess.kill();
    setupProcess = null;
  }
  res.json({ status: 'stopped' });
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

// Send code to CLI stdin - for console.anthropic.com callback flow
app.post('/api/claude-setup/send-code', express.json(), async (req, res) => {
  const { code } = req.body;

  if (!code) {
    return res.status(400).json({ error: 'Code is required' });
  }

  if (!setupProcess || !setupProcess.stdin) {
    return res.status(400).json({
      error: 'No setup process running',
      hint: 'Start the setup first with GET /api/claude-setup/start',
    });
  }

  console.log('[Setup] Sending code to CLI stdin:', code.substring(0, 20) + '...');

  try {
    // Send the code followed by newline, then flush
    const written = setupProcess.stdin.write(code + '\n', 'utf8');
    console.log('[Setup] Write returned:', written);

    // Ensure the write is flushed
    if (!written) {
      await new Promise(resolve => setupProcess!.stdin!.once('drain', resolve));
    }

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

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    slack: !!process.env.SLACK_BOT_TOKEN,
    database: !!process.env.DATABASE_URL,
    claude: {
      useClaudeCode: process.env.USE_CLAUDE_CODE === 'true',
      hasOAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
      hasApiKey: !!process.env.ANTHROPIC_API_KEY,
      tokenPreview: process.env.CLAUDE_CODE_OAUTH_TOKEN
        ? `${process.env.CLAUDE_CODE_OAUTH_TOKEN.substring(0, 15)}...`
        : null,
    },
  });
});

// ============== Project Routes ==============

app.get('/api/projects', async (req, res) => {
  try {
    const projects = await taskDb.listProjects();
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list projects' });
  }
});

app.post('/api/projects', async (req, res) => {
  try {
    const { name, description } = req.body;
    const project = await taskDb.createProject(name, description);
    res.status(201).json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create project' });
  }
});

// ============== Task Routes ==============

app.get('/api/projects/:projectId/tasks', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { status } = req.query;
    const tasks = await taskDb.listTasks(projectId, status as string | undefined);
    res.json(tasks);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list tasks' });
  }
});

app.post('/api/projects/:projectId/tasks', async (req, res) => {
  try {
    const { projectId } = req.params;
    const { title, description, owner, priority } = req.body;
    const task = await taskDb.createTask(projectId, title, description, owner, priority);
    res.status(201).json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create task' });
  }
});

app.get('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const task = await taskDb.getTask(taskId);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get task' });
  }
});

app.patch('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { title, description, status, owner, priority, output, startedAt, completedAt } = req.body;

    // Only include defined values to avoid overwriting existing fields
    const updates: Record<string, string | undefined> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (owner !== undefined) updates.owner = owner;
    if (priority !== undefined) updates.priority = priority;
    if (output !== undefined) updates.output = output;
    if (startedAt !== undefined) updates.startedAt = startedAt;
    if (completedAt !== undefined) updates.completedAt = completedAt;

    const task = await taskDb.updateTask(taskId, updates);
    if (!task) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.json(task);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update task' });
  }
});

app.delete('/api/tasks/:taskId', async (req, res) => {
  try {
    const { taskId } = req.params;
    const deleted = await taskDb.deleteTask(taskId);
    if (!deleted) {
      return res.status(404).json({ error: 'Task not found' });
    }
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete task' });
  }
});

app.get('/api/projects/:projectId/stats', async (req, res) => {
  try {
    const { projectId } = req.params;
    const stats = await taskDb.getStats(projectId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ============== Agent Routes ==============

app.get('/api/agents', async (req, res) => {
  try {
    const agents = await agentRegistry.listAgents();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list agents' });
  }
});

app.get('/api/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const agent = await agentRegistry.getAgent(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get agent' });
  }
});

app.post('/api/agents', async (req, res) => {
  try {
    const agentDef = req.body;
    const createdBy = req.body.createdBy || 'api';
    const agent = await agentRegistry.createAgent(agentDef, createdBy);
    res.status(201).json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create agent' });
  }
});

app.patch('/api/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    const updates = req.body;
    const updatedBy = req.body.updatedBy || 'api';
    delete updates.updatedBy;
    const agent = await agentRegistry.updateAgent(agentId, updates, updatedBy);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    res.json(agent);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update agent' });
  }
});

app.delete('/api/agents/:agentId', async (req, res) => {
  try {
    const { agentId } = req.params;
    await agentRegistry.deleteAgent(agentId);
    res.status(204).send();
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

app.get('/api/agents/:agentId/performance', async (req, res) => {
  try {
    const { agentId } = req.params;
    const performance = await agentRegistry.getAgentPerformance(agentId);
    res.json(performance);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get performance' });
  }
});

// ============== Orchestration Routes ==============

app.post('/api/run-agent', async (req, res) => {
  try {
    const { agentName, task, context, slackUserId } = req.body;
    if (!agentName || !task) {
      return res.status(400).json({ error: 'agentName and task are required' });
    }
    const result = await orchestrator.runAgent(agentName, task, {
      ...context,
      slackUserId,
    });
    res.json({ result });
  } catch (error) {
    console.error('Agent run failed:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: 'Failed to run agent', details: errorMessage });
  }
});

app.post('/api/sprint-check', async (req, res) => {
  try {
    const { slackUserId } = req.body || {};
    const result = await orchestrator.runSprintCheck(slackUserId);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'Sprint check failed' });
  }
});

app.post('/api/daily-standup', async (req, res) => {
  try {
    const { slackUserId } = req.body || {};
    const result = await orchestrator.runDailyStandup(slackUserId);
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'Daily standup failed' });
  }
});

// ============== Skills Routes ==============

app.get('/api/skills', async (req, res) => {
  try {
    const skills = await agentRegistry.listSkills();
    res.json(skills);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list skills' });
  }
});

app.post('/api/skills', async (req, res) => {
  try {
    const { name, description, prompt, createdBy } = req.body;
    const skill = await agentRegistry.createSkill(name, description, prompt, createdBy || 'api');
    res.status(201).json(skill);
  } catch (error) {
    res.status(500).json({ error: 'Failed to create skill' });
  }
});

// ============== Rules Routes ==============

app.get('/api/rules', async (req, res) => {
  try {
    const rules = agentRegistry.getRules();
    res.json(rules);
  } catch (error) {
    res.status(500).json({ error: 'Failed to list rules' });
  }
});

// ============== Trace/Monitoring Routes ==============

// Log a trace event for a task
app.post('/api/tasks/:taskId/traces', async (req, res) => {
  try {
    const { taskId } = req.params;
    const { agentName, eventType, content, metadata, tokens, latencyMs } = req.body;

    if (!agentName || !eventType || !content) {
      return res.status(400).json({ error: 'agentName, eventType, and content are required' });
    }

    const trace = await taskDb.logTrace(taskId, agentName, eventType, content, metadata, tokens, latencyMs);
    res.status(201).json(trace);
  } catch (error) {
    console.error('Failed to log trace:', error);
    res.status(500).json({ error: 'Failed to log trace' });
  }
});

// Get all traces for a task
app.get('/api/tasks/:taskId/traces', async (req, res) => {
  try {
    const { taskId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const traces = await taskDb.getTraces(taskId, limit);
    res.json(traces);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get traces' });
  }
});

// Get trace stats for a task
app.get('/api/tasks/:taskId/traces/stats', async (req, res) => {
  try {
    const { taskId } = req.params;
    const stats = await taskDb.getTraceStats(taskId);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get trace stats' });
  }
});

// Get recent traces across all tasks
app.get('/api/traces/recent', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const traces = await taskDb.getRecentTraces(limit);
    res.json(traces);
  } catch (error) {
    res.status(500).json({ error: 'Failed to get recent traces' });
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
║                                                      ║
║   API Endpoints:                                     ║
║   - GET  /api/projects                               ║
║   - GET  /api/projects/:id/tasks                     ║
║   - GET  /api/agents                                 ║
║   - POST /api/run-agent                              ║
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
