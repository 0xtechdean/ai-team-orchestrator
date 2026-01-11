import { Controller, Get, Route, Tags } from 'tsoa';

interface HealthResponse {
  status: string;
  timestamp: string;
  slack: boolean;
  database: boolean;
  claude: {
    useClaudeCode: boolean;
    hasOAuthToken: boolean;
    hasApiKey: boolean;
    tokenPreview: string | null;
  };
}

@Route('health')
@Tags('Health')
export class HealthController extends Controller {
  /**
   * Health check endpoint
   * @summary Get service health status
   */
  @Get()
  public async getHealth(): Promise<HealthResponse> {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      slack: !!process.env.SLACK_BOT_TOKEN,
      database: !!process.env.DATABASE_URL,
      claude: {
        useClaudeCode: process.env.USE_CLAUDE_CODE === 'true',
        hasOAuthToken: !!process.env.CLAUDE_CODE_OAUTH_TOKEN,
        hasApiKey: !!process.env.ANTHROPIC_API_KEY,
        tokenPreview: process.env.CLAUDE_CODE_OAUTH_TOKEN
          ? `${process.env.CLAUDE_CODE_OAUTH_TOKEN.substring(0, 15)}...`
          : null,
      },
    };
  }
}
