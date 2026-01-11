/**
 * Claude CLI Pool Manager
 * Pre-spawns Claude CLI instances at startup for faster agent execution
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

interface PooledClaude {
  id: string;
  process: ChildProcess;
  busy: boolean;
  agentName?: string;
  createdAt: Date;
}

interface TaskResult {
  success: boolean;
  output: string;
  error?: string;
}

export class ClaudePool extends EventEmitter {
  private pool: Map<string, PooledClaude> = new Map();
  private taskQueue: Array<{
    prompt: string;
    resolve: (result: TaskResult) => void;
    timeout: number;
  }> = [];
  private poolSize: number;
  private isShuttingDown = false;

  constructor(poolSize: number = 3) {
    super();
    this.poolSize = poolSize;
  }

  async initialize(): Promise<void> {
    console.log(`[ClaudePool] Initializing pool with ${this.poolSize} instances...`);

    const promises = [];
    for (let i = 0; i < this.poolSize; i++) {
      promises.push(this.spawnInstance(`pool-${i}`));
    }

    await Promise.all(promises);
    console.log(`[ClaudePool] Pool ready with ${this.pool.size} instances`);
  }

  private async spawnInstance(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const hasToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;

      if (!hasToken) {
        console.warn(`[ClaudePool] No CLAUDE_CODE_OAUTH_TOKEN set, instance ${id} may fail`);
      }

      // Start Claude in conversation mode (not print mode)
      // We'll use stdin/stdout to communicate
      const child = spawn('claude', [
        '--model', 'sonnet',
        '--dangerously-skip-permissions',
        '--verbose',
      ], {
        env: {
          ...process.env,
          CI: 'true',
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const pooledInstance: PooledClaude = {
        id,
        process: child,
        busy: false,
        createdAt: new Date(),
      };

      child.on('error', (err) => {
        console.error(`[ClaudePool] Instance ${id} error:`, err.message);
        this.pool.delete(id);
        reject(err);
      });

      child.on('exit', (code) => {
        console.log(`[ClaudePool] Instance ${id} exited with code ${code}`);
        this.pool.delete(id);

        // Respawn if not shutting down
        if (!this.isShuttingDown && this.pool.size < this.poolSize) {
          setTimeout(() => this.spawnInstance(`pool-${Date.now()}`), 1000);
        }
      });

      // Wait for instance to be ready (first output)
      let initialized = false;
      child.stdout.once('data', () => {
        if (!initialized) {
          initialized = true;
          this.pool.set(id, pooledInstance);
          console.log(`[ClaudePool] Instance ${id} ready`);
          resolve();
        }
      });

      // Timeout if instance doesn't start
      setTimeout(() => {
        if (!initialized) {
          child.kill();
          reject(new Error(`Instance ${id} failed to initialize`));
        }
      }, 30000);
    });
  }

  async runTask(prompt: string, timeout: number = 300000): Promise<TaskResult> {
    // Find an available instance
    const available = Array.from(this.pool.values()).find(p => !p.busy);

    if (!available) {
      // Queue the task
      return new Promise((resolve) => {
        this.taskQueue.push({ prompt, resolve, timeout });
        console.log(`[ClaudePool] Task queued, ${this.taskQueue.length} in queue`);
      });
    }

    return this.executeTask(available, prompt, timeout);
  }

  private async executeTask(
    instance: PooledClaude,
    prompt: string,
    timeout: number
  ): Promise<TaskResult> {
    return new Promise((resolve) => {
      instance.busy = true;
      let output = '';
      let completed = false;

      const timer = setTimeout(() => {
        if (!completed) {
          completed = true;
          instance.busy = false;
          resolve({
            success: false,
            output,
            error: 'Timeout exceeded',
          });
          this.processQueue();
        }
      }, timeout);

      const onData = (data: Buffer) => {
        output += data.toString();
        // Check for completion marker (Claude outputs a specific pattern when done)
        if (output.includes('\n> ') || output.includes('╭─')) {
          // Response complete
          if (!completed) {
            completed = true;
            clearTimeout(timer);
            instance.busy = false;
            resolve({
              success: true,
              output: output.trim(),
            });
            this.processQueue();
          }
        }
      };

      instance.process.stdout?.on('data', onData);
      instance.process.stderr?.on('data', (data) => {
        console.error(`[ClaudePool] Instance ${instance.id} stderr:`, data.toString());
      });

      // Send the prompt
      instance.process.stdin?.write(prompt + '\n');
    });
  }

  private processQueue(): void {
    if (this.taskQueue.length === 0) return;

    const available = Array.from(this.pool.values()).find(p => !p.busy);
    if (!available) return;

    const task = this.taskQueue.shift();
    if (task) {
      this.executeTask(available, task.prompt, task.timeout).then(task.resolve);
    }
  }

  getStatus(): { total: number; available: number; busy: number; queued: number } {
    const instances = Array.from(this.pool.values());
    return {
      total: instances.length,
      available: instances.filter(p => !p.busy).length,
      busy: instances.filter(p => p.busy).length,
      queued: this.taskQueue.length,
    };
  }

  async shutdown(): Promise<void> {
    this.isShuttingDown = true;
    console.log('[ClaudePool] Shutting down...');

    for (const instance of this.pool.values()) {
      instance.process.kill('SIGTERM');
    }

    this.pool.clear();
    this.taskQueue = [];
  }
}

// Singleton instance
export const claudePool = new ClaudePool(
  parseInt(process.env.CLAUDE_POOL_SIZE || '2', 10)
);
