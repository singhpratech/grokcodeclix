import { spawn } from 'child_process';
import { ToolResult } from './registry.js';
import { validateCommand, sanitizeOutput } from '../utils/security.js';
import chalk from 'chalk';

export interface BashToolParams {
  command: string;
  timeout?: number;
  cwd?: string;
}

// Maximum output size to prevent memory issues
const MAX_OUTPUT_SIZE = 1024 * 1024; // 1MB

export async function bashTool(params: BashToolParams): Promise<ToolResult> {
  const timeout = params.timeout ?? 120000; // 2 minutes default

  // Security validation
  const security = validateCommand(params.command);
  if (!security.allowed) {
    return {
      success: false,
      output: '',
      error: `Security: ${security.reason}${security.suggestion ? ` - ${security.suggestion}` : ''}`,
    };
  }

  // Warn about risky commands but allow them
  let warning = '';
  if (security.severity === 'medium') {
    warning = chalk.yellow(`⚠️ ${security.reason}\n`);
  }

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;
    let outputTruncated = false;

    const child = spawn('bash', ['-c', params.command], {
      cwd: params.cwd || process.cwd(),
      env: {
        ...process.env,
        // Prevent color codes from commands that might interfere
        FORCE_COLOR: '0',
        NO_COLOR: '1',
      },
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGTERM');
      // Force kill after 5 seconds if still running
      setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already dead
        }
      }, 5000);
    }, timeout);

    child.stdout.on('data', (data) => {
      if (stdout.length < MAX_OUTPUT_SIZE) {
        stdout += data.toString();
      } else if (!outputTruncated) {
        outputTruncated = true;
        stdout += '\n... (output truncated)';
      }
    });

    child.stderr.on('data', (data) => {
      if (stderr.length < MAX_OUTPUT_SIZE) {
        stderr += data.toString();
      }
    });

    child.on('close', (code, signal) => {
      clearTimeout(timer);

      if (killed) {
        resolve({
          success: false,
          output: sanitizeOutput(stdout),
          error: `Command timed out after ${timeout / 1000}s and was terminated`,
        });
        return;
      }

      // Combine and sanitize output
      let output = sanitizeOutput(stdout);
      if (stderr && code !== 0) {
        output += (output ? '\n' : '') + chalk.red('stderr: ') + sanitizeOutput(stderr);
      }

      if (code === 0) {
        resolve({
          success: true,
          output: warning + (output.trim() || '(command completed with no output)'),
        });
      } else {
        resolve({
          success: false,
          output: output.trim(),
          error: sanitizeOutput(stderr.trim()) || `Command exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`,
        });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        success: false,
        output: '',
        error: `Failed to execute command: ${error.message}`,
      });
    });
  });
}
