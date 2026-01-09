/**
 * Task database with Redis persistence
 * Falls back to in-memory storage if Redis is not available
 */

import Redis from 'ioredis';

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'backlog' | 'ready' | 'in_progress' | 'done';
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
  createdAt: string;
  updatedAt: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
}

class TaskDatabase {
  private redis: Redis | null = null;

  // In-memory fallback
  private memProjects: Map<string, Project> = new Map();
  private memTasks: Map<string, Task> = new Map();
  private memProjectTasks: Map<string, Set<string>> = new Map();

  constructor() {
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

    if (redisUrl) {
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
      console.log('[TaskDB] No Redis URL, using in-memory storage');
    }

    this.initDefaultProject();
  }

  private async initDefaultProject() {
    await new Promise(resolve => setTimeout(resolve, 100));

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
    if (this.redis) {
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
    if (this.redis) {
      const data = await this.redis.get(this.projectKey(id));
      return data ? JSON.parse(data) as Project : undefined;
    }
    return this.memProjects.get(id);
  }

  async listProjects(): Promise<Project[]> {
    if (this.redis) {
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

    if (this.redis) {
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
    if (this.redis) {
      const data = await this.redis.get(this.taskKey(id));
      return data ? JSON.parse(data) as Task : undefined;
    }
    return this.memTasks.get(id);
  }

  async listTasks(projectId: string, status?: string): Promise<Task[]> {
    let tasks: Task[] = [];

    if (this.redis) {
      const ids = await this.redis.smembers(this.projectTasksKey(projectId));
      for (const id of ids) {
        const task = await this.getTask(id);
        if (task) tasks.push(task);
      }
    } else {
      const taskIds = this.memProjectTasks.get(projectId);
      if (taskIds) {
        tasks = Array.from(taskIds)
          .map(id => this.memTasks.get(id))
          .filter((t): t is Task => t !== undefined);
      }
    }

    if (status) {
      tasks = tasks.filter(t => t.status === status);
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

  async updateTask(id: string, updates: Partial<Pick<Task, 'title' | 'description' | 'status' | 'owner' | 'priority'>>): Promise<Task | undefined> {
    const task = await this.getTask(id);
    if (!task) return undefined;

    const updated: Task = {
      ...task,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    if (this.redis) {
      await this.redis.set(this.taskKey(id), JSON.stringify(updated));
    } else {
      this.memTasks.set(id, updated);
    }

    return updated;
  }

  async deleteTask(id: string): Promise<boolean> {
    if (this.redis) {
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
}

export const taskDb = new TaskDatabase();
