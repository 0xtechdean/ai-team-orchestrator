import { Body, Controller, Get, Post, Route, Tags } from 'tsoa';
import { SkillDefinition, agentRegistry } from '../agent-registry';

interface CreateSkillRequest {
  name: string;
  description: string;
  prompt: string;
  createdBy?: string;
}

@Route('api/skills')
@Tags('Skills')
export class SkillsController extends Controller {
  /**
   * List all skills
   * @summary Get all skills
   */
  @Get()
  public async getSkills(): Promise<SkillDefinition[]> {
    return agentRegistry.listSkills();
  }

  /**
   * Create a new skill
   * @summary Create skill
   */
  @Post()
  public async createSkill(@Body() body: CreateSkillRequest): Promise<SkillDefinition> {
    this.setStatus(201);
    return agentRegistry.createSkill(
      body.name,
      body.description,
      body.prompt,
      body.createdBy || 'api'
    );
  }
}
