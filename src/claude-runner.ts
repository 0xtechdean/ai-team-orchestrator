/**
 * Claude Code Runner
 * Runs Claude Code CLI for agent tasks using Pro subscription
 * Uses `unbuffer` (from expect) to create pseudo-TTY for Docker environments
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Pre-warm flag to avoid repeated cold starts
let preWarmed = false;

/**
 * Pre-warm the Claude CLI by running a simple command
 */
export async function preWarmClaude(): Promise<boolean> {
  if (preWarmed) return true;

  console.log('[ClaudeRunner] Pre-warming Claude CLI...');
  const result = await runClaudeCode('Say ready', {
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
    timeout = 300000,
    model = 'sonnet',
  } = options;

  return new Promise((resolve) => {
    const claudeArgs = [
      '-p',
      '--model', model,
      '--dangerously-skip-permissions',
    ];

    if (systemPrompt) {
      claudeArgs.push('--system-prompt', systemPrompt);
    }

    // For long prompts or prompts with newlines, use a temp file
    // This avoids shell escaping issues with complex prompts
    let promptFile: string | null = null;
    if (prompt.length > 500 || prompt.includes('\n')) {
      promptFile = join(tmpdir(), `claude-prompt-${Date.now()}.txt`);
      writeFileSync(promptFile, prompt);
    }
    // Note: prompt is added in bash command construction below, not here

    const hasToken = !!process.env.CLAUDE_CODE_OAUTH_TOKEN;
    const hasApiKey = !!process.env.ANTHROPIC_API_KEY;
    console.log(`[ClaudeRunner] Running with model: ${model}`);
    console.log(`[ClaudeRunner] OAuth token present: ${hasToken}`);
    console.log(`[ClaudeRunner] API key present: ${hasApiKey}`);
    console.log(`[ClaudeRunner] Prompt length: ${prompt.length}, using file: ${!!promptFile}`);
    console.log(`[ClaudeRunner] Prompt preview: ${prompt.substring(0, 100)}...`);

    // Build the bash command with unbuffer for pseudo-TTY
    // Use double quotes for the outer bash -c argument to allow proper escaping
    let bashCmd: string;
    const argsStr = claudeArgs.join(' ');

    if (promptFile) {
      // Long prompt: read from file using command substitution
      bashCmd = `claude ${argsStr} "$(cat '${promptFile}')"`;
    } else {
      // Short prompt: escape double quotes and pass directly
      const escapedPrompt = prompt.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
      bashCmd = `claude ${argsStr} "${escapedPrompt}"`;
    }

    console.log(`[ClaudeRunner] Command: ${bashCmd.substring(0, 150)}...`);

    // Pass both API key and OAuth token - CLI will use whichever is valid
    const child = spawn('unbuffer', ['bash', '-c', bashCmd], {
      cwd: workingDir,
      env: {
        ...process.env,
        CI: 'true',
        TERM: 'xterm-256color',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
        CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN || '',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdin?.end();

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      if (promptFile) try { unlinkSync(promptFile); } catch {}
      resolve({
        success: false,
        output: cleanOutput(stdout),
        error: 'Timeout exceeded',
      });
    }, timeout);

    child.on('close', (code) => {
      clearTimeout(timer);
      if (promptFile) try { unlinkSync(promptFile); } catch {}

      const output = cleanOutput(stdout);

      if (code === 0) {
        console.log(`[ClaudeRunner] Success, output length: ${output.length}`);
        resolve({
          success: true,
          output,
        });
      } else {
        console.error(`[ClaudeRunner] Failed with code ${code}`);
        console.error(`[ClaudeRunner] stdout: ${stdout.substring(0, 500)}`);
        console.error(`[ClaudeRunner] stderr: ${stderr.substring(0, 500)}`);
        resolve({
          success: false,
          output,
          error: stderr || stdout || `Process exited with code ${code}`,
        });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timer);
      if (promptFile) try { unlinkSync(promptFile); } catch {}
      console.error(`[ClaudeRunner] Spawn error:`, err);
      resolve({
        success: false,
        output: '',
        error: err.message,
      });
    });
  });
}

/**
 * Clean up terminal output
 */
function cleanOutput(output: string): string {
  return output
    // Remove ANSI escape codes
    .replace(/\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    // Remove carriage returns
    .replace(/\r/g, '')
    // Trim whitespace
    .trim();
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
    timeout: 180000,
  });

  if (result.success) {
    return result.output;
  } else {
    throw new Error(result.error || 'Claude Code execution failed');
  }
}
