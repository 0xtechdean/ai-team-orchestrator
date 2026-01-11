/**
 * Memory Service using Mem0
 * Enables agents to share memories and learn from each other
 */

export interface AgentMemory {
  id: string;
  memory: string;
  agent?: string;
  createdAt?: string;
  metadata?: Record<string, unknown>;
}

// Use REST API directly since mem0ai npm package requires browser environment
const MEM0_API_BASE = 'https://api.mem0.ai/v1';

export class MemoryService {
  private apiKey: string | null = null;
  private projectId: string;

  constructor(projectId: string = 'ai-team') {
    this.projectId = projectId;

    if (process.env.MEM0_API_KEY) {
      this.apiKey = process.env.MEM0_API_KEY;
      console.log('[Memory] Mem0 service initialized (REST API)');
    } else {
      console.log('[Memory] No MEM0_API_KEY, memory features disabled');
    }
  }

  private getUserId(agentName?: string): string {
    return agentName
      ? `${this.projectId}_${agentName}`
      : this.projectId;
  }

  private async apiRequest(endpoint: string, method: string, body?: unknown): Promise<unknown> {
    if (!this.apiKey) return null;

    try {
      const response = await fetch(`${MEM0_API_BASE}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Token ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: body ? JSON.stringify(body) : undefined,
      });

      if (!response.ok) {
        throw new Error(`Mem0 API error: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('[Memory] API request failed:', error);
      return null;
    }
  }

  async addMemory(content: string, agentName: string, metadata?: Record<string, unknown>): Promise<void> {
    if (!this.apiKey) return;

    try {
      await this.apiRequest('/memories/', 'POST', {
        messages: [{ role: 'user', content }],
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
    if (!this.apiKey) return [];

    try {
      const result = await this.apiRequest('/memories/search/', 'POST', {
        query,
        user_id: this.getUserId(agentName),
        limit,
      });

      if (!result || !Array.isArray((result as { results?: unknown[] }).results)) {
        return [];
      }

      return ((result as { results: Array<{ id: string; memory: string; metadata?: Record<string, unknown> }> }).results).map(r => ({
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
    if (!this.apiKey) return [];

    try {
      const userId = this.getUserId(agentName);
      const result = await this.apiRequest(`/memories/?user_id=${encodeURIComponent(userId)}&limit=${limit}`, 'GET');

      if (!result || !Array.isArray((result as { results?: unknown[] }).results)) {
        return [];
      }

      return ((result as { results: Array<{ id: string; memory: string; metadata?: Record<string, unknown> }> }).results).map(r => ({
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
    if (!this.apiKey) return '';

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
    if (!this.apiKey) return;

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
    return this.apiKey !== null;
  }
}

export const memoryService = new MemoryService();
