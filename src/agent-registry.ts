/**
 * Agent Registry Service
 * Enables agents to create, modify, and evolve other agents
 * Supports self-improvement through performance tracking
 */

import Redis from 'ioredis';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  role: 'manager' | 'specialist' | 'support';
  capabilities: string[];
  tools: string[];
  systemPrompt: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  performance?: AgentPerformance;
  parentAgent?: string;
}

export interface AgentPerformance {
  tasksCompleted: number;
  tasksSuccessful: number;
  avgExecutionTime: number;
  lastActive: string;
  learnings: string[];
  improvements: string[];
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
  createdBy: string;
  createdAt: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
  description: string;
  responsibilities: string[];
  canCreateAgents: boolean;
  canCreateSkills: boolean;
  canModifyOthers: boolean;
}

export interface SelfImprovementRule {
  id: string;
  name: string;
  description: string;
  trigger: 'performance' | 'pattern' | 'gap' | 'request' | 'threshold';
  action: 'create_agent' | 'create_skill' | 'evolve' | 'suggest';
  conditions: RuleCondition[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  autoApply: boolean;
}

export interface RuleCondition {
  metric: string;
  operator: 'gt' | 'lt' | 'eq' | 'gte' | 'lte' | 'contains' | 'matches';
  value: number | string;
}

export interface RuleEvaluation {
  ruleId: string;
  triggered: boolean;
  action: string;
  reason: string;
  suggestion?: string;
  autoApply: boolean;
}

export interface RuleContext {
  agentId?: string;
  taskId?: string;
  taskType?: string;
  taskDomain?: string;
  metrics?: Record<string, number | string>;
}

// Default roles
const DEFAULT_ROLES: RoleDefinition[] = [
  {
    id: 'manager',
    name: 'Manager',
    description: 'Manages other agents and can create new agents',
    responsibilities: ['planning', 'delegation', 'review', 'decision-making'],
    canCreateAgents: true,
    canCreateSkills: true,
    canModifyOthers: true,
  },
  {
    id: 'specialist',
    name: 'Specialist',
    description: 'Expert in specific domain, can suggest improvements',
    responsibilities: ['implementation', 'expertise', 'quality'],
    canCreateAgents: false,
    canCreateSkills: true,
    canModifyOthers: false,
  },
  {
    id: 'support',
    name: 'Support',
    description: 'Assists other agents',
    responsibilities: ['assistance', 'documentation', 'testing'],
    canCreateAgents: false,
    canCreateSkills: false,
    canModifyOthers: false,
  },
];

// Default self-improvement rules
const DEFAULT_RULES: SelfImprovementRule[] = [
  {
    id: 'create-specialist-on-repeated-domain',
    name: 'Create Specialist for Repeated Domain',
    description: 'Create a new specialist agent when tasks in a specific domain appear 5+ times',
    trigger: 'pattern',
    action: 'create_agent',
    conditions: [
      { metric: 'domain_task_count', operator: 'gte', value: 5 },
      { metric: 'existing_specialist', operator: 'eq', value: 0 },
    ],
    priority: 'medium',
    autoApply: false,
  },
  {
    id: 'create-skill-on-repetition',
    name: 'Create Skill for Repeated Pattern',
    description: 'Create a reusable skill when a task pattern appears 3+ times',
    trigger: 'pattern',
    action: 'create_skill',
    conditions: [
      { metric: 'pattern_occurrence', operator: 'gte', value: 3 },
      { metric: 'existing_skill', operator: 'eq', value: 0 },
    ],
    priority: 'low',
    autoApply: true,
  },
  {
    id: 'evolve-on-low-success',
    name: 'Evolve Agent on Low Success Rate',
    description: 'Suggest evolution when success rate drops below 80% after 10+ tasks',
    trigger: 'performance',
    action: 'evolve',
    conditions: [
      { metric: 'success_rate', operator: 'lt', value: 0.8 },
      { metric: 'tasks_completed', operator: 'gte', value: 10 },
    ],
    priority: 'high',
    autoApply: false,
  },
  {
    id: 'suggest-delegation',
    name: 'Suggest Task Delegation',
    description: 'Suggest delegating tasks when an agent is overloaded',
    trigger: 'threshold',
    action: 'suggest',
    conditions: [
      { metric: 'pending_tasks', operator: 'gte', value: 5 },
      { metric: 'available_delegates', operator: 'gte', value: 1 },
    ],
    priority: 'medium',
    autoApply: true,
  },
  {
    id: 'docs-read-before-task',
    name: 'Read Docs Before Task',
    description: 'Agent must read relevant docs before starting any task',
    trigger: 'threshold',
    action: 'suggest',
    conditions: [
      { metric: 'task_started', operator: 'eq', value: 1 },
    ],
    priority: 'critical',
    autoApply: true,
  },
  {
    id: 'docs-update-after-task',
    name: 'Update Docs After Task',
    description: 'Agent must update status.md and relevant docs after completing any task',
    trigger: 'threshold',
    action: 'suggest',
    conditions: [
      { metric: 'task_completed', operator: 'eq', value: 1 },
    ],
    priority: 'critical',
    autoApply: true,
  },
];

interface PatternTracker {
  pattern: string;
  domain: string;
  occurrences: number;
  examples: string[];
  firstSeen: string;
  lastSeen: string;
}

class AgentRegistry {
  private redis: Redis | null = null;
  private repoPath: string;

