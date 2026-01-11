import { Body, Controller, Delete, Get, Patch, Path, Post, Query, Response, Route, Tags } from 'tsoa';
import { Task, taskDb } from '../taskdb';
import { ErrorResponse } from '../types/api';

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
    const task = await taskDb.updateTask(taskId, body);
    if (!task) {
      this.setStatus(404);
      throw new Error('Task not found');
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
