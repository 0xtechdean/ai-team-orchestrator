/**
 * Agent Orchestrator
 * Coordinates AI agents to work on tasks collaboratively
 */

import Anthropic from '@anthropic-ai/sdk';
import { memoryService, MemoryService } from './memory';
import { taskDb, Task } from './taskdb';
import { agentRegistry } from './agent-registry';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

interface AgentContext {
  task: string;
  files?: string[];
  previousOutput?: string;
  taskId?: string;
}

export class AgentOrchestrator {
  private claude: Anthropic;
  private memory: MemoryService;
  private repoPath: string;
  private onNotification?: (message: string) => Promise<void>;

  constructor(options?: { onNotification?: (message: string) => Promise<void> }) {
    this.claude = new Anthropic();
    this.memory = memoryService;
    this.repoPath = process.env.REPO_PATH || process.cwd();
    this.onNotification = options?.onNotification;
  }

  getAgentRegistry(): typeof agentRegistry {
    return agentRegistry;
  }

  private async loadAgentDefinition(agentName: string): Promise<string> {
    const registryAgent = await agentRegistry.getAgent(agentName);
    if (registryAgent) {
      return registryAgent.systemPrompt;
    }

    const agentPath = join(this.repoPath, '.claude', 'agents', `${agentName}.md`);
    if (existsSync(agentPath)) {
      return readFileSync(agentPath, 'utf-8');
    }

    return `You are the ${agentName} agent.

Follow the task delegation rule: decompose complex tasks and delegate to specialists.
Update docs/status.md when you complete work.
Create handoffs in docs/handoffs/ when passing work to other agents.`;
  }

  private async loadProjectContext(): Promise<string> {
    const files = [
      'CLAUDE.md',
      'docs/status.md',
      'docs/sprint.md',
    ];

    let context = '';
    for (const file of files) {
      const filePath = join(this.repoPath, file);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8');
        context += `\n\n--- ${file} ---\n${content}`;
      }
    }

