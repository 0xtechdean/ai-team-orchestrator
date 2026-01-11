import { Body, Controller, Delete, Get, Patch, Path, Post, Response, Route, Tags } from 'tsoa';
import { AgentDefinition, AgentPerformance, agentRegistry } from '../agent-registry';
import { ErrorResponse } from '../types/api';

interface CreateAgentRequest {
  name: string;
  description: string;
  role: 'manager' | 'specialist' | 'support';
  capabilities: string[];
  tools: string[];
  systemPrompt: string;
  createdBy?: string;
}

interface UpdateAgentRequest {
  name?: string;
  description?: string;
  role?: 'manager' | 'specialist' | 'support';
  capabilities?: string[];
  tools?: string[];
  systemPrompt?: string;
  updatedBy?: string;
}

@Route('api/agents')
@Tags('Agents')
export class AgentsController extends Controller {
  /**
   * List all agents
   * @summary Get all agents
   */
  @Get()
  public async getAgents(): Promise<AgentDefinition[]> {
    return agentRegistry.listAgents();
  }

  /**
   * Get a specific agent by ID
   * @summary Get agent
   */
  @Get('{agentId}')
  @Response<ErrorResponse>(404, 'Agent not found')
  public async getAgent(@Path() agentId: string): Promise<AgentDefinition> {
    const agent = await agentRegistry.getAgent(agentId);
    if (!agent) {
      this.setStatus(404);
      throw new Error('Agent not found');
    }
    return agent;
  }

  /**
   * Create a new agent
   * @summary Create agent
   */
  @Post()
  public async createAgent(@Body() body: CreateAgentRequest): Promise<AgentDefinition> {
    const { createdBy, ...agentDef } = body;
    this.setStatus(201);
    return agentRegistry.createAgent(agentDef, createdBy || 'api');
  }

  /**
   * Update an existing agent
   * @summary Update agent
   */
  @Patch('{agentId}')
  @Response<ErrorResponse>(404, 'Agent not found')
  public async updateAgent(
    @Path() agentId: string,
    @Body() body: UpdateAgentRequest
  ): Promise<AgentDefinition> {
    const { updatedBy, ...updates } = body;
    const agent = await agentRegistry.updateAgent(agentId, updates, updatedBy || 'api');
    if (!agent) {
      this.setStatus(404);
      throw new Error('Agent not found');
    }
    return agent;
  }

  /**
   * Delete an agent
   * @summary Delete agent
   */
  @Delete('{agentId}')
  @Response<ErrorResponse>(404, 'Agent not found')
  public async deleteAgent(@Path() agentId: string): Promise<void> {
    await agentRegistry.deleteAgent(agentId);
    this.setStatus(204);
  }

  /**
   * Get agent performance metrics
   * @summary Get agent performance
   */
  @Get('{agentId}/performance')
  @Response<ErrorResponse>(404, 'Agent not found')
  public async getAgentPerformance(@Path() agentId: string): Promise<AgentPerformance | null> {
    return agentRegistry.getAgentPerformance(agentId);
  }
}
