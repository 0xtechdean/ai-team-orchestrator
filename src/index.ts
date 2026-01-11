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

app.get('/api/claude-setup/start', async (req, res) => {
  const { spawn } = await import('child_process');
  const { writeFileSync, chmodSync } = await import('fs');

  if (setupProcess) {
    setupProcess.kill();
  }

  setupOutput = '';
  setupToken = '';

  // Create a fake browser script that captures the URL
  const browserScript = '/tmp/capture-url.sh';
  writeFileSync(browserScript, '#!/bin/bash\necho "AUTH_URL: $1" >> /tmp/claude-auth-url.txt\necho "$1"');
  chmodSync(browserScript, '755');

  // Clear previous URL
  try {
    const { unlinkSync } = await import('fs');
    unlinkSync('/tmp/claude-auth-url.txt');
  } catch {}

  // Run claude setup-token with fake browser to capture URL
  setupProcess = spawn('unbuffer', ['claude', 'setup-token'], {
    env: {
      ...process.env,
      CI: 'true',
      TERM: 'xterm-256color',
      BROWSER: browserScript,
      DISPLAY: '',  // Disable X11
    },
  });

  setupProcess.stdout?.on('data', (data) => {
    const chunk = data.toString();
    setupOutput += chunk;
    console.log('[Setup]', chunk);

    // Try to capture the token from output
    const tokenMatch = chunk.match(/sk-ant-[a-zA-Z0-9_-]+/);
    if (tokenMatch) {
      setupToken = tokenMatch[0];
    }
  });

  setupProcess.stderr?.on('data', (data) => {
    setupOutput += data.toString();
  });

  setupProcess.on('close', (code) => {
    console.log('[Setup] Process exited with code', code);
    setupProcess = null;
  });

  // Wait a moment for the auth URL to appear
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Extract auth URL and modify redirect_uri to point to our server
  const urlMatch = setupOutput.match(/https:\/\/claude\.ai\/oauth[^\s\]\u001b]+/) ||
                   setupOutput.match(/https:\/\/console\.anthropic\.com[^\s\]\u001b]+/);

  let authUrl = urlMatch ? urlMatch[0] : null;
  let serverCallbackUrl = null;

  if (authUrl) {
    // Get the server's public URL
    const serverHost = req.headers.host || 'ai-team-production.up.railway.app';
    const serverCallback = `https://${serverHost}/api/claude-setup/callback`;
    serverCallbackUrl = serverCallback;

    // Replace localhost callback with our server callback
    // Note: This may not work if OAuth provider validates redirect_uri strictly
    // In that case, user will need to manually copy the code
  }

  res.json({
    status: 'started',
    authUrl: authUrl,
    serverCallback: serverCallbackUrl,
    instructions: authUrl
      ? `1. Open authUrl in browser\n2. Authenticate\n3. When redirected to localhost (will fail), copy the full URL\n4. Replace 'localhost:XXXXX' with '${req.headers.host}/api/claude-setup' and visit that URL\n5. Check /api/claude-setup/status for the token`
      : 'Waiting for auth URL... Call /api/claude-setup/status to check progress',
    output: setupOutput.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').substring(0, 500),
  });
});

app.get('/api/claude-setup/status', async (req, res) => {
  const { readFileSync, existsSync } = await import('fs');

  // Try to read captured URL from file
  let capturedUrl = null;
  try {
    if (existsSync('/tmp/claude-auth-url.txt')) {
      const content = readFileSync('/tmp/claude-auth-url.txt', 'utf-8');
      const match = content.match(/AUTH_URL: (https:\/\/[^\s]+)/);
      if (match) capturedUrl = match[1];
    }
  } catch {}

  // Also check output for URLs and tokens
  const urlMatch = setupOutput.match(/https:\/\/console\.anthropic\.com[^\s\]\u001b]+/) ||
                   setupOutput.match(/https:\/\/[^\s\]\u001b]*anthropic[^\s\]\u001b]*/);
  const tokenMatch = setupOutput.match(/sk-ant-oat[a-zA-Z0-9_-]+/);

  const authUrl = capturedUrl || (urlMatch ? urlMatch[0] : null);

  res.json({
    running: !!setupProcess,
    authUrl: authUrl,
    token: tokenMatch ? tokenMatch[0] : null,
    output: setupOutput.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').substring(0, 2000),
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

// Manual token input - if you got a token from running setup-token locally
app.post('/api/claude-setup/set-token', express.json(), (req, res) => {
  const { token } = req.body;

  if (!token || !token.startsWith('sk-ant-')) {
    return res.status(400).json({ error: 'Invalid token format. Must start with sk-ant-' });
  }

  // Store token in memory (will be lost on restart - update Railway env var for persistence)
  process.env.CLAUDE_CODE_OAUTH_TOKEN = token;

  res.json({
    status: 'Token set successfully',
    note: 'This is temporary. Update CLAUDE_CODE_OAUTH_TOKEN in Railway for persistence.',
    tokenPreview: token.substring(0, 20) + '...',
  });
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
