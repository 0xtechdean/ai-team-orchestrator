import { Body, Controller, Delete, Get, Patch, Path, Post, Query, Response, Route, Tags } from 'tsoa';
import { Task, taskDb } from '../taskdb';
import { ErrorResponse } from '../types/api';
import { getOrchestrator } from './orchestration.controller';

interface CreateTaskRequest {
  title: string;
  description?: string;
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
}

interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: 'backlog' | 'ready' | 'in_progress' | 'done';
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
  output?: string;
  startedAt?: string;
  completedAt?: string;
}

@Route('api')
@Tags('Tasks')
export class TasksController extends Controller {
  /**
   * List tasks for a project
   * @summary Get project tasks
   * @param projectId Project ID
   * @param status Optional status filter
   */
  @Get('projects/{projectId}/tasks')
  public async getProjectTasks(
    @Path() projectId: string,
    @Query() status?: string
  ): Promise<Task[]> {
    return taskDb.listTasks(projectId, status);
  }

  /**
   * Create a new task in a project
   * @summary Create task
   */
  @Post('projects/{projectId}/tasks')
  public async createTask(
    @Path() projectId: string,
    @Body() body: CreateTaskRequest
  ): Promise<Task> {
    this.setStatus(201);
    return taskDb.createTask(projectId, body.title, body.description, body.owner, body.priority);
  }

  /**
   * Get a specific task by ID
   * @summary Get task
   */
  @Get('tasks/{taskId}')
  @Response<ErrorResponse>(404, 'Task not found')
  public async getTask(@Path() taskId: string): Promise<Task> {
    const task = await taskDb.getTask(taskId);
    if (!task) {
      this.setStatus(404);
      throw new Error('Task not found');
    }
    return task;
  }

  /**
   * Update an existing task
   * @summary Update task
   */
  @Patch('tasks/{taskId}')
  @Response<ErrorResponse>(404, 'Task not found')
  public async updateTask(
    @Path() taskId: string,
    @Body() body: UpdateTaskRequest
  ): Promise<Task> {
    // Get current task to check if status is changing to ready
    const currentTask = await taskDb.getTask(taskId);

    const task = await taskDb.updateTask(taskId, body);
    if (!task) {
      this.setStatus(404);
      throw new Error('Task not found');
    }

    // If task was moved to "ready" and has an owner, trigger agent execution
    // This works for both new tasks and tasks returned to backlog and moved to ready again
    if (body.status === 'ready' && currentTask?.status !== 'ready' && task.owner) {
      console.log(`[TasksController] Task ${taskId} moved to ready - triggering ${task.owner} agent`);

      // Update status to in_progress immediately
      await taskDb.updateTask(taskId, {
        status: 'in_progress',
        startedAt: new Date().toISOString()
      });

      // Run agent asynchronously (don't wait for completion)
      const orchestrator = getOrchestrator();
      if (orchestrator) {
        orchestrator.runAgent(
          task.owner,
          `${task.title}${task.description ? `: ${task.description}` : ''}`,
          { taskId }
        ).then(async (result) => {
          // Mark task as done when agent completes
          await taskDb.updateTask(taskId, {
            status: 'done',
            output: result.substring(0, 10000),
            completedAt: new Date().toISOString()
          });
          console.log(`[TasksController] Task ${taskId} completed by ${task.owner}`);
        }).catch(async (err) => {
          // Mark task as failed - move back to backlog so it can be retried
          await taskDb.updateTask(taskId, {
            status: 'backlog',
            output: `Error: ${err.message}`
          });
          console.error(`[TasksController] Task ${taskId} failed:`, err.message);
        });
      }
    }

    return task;
  }

  /**
   * Delete a task
   * @summary Delete task
   */
  @Delete('tasks/{taskId}')
  @Response<ErrorResponse>(404, 'Task not found')
  public async deleteTask(@Path() taskId: string): Promise<void> {
    const deleted = await taskDb.deleteTask(taskId);
    if (!deleted) {
      this.setStatus(404);
      throw new Error('Task not found');
    }
    this.setStatus(204);
  }
}
