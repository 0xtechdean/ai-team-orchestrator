import { Body, Controller, Delete, Get, Patch, Path, Post, Query, Response, Route, Tags } from 'tsoa';
import { Task, taskDb } from '../taskdb';
import { ErrorResponse } from '../types/api';
import { getOrchestrator } from './orchestration.controller';
import { gitService } from '../git-service';

interface CreateTaskRequest {
  title: string;
  description?: string;
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
}

interface UpdateTaskRequest {
  title?: string;
  description?: string;
  status?: 'backlog' | 'ready' | 'in_progress' | 'pr_created' | 'done';
  owner?: string;
  priority?: 'P0' | 'P1' | 'P2';
  output?: string;
  startedAt?: string;
  completedAt?: string;
  // Git workflow fields (AG-10)
  branch?: string;
  prUrl?: string;
  prNumber?: number;
  prStatus?: 'open' | 'approved' | 'merged' | 'closed';
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

      // AG-10: Create a branch for this task
      let branchName: string | undefined;
      if (gitService.isConfigured()) {
        const branchResult = await gitService.createBranch(taskId, task.title);
        if (branchResult.success && branchResult.branch) {
          branchName = branchResult.branch;
          console.log(`[TasksController] Created branch: ${branchName}`);
        } else {
          console.warn(`[TasksController] Branch creation failed: ${branchResult.error}`);
        }
      }

      // Update status to in_progress with branch info
      await taskDb.updateTask(taskId, {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
        branch: branchName,
      });

      // Run agent asynchronously (don't wait for completion)
      const orchestrator = getOrchestrator();
      if (orchestrator) {
        orchestrator.runAgent(
          task.owner,
          `${task.title}${task.description ? `: ${task.description}` : ''}`,
          { taskId, branch: branchName }
        ).then(async (result) => {
          // AG-10: Create PR when agent completes (if git is configured)
          if (branchName && gitService.isConfigured()) {
            // Commit any changes made by agent
            await gitService.createCommit(taskId, `Complete: ${task.title}`);

            // Create PR
            const prResult = await gitService.createPR(
              taskId,
              task.title,
              task.description || result.substring(0, 500),
              branchName
            );

            if (prResult.success && prResult.prUrl && prResult.prNumber) {
              // Update task with PR info and set status to pr_created
              await taskDb.updateTask(taskId, {
                status: 'pr_created',
                output: result.substring(0, 10000),
                prUrl: prResult.prUrl,
                prNumber: prResult.prNumber,
                prStatus: 'open',
              });
              console.log(`[TasksController] Task ${taskId} PR created: ${prResult.prUrl}`);
              return;
            } else {
              console.warn(`[TasksController] PR creation failed: ${prResult.error}`);
            }
          }

          // Fallback: Mark task as done if no PR workflow
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
