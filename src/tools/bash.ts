import { spawn } from 'child_process';
import { ToolResult } from './registry.js';

export interface BashToolParams {
  command: string;
  timeout?: number;
}

export async function bashTool(params: BashToolParams): Promise<ToolResult> {
  const timeout = params.timeout ?? 120000; // 2 minutes default

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let killed = false;

    const child = spawn('bash', ['-c', params.command], {
      cwd: process.cwd(),
      env: process.env,
    });

    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, timeout);

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      clearTimeout(timer);

      if (killed) {
        resolve({
          success: false,
          output: stdout,
          error: `Command timed out after ${timeout}ms`,
        });
        return;
      }

      // Combine stdout and stderr for output
      const output = stdout + (stderr ? `\n${stderr}` : '');

      if (code === 0) {
        resolve({
          success: true,
          output: output.trim() || '(no output)',
        });
      } else {
        resolve({
          success: false,
          output: stdout.trim(),
          error: stderr.trim() || `Command exited with code ${code}`,
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
