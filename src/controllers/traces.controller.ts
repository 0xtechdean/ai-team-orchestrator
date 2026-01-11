import { Body, Controller, Get, Path, Post, Query, Route, Tags } from 'tsoa';
import { Trace, taskDb } from '../taskdb';

interface CreateTraceRequest {
  agentName: string;
  eventType: 'start' | 'tool_call' | 'llm_call' | 'message' | 'error' | 'complete';
  content: string;
  metadata?: Record<string, unknown>;
  tokens?: number;
  latencyMs?: number;
}

interface TraceStats {
  totalTraces: number;
  totalTokens: number;
  totalLatencyMs: number;
  byEventType: Record<string, number>;
}

@Route('api')
@Tags('Traces')
export class TracesController extends Controller {
  /**
   * Log a trace event for a task
   * @summary Create trace
   */
  @Post('tasks/{taskId}/traces')
  public async createTrace(
    @Path() taskId: string,
    @Body() body: CreateTraceRequest
  ): Promise<Trace> {
    if (!body.agentName || !body.eventType || !body.content) {
      this.setStatus(400);
      throw new Error('agentName, eventType, and content are required');
    }

    this.setStatus(201);
    return taskDb.logTrace(
      taskId,
      body.agentName,
      body.eventType,
      body.content,
      body.metadata,
      body.tokens,
      body.latencyMs
    );
  }

  /**
   * Get all traces for a task
   * @summary Get task traces
   */
  @Get('tasks/{taskId}/traces')
  public async getTaskTraces(
    @Path() taskId: string,
    @Query() limit?: number
  ): Promise<Trace[]> {
    return taskDb.getTraces(taskId, limit || 100);
  }

  /**
   * Get trace statistics for a task
   * @summary Get trace stats
   */
  @Get('tasks/{taskId}/traces/stats')
  public async getTaskTraceStats(@Path() taskId: string): Promise<TraceStats> {
    return taskDb.getTraceStats(taskId);
  }

  /**
   * Get recent traces across all tasks
   * @summary Get recent traces
   */
  @Get('traces/recent')
  public async getRecentTraces(@Query() limit?: number): Promise<Trace[]> {
    return taskDb.getRecentTraces(limit || 50);
  }
}
