/**
 * Claude Code Runner
 * Runs Claude Code CLI for agent tasks using Pro subscription
 */

import { spawn } from 'child_process';
import { join } from 'path';

// Pre-warm flag to avoid repeated cold starts
let preWarmed = false;

/**
 * Pre-warm the Claude CLI by running a simple command
 * This loads the CLI into memory and validates authentication
 */
export async function preWarmClaude(): Promise<boolean> {
  if (preWarmed) return true;

  console.log('[ClaudeRunner] Pre-warming Claude CLI...');
  const result = await runClaudeCode('Say "ready" in one word', {
    timeout: 60000,
  });

  if (result.success) {
    preWarmed = true;
    console.log('[ClaudeRunner] Pre-warm successful');
    return true;
  } else {
    console.error('[ClaudeRunner] Pre-warm failed:', result.error);
    return false;
  }
}

interface ClaudeRunResult {
  success: boolean;
  output: string;
  error?: string;
}

export async function runClaudeCode(
  prompt: string,
  options: {
    systemPrompt?: string;
    workingDir?: string;
    timeout?: number;
    model?: string;
  } = {}
): Promise<ClaudeRunResult> {
  const {
    systemPrompt,
    workingDir = process.cwd(),
    timeout = 300000, // 5 minutes default
    model = 'sonnet',
  } = options;

  return new Promise((resolve) => {
    const args = [
      '-p', // Print mode (non-interactive)
      '--model', model,
      '--dangerously-skip-permissions', // Skip all permission prompts
    ];

    if (systemPrompt) {
      args.push('--system-prompt', systemPrompt);
    }

    // Add the prompt
    args.push(prompt);

    const hasToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    console.log(`[ClaudeRunner] Running with model: ${model}`);
    console.log(`[ClaudeRunner] OAuth token present: ${hasToken}`);
    console.log(`[ClaudeRunner] Token preview: ${hasToken ? process.env.CLAUDE_CODE_OAUTH_TOKEN?.substring(0, 20) + '...' : 'none'}`);
    console.log(`[ClaudeRunner] Prompt: ${prompt.substring(0, 100)}...`);

    const child = spawn('claude', args, {
      cwd: workingDir,
      env: {
        ...process.env,
        // Disable interactive features
        CI: 'true',
        // Use OAuth token from setup-token command
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
      },
      // IMPORTANT: stdin must be inherited or Claude CLI hangs
      // It checks for TTY on stdin before proceeding
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({
        success: false,
        output: stdout,
        error: 'Timeout exceeded',
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);

      if (code === 0) {
        console.log(`[ClaudeRunner] Success, output length: ${stdout.length}`);
        resolve({
          success: true,
          output: stdout,
        });
      } else {
        console.error(`[ClaudeRunner] Failed with code ${code}`);
        console.error(`[ClaudeRunner] stderr: ${stderr}`);
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Process exited with code ${code}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      console.error(`[ClaudeRunner] Spawn error:`, err);
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

// Wrapper for agent tasks
export async function runAgentTask(
  agentName: string,
  agentPrompt: string,
  task: string,
  context?: string
): Promise<string> {
  const fullPrompt = `${agentPrompt}

## Your Task
${task}

${context ? `## Context\n${context}` : ''}

## Instructions
1. Analyze the task carefully
2. Execute the work or provide detailed recommendations
3. Report your results clearly
4. List 1-3 key learnings

Output your actions and results in a structured format.`;

  const result = await runClaudeCode(fullPrompt, {
    model: 'sonnet',
    timeout: 180000, // 3 minutes
  });

  if (result.success) {
    return result.output;
  } else {
    throw new Error(result.error || 'Claude Code execution failed');
  }
}