    return context;
  }

  async runAgent(agentName: string, task: string, context?: AgentContext): Promise<string> {
    console.log(`[Orchestrator] Running ${agentName} agent...`);
    const startTime = Date.now();

    const agentDef = await this.loadAgentDefinition(agentName);
    const projectContext = await this.loadProjectContext();
    const memoryContext = await this.memory.getTaskContext(agentName, task);

    const canCreateAgents = await agentRegistry.canAgentPerform(agentName, 'createAgent');
    const canCreateSkills = await agentRegistry.canAgentPerform(agentName, 'createSkill');

    const availableAgents = await agentRegistry.listAgents();
    const agentList = availableAgents.map(a => `- ${a.name} (${a.role}): ${a.description}`).join('\n');

    const selfImprovementInstructions = agentRegistry.getSelfImprovementInstructions(
      canCreateAgents,
      canCreateSkills
    );

    const ruleEvaluations = await agentRegistry.evaluateRules({
      agentId: agentName,
      taskType: task.split(' ')[0],
      taskDomain: this.detectDomain(task),
    });
    const triggeredSuggestions = ruleEvaluations
      .filter(e => e.triggered && !e.autoApply)
      .map(e => `- ${e.reason}`)
      .join('\n');

    const taskPattern = this.extractPattern(task);
    if (taskPattern) {
      await agentRegistry.trackPattern(taskPattern.pattern, taskPattern.domain, task);
    }

    const systemPrompt = `${agentDef}

## Current Project Context
${projectContext}
${memoryContext}

## Available Team Members
${agentList}

## Your Task
${task}

## Instructions

### BEFORE Starting (Required)
1. **Read the docs first** - Review these files to understand current state:
   - \`docs/status.md\` - Current sprint progress and blockers
   - \`docs/sprint.md\` - Sprint goals and story details
   - \`docs/handoffs/\` - Any relevant handoffs from other agents

### During Task
2. Analyze the task and break it down if needed
3. Execute the work or delegate to other agents
4. Create handoffs in \`docs/handoffs/\` if passing work to others

### AFTER Completing (Required)
5. **Update the docs** with your changes:
   - Update \`docs/status.md\` with your progress
   - Create a handoff file if next agent needs context
6. Report your results clearly
7. List 1-3 key learnings in a "## Learnings" section

${selfImprovementInstructions}

${triggeredSuggestions ? `
## Self-Improvement Suggestions
Based on current patterns and performance, consider:
${triggeredSuggestions}
` : ''}

Output your actions and results in a structured format.`;

    const response = await this.claude.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [
        { role: 'user', content: systemPrompt }
      ],
    });

    const result = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('\n');

    const executionTime = Date.now() - startTime;
    const learnings = this.extractLearnings(result);

    await this.processAgentRequests(agentName, result, canCreateAgents, canCreateSkills);

    const success = !result.toLowerCase().includes('failed') && !result.toLowerCase().includes('error');
    await agentRegistry.recordTaskCompletion(agentName, success, executionTime, learnings);

    await this.memory.recordTaskCompletion(
      agentName,
      context?.taskId || 'unknown',
      task.substring(0, 100),
      result,
      learnings
    );

    if (this.onNotification) {
      await this.onNotification(`Agent *${agentName}* completed task:\n${task}\n\n${result.substring(0, 500)}...`);
    }

    if (!['pm', 'eng-lead'].includes(agentName)) {
      this.planNextTasks(task, agentName, result).catch(err =>
        console.error('[Orchestrator] Planning failed:', err)
      );
    }

    return result;
  }

  private async processAgentRequests(
    agentName: string,
    result: string,
    canCreateAgents: boolean,
    canCreateSkills: boolean
  ): Promise<void> {
    if (canCreateAgents) {
      const agentMatch = result.match(/## New Agent Request\n([\s\S]*?)(?=\n##|$)/i);
      if (agentMatch) {
        const content = agentMatch[1];
        const nameMatch = content.match(/name:\s*(.+)/i);
        const descMatch = content.match(/description:\s*(.+)/i);
        const roleMatch = content.match(/role:\s*(.+)/i);
        const capsMatch = content.match(/capabilities:\s*(.+)/i);

        if (nameMatch && descMatch) {
          try {
            const newAgent = await agentRegistry.createAgent({
              name: nameMatch[1].trim(),
              description: descMatch[1].trim(),
              role: (roleMatch?.[1].trim() as 'manager' | 'specialist' | 'support') || 'specialist',
              capabilities: capsMatch ? capsMatch[1].split(',').map(c => c.trim()) : [],
              tools: ['Read', 'Write', 'Grep', 'Glob'],
              systemPrompt: `You are the ${nameMatch[1].trim()} agent.\n\n${descMatch[1].trim()}`,
            }, agentName);

            if (this.onNotification) {
              await this.onNotification(
                `New Agent Created: ${newAgent.name} (${newAgent.role}) by ${agentName}`
              );
            }
          } catch (err) {
            console.error('[Orchestrator] Failed to create agent:', err);
          }
        }
      }
    }

    if (canCreateSkills) {
      const skillMatch = result.match(/## New Skill Request\n([\s\S]*?)(?=\n##|$)/i);
      if (skillMatch) {
        const content = skillMatch[1];
        const nameMatch = content.match(/name:\s*(.+)/i);
        const descMatch = content.match(/description:\s*(.+)/i);
        const promptMatch = content.match(/prompt:\s*([\s\S]+?)(?=\n[a-z]+:|$)/i);

        if (nameMatch && descMatch && promptMatch) {
          try {
            const newSkill = await agentRegistry.createSkill(
              nameMatch[1].trim(),
              descMatch[1].trim(),
              promptMatch[1].trim(),
              agentName
            );

            if (this.onNotification) {
              await this.onNotification(
                `New Skill Created: ${newSkill.name} by ${agentName}`
              );
            }
          } catch (err) {
            console.error('[Orchestrator] Failed to create skill:', err);
          }
        }
      }
    }
  }

  private extractLearnings(result: string): string[] {
    const learnings: string[] = [];
    const learningsMatch = result.match(/## Learnings\n([\s\S]*?)(?=\n##|$)/i);

    if (learningsMatch) {
      const lines = learningsMatch[1].split('\n');
      for (const line of lines) {
        const cleaned = line.replace(/^[-*]\s*/, '').trim();
        if (cleaned.length > 10) {
          learnings.push(cleaned);
        }
      }
    }

    return learnings.slice(0, 3);
  }

  private detectDomain(task: string): string {
    const taskLower = task.toLowerCase();

    const domains: Record<string, string[]> = {
      'api': ['api', 'endpoint', 'webhook', 'graphql', 'rest'],
      'database': ['database', 'schema', 'prisma', 'postgres', 'redis', 'migration'],
      'frontend': ['ui', 'react', 'component', 'dashboard', 'page', 'view'],
      'backend': ['server', 'service', 'module', 'controller'],
      'ai': ['agent', 'claude', 'llm', 'ai', 'prompt', 'model'],
      'auth': ['auth', 'login', 'oauth', 'permission', 'token', 'session'],
      'testing': ['test', 'spec', 'mock', 'coverage', 'e2e'],
      'devops': ['deploy', 'ci', 'cd', 'docker', 'pipeline'],
    };

    for (const [domain, keywords] of Object.entries(domains)) {
      if (keywords.some(kw => taskLower.includes(kw))) {
        return domain;
      }
    }

    return 'general';
  }

  private extractPattern(task: string): { pattern: string; domain: string } | null {
    const patterns: Array<{ regex: RegExp; pattern: string; domain: string }> = [
      { regex: /implement\s+(\w+)\s+endpoint/i, pattern: 'implement-endpoint', domain: 'api' },
      { regex: /create\s+(\w+)\s+component/i, pattern: 'create-component', domain: 'frontend' },
      { regex: /add\s+(\w+)\s+service/i, pattern: 'add-service', domain: 'backend' },
      { regex: /fix\s+bug\s+in\s+(\w+)/i, pattern: 'fix-bug', domain: 'debugging' },
      { regex: /write\s+tests?\s+for\s+(\w+)/i, pattern: 'write-tests', domain: 'testing' },
      { regex: /update\s+(\w+)\s+schema/i, pattern: 'update-schema', domain: 'database' },
      { regex: /integrate\s+(\w+)/i, pattern: 'integration', domain: 'integration' },
      { regex: /refactor\s+(\w+)/i, pattern: 'refactor', domain: 'maintenance' },
      { regex: /deploy\s+to\s+(\w+)/i, pattern: 'deployment', domain: 'devops' },
    ];

    for (const { regex, pattern, domain } of patterns) {
      if (regex.test(task)) {
        return { pattern, domain };
      }
    }

    const domain = this.detectDomain(task);
    if (domain !== 'general') {
      return { pattern: `${domain}-task`, domain };
    }

    return null;
  }

  async planNextTasks(completedTask: string, completedBy: string, result: string): Promise<Task[]> {
    console.log('[Orchestrator] PM planning next tasks...');

    const currentTasks = await taskDb.listTasks('default');
    const recentMemories = await this.memory.getRecentMemories(undefined, 10);
    const projectContext = await this.loadProjectContext();

    const tasksContext = currentTasks.map(t =>
      `- [${t.status}] ${t.title} (${t.owner || 'unassigned'}, ${t.priority || 'no priority'})`
    ).join('\n');

    const memoryContext = recentMemories.length > 0
      ? recentMemories.map(m => `- ${m.memory}`).join('\n')
      : 'No recent memories';

    const response = await this.claude.messages.create({
      model: process.env.CLAUDE_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are the Product Manager for the AI team. A task just completed and you need to plan what happens next.

## Completed Task
**Task**: ${completedTask}
**Completed by**: ${completedBy}
**Result summary**: ${result.substring(0, 1000)}

## Current Task Board
${tasksContext}

## Recent Team Activity
${memoryContext}

## Project Context
${projectContext}

## Your Job
1. Analyze what was completed and what should come next
2. Consider dependencies - what tasks are now unblocked?
3. Identify any new tasks that should be created

Return a JSON object with:
{
  "analysis": "Brief analysis of the completed work",
  "readyTasks": ["task_id1", "task_id2"],
  "newTasks": [
    {"title": "Task title", "description": "Details", "owner": "agent_name", "priority": "P0|P1|P2"}
  ],
  "nextAgent": "agent_name",
  "nextTask": "task description"
}

Only return the JSON, no other text.`
        }
      ],
    });

    const resultText = response.content
      .filter(block => block.type === 'text')
      .map(block => (block as { type: 'text'; text: string }).text)
      .join('');

    try {
      const plan = JSON.parse(resultText);
      console.log('[Orchestrator] PM analysis:', plan.analysis);

      for (const taskId of plan.readyTasks || []) {
        await taskDb.updateTask(taskId, { status: 'ready' });
        console.log(`[Orchestrator] Marked task ${taskId} as ready`);
      }

      const createdTasks: Task[] = [];
      for (const newTask of plan.newTasks || []) {
        const task = await taskDb.createTask(
          'default',
          newTask.title,
          newTask.description,
          newTask.owner,
          newTask.priority
        );
        createdTasks.push(task);
        console.log(`[Orchestrator] Created new task: ${task.title}`);
      }

      if (plan.nextAgent && plan.nextTask) {
        console.log(`[Orchestrator] Triggering ${plan.nextAgent} for: ${plan.nextTask}`);
        setTimeout(() => {
          this.runAgent(plan.nextAgent, plan.nextTask).catch(err =>
            console.error('[Orchestrator] Follow-up task failed:', err)
          );
        }, 1000);
      }

      return createdTasks;
    } catch (err) {
      console.error('[Orchestrator] Failed to parse PM response:', err);
      return [];
    }
  }

  async runSprintCheck(): Promise<string> {
    console.log('[Orchestrator] Running sprint check...');

    const tasks = await taskDb.listTasks('default', 'ready');
    if (tasks.length === 0) {
      return 'No ready tasks found';
    }

    const nextTask = tasks[0];
    if (nextTask.owner) {
      console.log(`[Orchestrator] Starting task: ${nextTask.title} with ${nextTask.owner}`);

      await taskDb.updateTask(nextTask.id, { status: 'in_progress' });

      const result = await this.runAgent(
        nextTask.owner,
        nextTask.title + (nextTask.description ? `: ${nextTask.description}` : '')
      );

      await taskDb.updateTask(nextTask.id, { status: 'done' });

      return `Completed: ${nextTask.title}`;
    }

    return 'Next task has no owner assigned';
  }

  async runDailyStandup(): Promise<string> {
    console.log('[Orchestrator] Running daily standup...');
    return this.runAgent('pm', 'Conduct daily standup: review progress, identify blockers, plan today\'s priorities');
  }
}