  private memAgents: Map<string, AgentDefinition> = new Map();
  private memSkills: Map<string, SkillDefinition> = new Map();
  private memRoles: Map<string, RoleDefinition> = new Map();
  private memRules: Map<string, SelfImprovementRule> = new Map();
  private patternTracker: Map<string, PatternTracker> = new Map();

  constructor() {
    this.repoPath = process.env.REPO_PATH || process.cwd();
    const redisUrl = process.env.REDIS_URL || process.env.REDIS_PRIVATE_URL;

    if (redisUrl) {
      try {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 50, 2000),
        });
        console.log('[AgentRegistry] Redis connected');
      } catch (err) {
        console.error('[AgentRegistry] Redis connection failed:', err);
      }
    }

    DEFAULT_ROLES.forEach(role => this.memRoles.set(role.id, role));
    DEFAULT_RULES.forEach(rule => this.memRules.set(rule.id, rule));
    console.log(`[AgentRegistry] Loaded ${this.memRules.size} self-improvement rules`);

    this.loadAgentsFromFiles();
  }

  private loadAgentsFromFiles() {
    const agentsDir = join(this.repoPath, '.claude', 'agents');
    if (!existsSync(agentsDir)) return;

    try {
      const files = readdirSync(agentsDir).filter((f: string) => f.endsWith('.md'));

      for (const file of files) {
        const content = readFileSync(join(agentsDir, file), 'utf-8');
        const agent = this.parseAgentFile(file.replace('.md', ''), content);
        if (agent) {
          this.memAgents.set(agent.id, agent);
        }
      }
      console.log(`[AgentRegistry] Loaded ${this.memAgents.size} agents from files`);
    } catch (err) {
      console.error('[AgentRegistry] Error loading agents:', err);
    }
  }

  private parseAgentFile(id: string, content: string): AgentDefinition | null {
    try {
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      const frontmatter = frontmatterMatch ? frontmatterMatch[1] : '';

      const nameMatch = frontmatter.match(/name:\s*(.+)/);
      const descMatch = frontmatter.match(/description:\s*(.+)/);
      const toolsMatch = frontmatter.match(/tools:\s*(.+)/);
      const roleMatch = frontmatter.match(/role:\s*(.+)/);

      return {
        id,
        name: nameMatch ? nameMatch[1].trim() : id,
        description: descMatch ? descMatch[1].trim() : '',
        role: (roleMatch?.[1].trim() as 'manager' | 'specialist' | 'support') || 'specialist',
        capabilities: [],
        tools: toolsMatch ? toolsMatch[1].split(',').map(t => t.trim()) : [],
        systemPrompt: content,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        version: 1,
      };
    } catch {
      return null;
    }
  }

  // Redis key helpers
  private agentKey(id: string) { return `agent:${id}`; }
  private skillKey(id: string) { return `skill:${id}`; }
  private allAgentsKey() { return 'agents'; }
  private allSkillsKey() { return 'skills'; }

  async getAgent(id: string): Promise<AgentDefinition | null> {
    if (this.redis) {
      const data = await this.redis.get(this.agentKey(id));
      if (data) return JSON.parse(data);
    }
    return this.memAgents.get(id) || null;
  }

  async listAgents(): Promise<AgentDefinition[]> {
    if (this.redis) {
      const ids = await this.redis.smembers(this.allAgentsKey());
      const agents: AgentDefinition[] = [];
      for (const id of ids) {
        const agent = await this.getAgent(id);
        if (agent) agents.push(agent);
      }
      for (const [id, agent] of this.memAgents) {
        if (!agents.find(a => a.id === id)) {
          agents.push(agent);
        }
      }
      return agents;
    }
    return Array.from(this.memAgents.values());
  }

  async createAgent(
    definition: Omit<AgentDefinition, 'id' | 'createdAt' | 'updatedAt' | 'version'>,
    createdBy: string
  ): Promise<AgentDefinition> {
    const id = definition.name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const agent: AgentDefinition = {
      ...definition,
      id,
      createdBy,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      performance: {
        tasksCompleted: 0,
        tasksSuccessful: 0,
        avgExecutionTime: 0,
        lastActive: new Date().toISOString(),
        learnings: [],
        improvements: [],
      },
    };

    if (this.redis) {
      await this.redis.set(this.agentKey(id), JSON.stringify(agent));
      await this.redis.sadd(this.allAgentsKey(), id);
    }

    this.memAgents.set(id, agent);
    await this.writeAgentToFile(agent);

    console.log(`[AgentRegistry] Created agent: ${agent.name} by ${createdBy}`);
    return agent;
  }

  async updateAgent(
    id: string,
    updates: Partial<Omit<AgentDefinition, 'id' | 'createdAt' | 'version'>>,
    updatedBy: string
  ): Promise<AgentDefinition | null> {
    const existing = await this.getAgent(id);
    if (!existing) return null;

    const updated: AgentDefinition = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
      version: existing.version + 1,
    };

    if (this.redis) {
      await this.redis.set(this.agentKey(id), JSON.stringify(updated));
    }
    this.memAgents.set(id, updated);
    await this.writeAgentToFile(updated);

    console.log(`[AgentRegistry] Updated agent: ${id} (v${updated.version}) by ${updatedBy}`);
    return updated;
  }

  private async writeAgentToFile(agent: AgentDefinition): Promise<void> {
    const agentsDir = join(this.repoPath, '.claude', 'agents');

    try {
      if (!existsSync(agentsDir)) {
        mkdirSync(agentsDir, { recursive: true });
      }

      const content = `---
name: ${agent.name}
description: ${agent.description}
tools: ${agent.tools.join(', ')}
model: sonnet
role: ${agent.role}
version: ${agent.version}
createdBy: ${agent.createdBy || 'system'}
---

# ${agent.name} Agent

${agent.systemPrompt}

## Capabilities
${agent.capabilities.map(c => `- ${c}`).join('\n')}

## Performance
- Tasks Completed: ${agent.performance?.tasksCompleted || 0}
- Success Rate: ${agent.performance ? Math.round((agent.performance.tasksSuccessful / Math.max(agent.performance.tasksCompleted, 1)) * 100) : 0}%
- Last Active: ${agent.performance?.lastActive || 'Never'}

## Learnings
${(agent.performance?.learnings || []).map(l => `- ${l}`).join('\n') || '- No learnings yet'}
`;

      writeFileSync(join(agentsDir, `${agent.id}.md`), content);
    } catch (err) {
      console.error(`[AgentRegistry] Failed to write agent file: ${agent.id}`, err);
    }
  }

  async recordTaskCompletion(
    agentId: string,
    success: boolean,
    executionTime: number,
    learnings?: string[]
  ): Promise<void> {
    const agent = await this.getAgent(agentId);
    if (!agent) return;

    const perf = agent.performance || {
      tasksCompleted: 0,
      tasksSuccessful: 0,
      avgExecutionTime: 0,
      lastActive: new Date().toISOString(),
      learnings: [],
      improvements: [],
    };

    perf.tasksCompleted++;
    if (success) perf.tasksSuccessful++;
    perf.avgExecutionTime = (perf.avgExecutionTime * (perf.tasksCompleted - 1) + executionTime) / perf.tasksCompleted;
    perf.lastActive = new Date().toISOString();

    if (learnings) {
      perf.learnings = [...perf.learnings, ...learnings].slice(-20);
    }

    await this.updateAgent(agentId, { performance: perf }, 'system');
  }

  async suggestImprovements(agentId: string): Promise<string[]> {
    const agent = await this.getAgent(agentId);
    if (!agent || !agent.performance) return [];

    const suggestions: string[] = [];
    const perf = agent.performance;

    const successRate = perf.tasksSuccessful / Math.max(perf.tasksCompleted, 1);
    if (successRate < 0.8 && perf.tasksCompleted > 5) {
      suggestions.push(`Success rate is ${Math.round(successRate * 100)}%. Consider reviewing failure patterns.`);
    }

    if (perf.avgExecutionTime > 60000) {
      suggestions.push(`Average execution time is ${Math.round(perf.avgExecutionTime / 1000)}s. Consider optimization.`);
    }

    if (perf.learnings.length > 10) {
      suggestions.push('Agent has accumulated significant learnings. Consider creating a specialized sub-agent.');
    }

    return suggestions;
  }

  async createSkill(
    name: string,
    description: string,
    prompt: string,
    createdBy: string
  ): Promise<SkillDefinition> {
    const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-');

    const skill: SkillDefinition = {
      id,
      name,
      description,
      prompt,
      createdBy,
      createdAt: new Date().toISOString(),
    };

    if (this.redis) {
      await this.redis.set(this.skillKey(id), JSON.stringify(skill));
      await this.redis.sadd(this.allSkillsKey(), id);
    }
    this.memSkills.set(id, skill);

    const commandsDir = join(this.repoPath, '.claude', 'commands');
    try {
      if (!existsSync(commandsDir)) {
        mkdirSync(commandsDir, { recursive: true });
      }
      writeFileSync(join(commandsDir, `${id}.md`), `# ${name}\n\n${description}\n\n${prompt}`);
    } catch (err) {
      console.error('[AgentRegistry] Failed to write skill file:', err);
    }

    console.log(`[AgentRegistry] Created skill: ${name} by ${createdBy}`);
    return skill;
  }

  async listSkills(): Promise<SkillDefinition[]> {
    if (this.redis) {
      const ids = await this.redis.smembers(this.allSkillsKey());
      const skills: SkillDefinition[] = [];
      for (const id of ids) {
        const data = await this.redis.get(this.skillKey(id));
        if (data) skills.push(JSON.parse(data));
      }
      return skills;
    }
    return Array.from(this.memSkills.values());
  }

  getRole(id: string): RoleDefinition | null {
    return this.memRoles.get(id) || null;
  }

  async canAgentPerform(agentId: string, action: 'createAgent' | 'createSkill' | 'modifyOthers'): Promise<boolean> {
    const agent = await this.getAgent(agentId);
    if (!agent) return false;

    const role = this.getRole(agent.role);
    if (!role) return false;

    switch (action) {
      case 'createAgent': return role.canCreateAgents;
      case 'createSkill': return role.canCreateSkills;
      case 'modifyOthers': return role.canModifyOthers;
      default: return false;
    }
  }

  async evolveAgent(
    parentId: string,
    improvements: string[],
    evolvedBy: string
  ): Promise<AgentDefinition | null> {
    const parent = await this.getAgent(parentId);
    if (!parent) return null;

    const evolved = await this.createAgent({
      name: `${parent.name} v${parent.version + 1}`,
      description: `${parent.description} (Evolved: ${improvements.join(', ')})`,
      role: parent.role,
      capabilities: [...parent.capabilities, ...improvements],
      tools: parent.tools,
      systemPrompt: parent.systemPrompt + `\n\n## Improvements (v${parent.version + 1})\n${improvements.map(i => `- ${i}`).join('\n')}`,
      parentAgent: parentId,
    }, evolvedBy);

    const parentPerf = parent.performance || {
      tasksCompleted: 0,
      tasksSuccessful: 0,
      avgExecutionTime: 0,
      lastActive: new Date().toISOString(),
      learnings: [],
      improvements: [],
    };
    parentPerf.improvements.push(`Evolved to ${evolved.id} on ${new Date().toISOString()}`);
    await this.updateAgent(parentId, { performance: parentPerf }, 'system');

    console.log(`[AgentRegistry] Evolved ${parentId} → ${evolved.id} by ${evolvedBy}`);
    return evolved;
  }

  getRules(): SelfImprovementRule[] {
    return Array.from(this.memRules.values());
  }

  getRule(id: string): SelfImprovementRule | null {
    return this.memRules.get(id) || null;
  }

  addRule(rule: SelfImprovementRule): void {
    this.memRules.set(rule.id, rule);
    console.log(`[AgentRegistry] Added/updated rule: ${rule.name}`);
  }

  async trackPattern(pattern: string, domain: string, example: string): Promise<PatternTracker> {
    const existing = this.patternTracker.get(pattern);
    const now = new Date().toISOString();

    if (existing) {
      existing.occurrences++;
      existing.lastSeen = now;
      existing.examples = [...existing.examples.slice(-4), example];
      this.patternTracker.set(pattern, existing);
    } else {
      const tracker: PatternTracker = {
        pattern,
        domain,
        occurrences: 1,
        examples: [example],
        firstSeen: now,
        lastSeen: now,
      };
      this.patternTracker.set(pattern, tracker);
    }

    return this.patternTracker.get(pattern)!;
  }

  getPatterns(): PatternTracker[] {
    return Array.from(this.patternTracker.values());
  }

  async evaluateRules(context: RuleContext): Promise<RuleEvaluation[]> {
    const evaluations: RuleEvaluation[] = [];
    const agent = context.agentId ? await this.getAgent(context.agentId) : null;

    const metrics: Record<string, number | string> = {
      ...context.metrics,
    };

    if (agent?.performance) {
      const perf = agent.performance;
      metrics.success_rate = perf.tasksSuccessful / Math.max(perf.tasksCompleted, 1);
      metrics.tasks_completed = perf.tasksCompleted;
      metrics.avg_execution_time = perf.avgExecutionTime;
      metrics.learnings_count = perf.learnings.length;
      metrics.agent_role = agent.role;
    }

    for (const rule of this.memRules.values()) {
      const conditionResults = rule.conditions.map(cond => {
        const value = metrics[cond.metric];
        if (value === undefined) return false;

        switch (cond.operator) {
          case 'gt': return typeof value === 'number' && value > (cond.value as number);
          case 'lt': return typeof value === 'number' && value < (cond.value as number);
          case 'gte': return typeof value === 'number' && value >= (cond.value as number);
          case 'lte': return typeof value === 'number' && value <= (cond.value as number);
          case 'eq': return value === cond.value;
          default: return false;
        }
      });

      if (conditionResults.every(r => r)) {
        evaluations.push({
          ruleId: rule.id,
          triggered: true,
          action: rule.action,
          reason: rule.description,
          autoApply: rule.autoApply,
        });
      }
    }

    return evaluations;
  }

  getSelfImprovementInstructions(canCreateAgents: boolean, canCreateSkills: boolean): string {
    const instructions: string[] = [
      '## Self-Improvement Capabilities\n',
    ];

    if (canCreateSkills) {
      instructions.push(`
### Creating Skills
When you notice a task pattern appearing frequently, you can create a reusable skill.
Include in your output:
\`\`\`
## New Skill Request
Name: [skill-name]
Description: [what it does]
Prompt: [the skill prompt]
\`\`\`
`);
    }

    if (canCreateAgents) {
      instructions.push(`
### Creating New Agents
As a manager, you can request new agent creation.
Include in your output:
\`\`\`
## New Agent Request
Name: [agent-name]
Role: [specialist/support]
Description: [agent's purpose]
Capabilities: [list of capabilities]
Tools: [required tools]
Reason: [why this agent is needed]
\`\`\`
`);
    }

    return instructions.join('\n');
  }

  async getSelfImprovementSummary(agentId: string): Promise<{
    triggeredRules: RuleEvaluation[];
    suggestions: string[];
    performanceInsights: string[];
  }> {
    const agent = await this.getAgent(agentId);
    if (!agent) {
      return { triggeredRules: [], suggestions: [], performanceInsights: [] };
    }

    const evaluations = await this.evaluateRules({ agentId });
    const triggeredRules = evaluations.filter(e => e.triggered);
    const suggestions = await this.suggestImprovements(agentId);

    const performanceInsights: string[] = [];
    if (agent.performance) {
      const perf = agent.performance;
      const successRate = perf.tasksSuccessful / Math.max(perf.tasksCompleted, 1);

      performanceInsights.push(`Tasks completed: ${perf.tasksCompleted}`);
      performanceInsights.push(`Success rate: ${Math.round(successRate * 100)}%`);
      performanceInsights.push(`Avg execution time: ${Math.round(perf.avgExecutionTime / 1000)}s`);
    }

    return {
      triggeredRules,
      suggestions: triggeredRules.map(r => r.reason),
      performanceInsights,
    };
  }
}

export const agentRegistry = new AgentRegistry();
