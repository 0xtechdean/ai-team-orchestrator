/**
 * Task database with PostgreSQL persistence
 * Falls back to Redis or in-memory storage if PostgreSQL is not available
 */

import { Pool } from 'pg';
import Redis from 'ioredis';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'done';
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
  output?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

export interface Trace {
  id: string;
  taskId: string;
  agentName: string;
  eventType: 'start' | 'tool_call' | 'llm_call' | 'message' | 'error' | 'complete' | 'slack_reply';
  content: string;
  metadata?: Record<string, unknown>;
  tokens?: number;
  latencyMs?: number;
  createdAt: string;
}

class TaskDatabase {
  private pg: Pool | null = null;
  private redis: Redis | null = null;
  private usePostgres = false;

  // In-memory fallback
  private memProjects: Map<string, Project> = new Map();
  private memTasks: Map<string, Task> = new Map();
  private memProjectTasks: Map<string, Set<string>> = new Map();

  constructor() {
    const databaseUrl = process.env.DATABASE_URL || process.env.DATABASE_PRIVATE_URL;
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

    if (databaseUrl) {
      try {
        this.pg = new Pool({
          connectionString: databaseUrl,
          ssl: databaseUrl.includes('localhost') ? false : { rejectUnauthorized: false },
        });
        this.usePostgres = true;
        console.log('[TaskDB] PostgreSQL configured');
        this.initPostgres();
      } catch (err) {
        console.error('[TaskDB] Failed to configure PostgreSQL:', err);
      }
    } else if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        this.redis.on('connect', () => console.log('[TaskDB] Redis connected'));
        this.redis.on('error', (err) => console.error('[TaskDB] Redis error:', err.message));
      } catch (err) {
        console.error('[TaskDB] Failed to connect to Redis:', err);
      }
    } else {
      console.log('[TaskDB] No database URL, using in-memory storage');
    }

    this.initDefaultProject();
  }

  private async initPostgres() {
    if (!this.pg) return;

    try {
      await this.pg.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id VARCHAR(50) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await this.pg.query(`
        CREATE TABLE IF NOT EXISTS tasks (
          id VARCHAR(50) PRIMARY KEY,
          project_id VARCHAR(50) REFERENCES projects(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          status VARCHAR(20) DEFAULT 'backlog',
          owner VARCHAR(100),
          priority VARCHAR(10),
          output TEXT,
          started_at TIMESTAMP,
          completed_at TIMESTAMP,
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);

      // Add new columns if they don't exist (for existing installations)
      await this.pg.query(`
        DO $$ BEGIN
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS output TEXT;
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
          ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
        EXCEPTION WHEN OTHERS THEN NULL;
        END $$;
      `);

      // Agent activity traces table for monitoring
      await this.pg.query(`
        CREATE TABLE IF NOT EXISTS traces (
          id VARCHAR(50) PRIMARY KEY,
          task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
          agent_name VARCHAR(100) NOT NULL,
          event_type VARCHAR(20) NOT NULL,
          content TEXT,
          metadata JSONB,
          tokens INTEGER,
          latency_ms INTEGER,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      await this.pg.query(`
        CREATE INDEX IF NOT EXISTS idx_traces_task_id ON traces(task_id)
      `);

      await this.pg.query(`
        CREATE INDEX IF NOT EXISTS idx_traces_created_at ON traces(created_at DESC)
      `);

      await this.pg.query(`
        CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON tasks(project_id)
      `);

      await this.pg.query(`
        CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)
      `);

      // Slack channel-to-task mappings (persists across restarts)
      await this.pg.query(`
        CREATE TABLE IF NOT EXISTS channel_mappings (
          channel_id VARCHAR(50) PRIMARY KEY,
          task_id VARCHAR(50) REFERENCES tasks(id) ON DELETE CASCADE,
          agent_name VARCHAR(100) NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);

      console.log('[TaskDB] PostgreSQL tables initialized');
    } catch (err) {
      console.error('[TaskDB] Failed to initialize PostgreSQL tables:', err);
    }
  }

  private async initDefaultProject() {
    await new Promise(resolve => setTimeout(resolve, 500));

    const existing = await this.getProject('default');
    if (!existing) {
      const defaultProject: Project = {
        id: 'default',
        name: 'Default Project',
        description: 'Default project for task management',
        createdAt: new Date().toISOString(),
      };
      await this.saveProject(defaultProject);
    }
  }

  // Redis key helpers
  private projectKey(id: string) { return `project:${id}`; }
  private taskKey(id: string) { return `task:${id}`; }
  private projectTasksKey(projectId: string) { return `project:${projectId}:tasks`; }
  private allProjectsKey() { return 'projects'; }

  // Project operations
  async createProject(name: string, description?: string): Promise<Project> {
    const id = this.generateId();
    const project: Project = {
      id,
      name,
      description,
      createdAt: new Date().toISOString(),
    };
    await this.saveProject(project);
    return project;
  }

  private async saveProject(project: Project): Promise<void> {
    if (this.usePostgres && this.pg) {
      await this.pg.query(
        `INSERT INTO projects (id, name, description, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id) DO UPDATE SET name = $2, description = $3`,
        [project.id, project.name, project.description, project.createdAt]
      );
    } else if (this.redis) {
      await this.redis.set(this.projectKey(project.id), JSON.stringify(project));
      await this.redis.sadd(this.allProjectsKey(), project.id);
    } else {
      this.memProjects.set(project.id, project);
      if (!this.memProjectTasks.has(project.id)) {
        this.memProjectTasks.set(project.id, new Set());
      }
    }
  }

  async getProject(id: string): Promise<Project | undefined> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query(
        'SELECT id, name, description, created_at FROM projects WHERE id = $1',
        [id]
      );
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0];
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
      };
    } else if (this.redis) {
      const data = await this.redis.get(this.projectKey(id));
      return data ? JSON.parse(data) as Project : undefined;
    }
    return this.memProjects.get(id);
  }

  async listProjects(): Promise<Project[]> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query('SELECT id, name, description, created_at FROM projects');
      return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        description: row.description,
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
      }));
    } else if (this.redis) {
      const ids = await this.redis.smembers(this.allProjectsKey());
      const projects: Project[] = [];
      for (const id of ids) {
        const project = await this.getProject(id);
        if (project) projects.push(project);
      }
      return projects;
    }
    return Array.from(this.memProjects.values());
  }

  // Task operations
  async createTask(projectId: string, title: string, description?: string, owner?: string, priority?: 'P0' | 'P1' | 'P2'): Promise<Task> {
    const id = this.generateId();
    const now = new Date().toISOString();
    const task: Task = {
      id,
      title,
      description,
      status: 'backlog',
      owner,
      priority,
      createdAt: now,
      updatedAt: now,
    };

    if (this.usePostgres && this.pg) {
      await this.pg.query(
        `INSERT INTO tasks (id, project_id, title, description, status, owner, priority, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, projectId, title, description, 'backlog', owner, priority, now, now]
      );
    } else if (this.redis) {
      await this.redis.set(this.taskKey(id), JSON.stringify(task));
      await this.redis.sadd(this.projectTasksKey(projectId), id);
    } else {
      this.memTasks.set(id, task);
      const taskSet = this.memProjectTasks.get(projectId);
      if (taskSet) taskSet.add(id);
    }

    return task;
  }

  async getTask(id: string): Promise<Task | undefined> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query(
        'SELECT id, title, description, status, owner, priority, output, started_at, completed_at, created_at, updated_at FROM tasks WHERE id = $1',
        [id]
      );
      if (result.rows.length === 0) return undefined;
      const row = result.rows[0];
      return {
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        owner: row.owner,
        priority: row.priority,
        output: row.output,
        startedAt: row.started_at?.toISOString(),
        completedAt: row.completed_at?.toISOString(),
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
      };
    } else if (this.redis) {
      const data = await this.redis.get(this.taskKey(id));
      return data ? JSON.parse(data) as Task : undefined;
    }
    return this.memTasks.get(id);
  }

  async listTasks(projectId: string, status?: string): Promise<Task[]> {
    let tasks: Task[] = [];

    if (this.usePostgres && this.pg) {
      let query = 'SELECT id, title, description, status, owner, priority, output, started_at, completed_at, created_at, updated_at FROM tasks WHERE project_id = $1';
      const params: string[] = [projectId];

      if (status) {
        query += ' AND status = $2';
        params.push(status);
      }

      const result = await this.pg.query(query, params);
      tasks = result.rows.map(row => ({
        id: row.id,
        title: row.title,
        description: row.description,
        status: row.status,
        owner: row.owner,
        priority: row.priority,
        output: row.output,
        startedAt: row.started_at?.toISOString(),
        completedAt: row.completed_at?.toISOString(),
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
        updatedAt: row.updated_at?.toISOString() || new Date().toISOString(),
      }));
    } else if (this.redis) {
      const ids = await this.redis.smembers(this.projectTasksKey(projectId));
      for (const id of ids) {
        const task = await this.getTask(id);
        if (task) tasks.push(task);
      }
      if (status) {
        tasks = tasks.filter(t => t.status === status);
      }
    } else {
      const taskIds = this.memProjectTasks.get(projectId);
      if (taskIds) {
        tasks = Array.from(taskIds)
          .map(id => this.memTasks.get(id))
          .filter((t): t is Task => t !== undefined);
      }
      if (status) {
        tasks = tasks.filter(t => t.status === status);
      }
    }

    // Sort by priority, then by creation date
    return tasks.sort((a, b) => {
      const priorityOrder: Record<string, number> = { P0: 0, P1: 1, P2: 2 };
      const aPriority = a.priority ? priorityOrder[a.priority] : 3;
      const bPriority = b.priority ? priorityOrder[b.priority] : 3;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
    });
  }

  async updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'owner' | 'priority' | 'output' | 'startedAt' | 'completedAt'>>): Promise<Task | undefined> {
    const task = await this.getTask(id);
    if (!task) return undefined;

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (this.usePostgres && this.pg) {
      await this.pg.query(
        `UPDATE tasks SET title = $1, description = $2, status = $3, owner = $4, priority = $5, output = $6, started_at = $7, completed_at = $8, updated_at = $9 WHERE id = $10`,
        [updated.title, updated.description, updated.status, updated.owner, updated.priority, updated.output, updated.startedAt, updated.completedAt, updated.updatedAt, id]
      );
    } else if (this.redis) {
      await this.redis.set(this.taskKey(id), JSON.stringify(updated));
    } else {
      this.memTasks.set(id, updated);
    }

    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query('DELETE FROM tasks WHERE id = $1', [id]);
      return (result.rowCount ?? 0) > 0;
    } else if (this.redis) {
      const projects = await this.listProjects();
      for (const project of projects) {
        await this.redis.srem(this.projectTasksKey(project.id), id);
      }
      const deleted = await this.redis.del(this.taskKey(id));
      return deleted > 0;
    } else {
      const deleted = this.memTasks.delete(id);
      for (const taskSet of this.memProjectTasks.values()) {
        taskSet.delete(id);
      }
      return deleted;
    }
  }

  async bulkCreateTasks(projectId: string, tasks: Array<{ title: string; description?: string; owner?: string; priority?: 'P0' | 'P1' | 'P2' }>): Promise<Task[]> {
    const created: Task[] = [];
    for (const t of tasks) {
      const task = await this.createTask(projectId, t.title, t.description, t.owner, t.priority);
      created.push(task);
    }
    return created;
  }

  async getStats(projectId: string): Promise<{ total: number; byStatus: Record<string, number> }> {
    const tasks = await this.listTasks(projectId);
    const byStatus: Record<string, number> = {
      backlog: 0,
      ready: 0,
      in_progress: 0,
      done: 0,
    };
    for (const task of tasks) {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
    }
    return { total: tasks.length, byStatus };
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 10);
  }

  // ============== Trace/Monitoring Methods ==============

  async logTrace(
    taskId: string,
    agentName: string,
    eventType: Trace['eventType'],
    content: string,
    metadata?: Record<string, unknown>,
    tokens?: number,
    latencyMs?: number
  ): Promise<Trace> {
    const id = this.generateId();
    const trace: Trace = {
      id,
      taskId,
      agentName,
      eventType,
      content,
      metadata,
      tokens,
      latencyMs,
      createdAt: new Date().toISOString(),
    };

    if (this.usePostgres && this.pg) {
      await this.pg.query(
        `INSERT INTO traces (id, task_id, agent_name, event_type, content, metadata, tokens, latency_ms, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [id, taskId, agentName, eventType, content, JSON.stringify(metadata || {}), tokens, latencyMs, trace.createdAt]
      );
    }

    return trace;
  }

  async getTraces(taskId: string, limit = 100): Promise<Trace[]> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query(
        `SELECT id, task_id, agent_name, event_type, content, metadata, tokens, latency_ms, created_at
         FROM traces WHERE task_id = $1 ORDER BY created_at ASC LIMIT $2`,
        [taskId, limit]
      );
      return result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        agentName: row.agent_name,
        eventType: row.event_type,
        content: row.content,
        metadata: row.metadata,
        tokens: row.tokens,
        latencyMs: row.latency_ms,
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
      }));
    }
    return [];
  }

  async getRecentTraces(limit = 50): Promise<Trace[]> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query(
        `SELECT id, task_id, agent_name, event_type, content, metadata, tokens, latency_ms, created_at
         FROM traces ORDER BY created_at DESC LIMIT $1`,
        [limit]
      );
      return result.rows.map(row => ({
        id: row.id,
        taskId: row.task_id,
        agentName: row.agent_name,
        eventType: row.event_type,
        content: row.content,
        metadata: row.metadata,
        tokens: row.tokens,
        latencyMs: row.latency_ms,
        createdAt: row.created_at?.toISOString() || new Date().toISOString(),
      }));
    }
    return [];
  }

  async getTraceStats(taskId: string): Promise<{
    totalTraces: number;
    totalTokens: number;
    totalLatencyMs: number;
    byEventType: Record<string, number>;
  }> {
    const traces = await this.getTraces(taskId);
    const byEventType: Record<string, number> = {};
    let totalTokens = 0;
    let totalLatencyMs = 0;

    for (const trace of traces) {
      byEventType[trace.eventType] = (byEventType[trace.eventType] || 0) + 1;
      totalTokens += trace.tokens || 0;
      totalLatencyMs += trace.latencyMs || 0;
    }

    return {
      totalTraces: traces.length,
      totalTokens,
      totalLatencyMs,
      byEventType,
    };
  }

  // ============== Channel Mappings (Slack) ==============

  async saveChannelMapping(channelId: string, taskId: string, agentName: string): Promise<void> {
    if (this.usePostgres && this.pg) {
      await this.pg.query(
        `INSERT INTO channel_mappings (channel_id, task_id, agent_name)
         VALUES ($1, $2, $3)
         ON CONFLICT (channel_id) DO UPDATE SET task_id = $2, agent_name = $3`,
        [channelId, taskId, agentName]
      );
    }
    // For non-postgres, we rely on in-memory mapping in SlackService
  }

  async getChannelMapping(channelId: string): Promise<{ taskId: string; agentName: string } | null> {
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query(
        'SELECT task_id, agent_name FROM channel_mappings WHERE channel_id = $1',
        [channelId]
      );
      if (result.rows.length > 0) {
        return {
          taskId: result.rows[0].task_id,
          agentName: result.rows[0].agent_name,
        };
      }
    }
    return null;
  }

  async deleteChannelMapping(channelId: string): Promise<void> {
    if (this.usePostgres && this.pg) {
      await this.pg.query('DELETE FROM channel_mappings WHERE channel_id = $1', [channelId]);
    }
  }

  async getAllChannelMappings(): Promise<Map<string, { taskId: string; agentName: string }>> {
    const mappings = new Map<string, { taskId: string; agentName: string }>();
    if (this.usePostgres && this.pg) {
      const result = await this.pg.query('SELECT channel_id, task_id, agent_name FROM channel_mappings');
      for (const row of result.rows) {
        mappings.set(row.channel_id, {
          taskId: row.task_id,
          agentName: row.agent_name,
        });
      }
    }
    return mappings;
  }
}

export const taskDb = new TaskDatabase();
