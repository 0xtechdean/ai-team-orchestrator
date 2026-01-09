/**
 * AI Team Orchestrator - Main Entry Point
 * Express server with API routes for task management and agent coordination
 */

import express from 'express';
import cors from 'cors';
import { join } from 'path';
import { taskDb } from './taskdb';
import { AgentOrchestrator } from './orchestrator';
import { agentRegistry } from './agent-registry';

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

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
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
    const { title, description, status, owner, priority } = req.body;

    // Only include defined values to avoid overwriting existing fields
    const updates: Record<string, string | undefined> = {};
    if (title !== undefined) updates.title = title;
    if (description !== undefined) updates.description = description;
    if (status !== undefined) updates.status = status;
    if (owner !== undefined) updates.owner = owner;
    if (priority !== undefined) updates.priority = priority;

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
    const { agentName, task, context } = req.body;
    if (!agentName || !task) {
      return res.status(400).json({ error: 'agentName and task are required' });
    }
    const result = await orchestrator.runAgent(agentName, task, context);
    res.json({ result });
  } catch (error) {
    console.error('Agent run failed:', error);
    res.status(500).json({ error: 'Failed to run agent' });
  }
});

app.post('/api/sprint-check', async (req, res) => {
  try {
    const result = await orchestrator.runSprintCheck();
    res.json({ result });
  } catch (error) {
    res.status(500).json({ error: 'Sprint check failed' });
  }
});

app.post('/api/daily-standup', async (req, res) => {
  try {
    const result = await orchestrator.runDailyStandup();
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

// Serve dashboard
app.get('/', (req, res) => {
  res.sendFile(join(__dirname, '../public/index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║           AI Team Orchestrator                       ║
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
});

export { app };
