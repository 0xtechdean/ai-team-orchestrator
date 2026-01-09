/**
 * Memory Service using Mem0
 * Enables agents to share memories and learn from each other
 */

import { MemoryClient } from 'mem0ai';

export interface AgentMemory {
  id: string;
  memory: string;
  agent?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

export class MemoryService {
  private client: MemoryClient | null = null;
  private projectId: string;

  constructor(projectId: string = 'ai-team') {
    this.projectId = projectId;

    if (process.env.MEM0_API_KEY) {
      this.client = new MemoryClient({ apiKey: process.env.MEM0_API_KEY });
      console.log('[Memory] Mem0 client initialized');
    } else {
      console.log('[Memory] No MEM0_API_KEY, memory features disabled');
    }
  }

  private getUserId(agentName?: string): string {
    return agentName
      ? `${this.projectId}_${agentName}`
      : this.projectId;
  }

  async addMemory(content: string, agentName: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.client) return;

    try {
      await this.client.add(content, {
        user_id: this.getUserId(agentName),
        metadata: {
          agent: agentName,
          project: this.projectId,
          timestamp: new Date().toISOString(),
          ...metadata,
        },
      });
      console.log(`[Memory] Added memory for ${agentName}`);
    } catch (error) {
      console.error('[Memory] Failed to add memory:', error);
    }
  }

  async searchMemories(query: string, agentName?: string, limit: number = 10): Promise<AgentMemory[]> {
    if (!this.client) return [];

    try {
      const results = await this.client.search(query, {
        user_id: this.getUserId(agentName),
        limit,
      });

      return (results as Array<{ id: string; memory: string; metadata?: Record<string, unknown> }>).map(r => ({
        id: r.id,
        memory: r.memory,
        agent: r.metadata?.agent as string | undefined,
        metadata: r.metadata,
      }));
    } catch (error) {
      console.error('[Memory] Search failed:', error);
      return [];
    }
  }

  async getRecentMemories(agentName?: string, limit: number = 20): Promise<AgentMemory[]> {
    if (!this.client) return [];

    try {
      const results = await this.client.getAll({
        user_id: this.getUserId(agentName),
        limit,
      });

      return (results as Array<{ id: string; memory: string; metadata?: Record<string, unknown> }>).map(r => ({
        id: r.id,
        memory: r.memory,
        agent: r.metadata?.agent as string | undefined,
        metadata: r.metadata,
      }));
    } catch (error) {
      console.error('[Memory] Failed to get memories:', error);
      return [];
    }
  }

  async getTaskContext(agentName: string, taskTitle: string): Promise<string> {
    if (!this.client) return '';

    const relevantMemories = await this.searchMemories(taskTitle, undefined, 5);
    const agentMemories = await this.getRecentMemories(agentName, 5);

    const allMemories = [...relevantMemories, ...agentMemories];
    const uniqueMemories = Array.from(new Map(allMemories.map(m => [m.id, m])).values());

    if (uniqueMemories.length === 0) return '';

    return `\n## Relevant Memories\n${uniqueMemories.map(m => `- ${m.memory}`).join('\n')}`;
  }

  async recordTaskCompletion(
    agentName: string,
    taskId: string,
    taskTitle: string,
    result: string,
    learnings?: string[]
  ): Promise<void> {
    if (!this.client) return;

    const summary = `Completed task "${taskTitle}": ${result.substring(0, 200)}`;
    await this.addMemory(summary, agentName, {
      type: 'task_completion',
      taskId,
      taskTitle,
    });

    if (learnings && learnings.length > 0) {
      for (const learning of learnings) {
        await this.addMemory(`Learning: ${learning}`, agentName, {
          type: 'learning',
          taskId,
        });
      }
    }
  }

  isEnabled(): boolean {
    return this.client !== null;
  }
}

export const memoryService = new MemoryService();
