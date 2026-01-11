import { Controller, Get, Route, Tags } from 'tsoa';
import { SelfImprovementRule, agentRegistry } from '../agent-registry';

@Route('api/rules')
@Tags('Rules')
export class RulesController extends Controller {
  /**
   * List all self-improvement rules
   * @summary Get all rules
   */
  @Get()
  public async getRules(): Promise<SelfImprovementRule[]> {
    return agentRegistry.getRules();
  }
}
