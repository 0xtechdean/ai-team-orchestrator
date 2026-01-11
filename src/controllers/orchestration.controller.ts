import { Body, Controller, Post, Route, Tags } from 'tsoa';
import { AgentOrchestrator } from '../orchestrator';

// Shared orchestrator instance - will be set from index.ts
let orchestratorInstance: AgentOrchestrator | null = null;

export function setOrchestrator(orchestrator: AgentOrchestrator) {
  orchestratorInstance = orchestrator;
}

export function getOrchestrator(): AgentOrchestrator | null {
  return orchestratorInstance;
}

interface RunAgentRequest {
  agentName: string;
  task: string;
  context?: Record<string, unknown>;
  slackUserId?: string;
}

interface RunAgentResponse {
  result: string;
}

interface SprintCheckRequest {
  slackUserId?: string;
}

interface DailyStandupRequest {
  slackUserId?: string;
}

@Route('api')
@Tags('Orchestration')
export class OrchestrationController extends Controller {
  /**
   * Run an agent with a specific task
   * @summary Execute agent task
   */
  @Post('run-agent')
  public async runAgent(@Body() body: RunAgentRequest): Promise<RunAgentResponse> {
    if (!orchestratorInstance) {
      this.setStatus(500);
      throw new Error('Orchestrator not initialized');
    }

    if (!body.agentName || !body.task) {
      this.setStatus(400);
      throw new Error('agentName and task are required');
    }

    const result = await orchestratorInstance.runAgent(body.agentName, body.task, {
      ...body.context,
      slackUserId: body.slackUserId,
    });

    return { result };
  }

  /**
   * Run sprint check
   * @summary Execute sprint check
   */
  @Post('sprint-check')
  public async sprintCheck(@Body() body: SprintCheckRequest): Promise<RunAgentResponse> {
    if (!orchestratorInstance) {
      this.setStatus(500);
      throw new Error('Orchestrator not initialized');
    }

    const result = await orchestratorInstance.runSprintCheck(body.slackUserId);
    return { result };
  }

  /**
   * Run daily standup
   * @summary Execute daily standup
   */
  @Post('daily-standup')
  public async dailyStandup(@Body() body: DailyStandupRequest): Promise<RunAgentResponse> {
    if (!orchestratorInstance) {
      this.setStatus(500);
      throw new Error('Orchestrator not initialized');
    }

    const result = await orchestratorInstance.runDailyStandup(body.slackUserId);
    return { result };
  }
}
