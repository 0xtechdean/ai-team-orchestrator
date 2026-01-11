/**
 * Agent Session Manager
 * Manages persistent Claude CLI sessions for each agent type
 * Similar to how you're talking to me right now - each agent has its own ongoing conversation
 */

import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { Readable, Writable } from 'stream';
import * as readline from 'readline';

interface AgentSession {
  agentName: string;
  process: ChildProcess;
  systemPrompt: string;
  ready: boolean;
  busy: boolean;
  messageQueue: Array<{
    message: string;
    resolve: (response: string) => void;
    reject: (error: Error) => void;
  }>;
  currentResponse: string;
  rl: readline.Interface | null;
}

export class AgentSessionManager extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private shutdownFlag = false;

  /**
   * Start a persistent Claude session for an agent
   */
  async startSession(agentName: string, systemPrompt: string): Promise<boolean> {
    if (this.sessions.has(agentName)) {
      console.log(`[Sessions] Agent ${agentName} already has a session`);
      return true;
    }

    console.log(`[Sessions] Starting session for agent: ${agentName}`);

    return new Promise((resolve) => {
      // Spawn Claude in interactive mode with the system prompt
      const child = spawn('claude', [
        '--model', 'sonnet',
        '--system-prompt', systemPrompt,
        '--dangerously-skip-permissions',
      ], {
        env: {
          ...process.env,
          CI: 'true',
          CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const session: AgentSession = {
        agentName,
        process: child,
        systemPrompt,
        ready: false,
        busy: false,
        messageQueue: [],
        currentResponse: '',
        rl: null,
      };

      // Set up readline to detect complete responses
      if (child.stdout) {
        session.rl = readline.createInterface({
          input: child.stdout,
          terminal: false,
        });

        let buffer = '';
        session.rl.on('line', (line) => {
          buffer += line + '\n';

          // Check if response is complete (Claude shows prompt indicator)
          // In non-TTY mode, responses end after the full output
          session.currentResponse += line + '\n';
        });
      }

      child.stdout?.on('data', (data) => {
        const text = data.toString();
        console.log(`[Sessions] ${agentName} stdout:`, text.substring(0, 100));

        if (!session.ready) {
          // First output means session is ready
          session.ready = true;
          console.log(`[Sessions] Agent ${agentName} session ready`);
          resolve(true);
        }
      });

      child.stderr?.on('data', (data) => {
        console.error(`[Sessions] ${agentName} stderr:`, data.toString());
      });

      child.on('error', (err) => {
        console.error(`[Sessions] Agent ${agentName} error:`, err);
        this.sessions.delete(agentName);
        resolve(false);
      });

      child.on('exit', (code) => {
        console.log(`[Sessions] Agent ${agentName} exited with code ${code}`);
        this.sessions.delete(agentName);

        // Restart if not shutting down
        if (!this.shutdownFlag) {
          console.log(`[Sessions] Restarting agent ${agentName}...`);
          setTimeout(() => this.startSession(agentName, systemPrompt), 2000);
        }
      });

      this.sessions.set(agentName, session);

      // Timeout for initial startup
      setTimeout(() => {
        if (!session.ready) {
          console.error(`[Sessions] Agent ${agentName} failed to start`);
          child.kill();
          resolve(false);
        }
      }, 60000);
    });
  }

  /**
   * Send a task to an agent and get the response
   */
  async sendTask(agentName: string, task: string, timeout: number = 300000): Promise<string> {
    const session = this.sessions.get(agentName);

    if (!session || !session.ready) {
      throw new Error(`Agent ${agentName} session not available`);
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Task timeout for agent ${agentName}`));
      }, timeout);

      session.currentResponse = '';

      // Send the task
      console.log(`[Sessions] Sending task to ${agentName}: ${task.substring(0, 50)}...`);
      session.process.stdin?.write(task + '\n');

      // Collect response until we detect completion
      const checkComplete = setInterval(() => {
        // Check for response completion patterns
        const response = session.currentResponse;

        // Claude typically ends responses with certain patterns
        if (response.length > 0 && (
          response.includes('\n\n') || // Double newline often indicates end
          response.endsWith('```\n') || // Code block end
          response.length > 100 // Some response received
        )) {
          clearInterval(checkComplete);
          clearTimeout(timer);

          // Wait a bit more to ensure complete
          setTimeout(() => {
            resolve(session.currentResponse.trim());
            session.currentResponse = '';
          }, 1000);
        }
      }, 500);
    });
  }

  /**
   * Get status of all sessions
   */
  getStatus(): Record<string, { ready: boolean; busy: boolean }> {
    const status: Record<string, { ready: boolean; busy: boolean }> = {};

    for (const [name, session] of this.sessions) {
      status[name] = {
        ready: session.ready,
        busy: session.busy,
      };
    }

    return status;
  }

  /**
   * Check if an agent has an active session
   */
  hasSession(agentName: string): boolean {
    return this.sessions.has(agentName) && this.sessions.get(agentName)!.ready;
  }

  /**
   * Shutdown all sessions
   */
  async shutdown(): Promise<void> {
    this.shutdownFlag = true;
    console.log('[Sessions] Shutting down all agent sessions...');

    for (const [name, session] of this.sessions) {
      console.log(`[Sessions] Stopping ${name}...`);
      session.process.kill('SIGTERM');
    }

    this.sessions.clear();
  }
}

// Singleton instance
export const agentSessions = new AgentSessionManager();
