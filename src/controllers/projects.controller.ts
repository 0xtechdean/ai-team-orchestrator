import { Body, Controller, Get, Path, Post, Route, Tags } from 'tsoa';
import { Project, taskDb } from '../taskdb';

interface CreateProjectRequest {
  name: string;
  description?: string;
}

interface ProjectStats {
  total: number;
  byStatus: Record<string, number>;
}

@Route('api/projects')
@Tags('Projects')
export class ProjectsController extends Controller {
  /**
   * List all projects
   * @summary Get all projects
   */
  @Get()
  public async getProjects(): Promise<Project[]> {
    return taskDb.listProjects();
  }

  /**
   * Create a new project
   * @summary Create project
   */
  @Post()
  public async createProject(@Body() body: CreateProjectRequest): Promise<Project> {
    this.setStatus(201);
    return taskDb.createProject(body.name, body.description);
  }

  /**
   * Get project statistics
   * @summary Get stats for a project
   */
  @Get('{projectId}/stats')
  public async getProjectStats(@Path() projectId: string): Promise<ProjectStats> {
    return taskDb.getStats(projectId);
  }
}
