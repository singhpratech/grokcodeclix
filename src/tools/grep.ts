import { spawn } from 'child_process';
import { ToolResult } from './registry.js';

export interface GrepToolParams {
  pattern: string;
  path?: string;
  include?: string;
}

export async function grepTool(params: GrepToolParams): Promise<ToolResult> {
  return new Promise((resolve) => {
    const args = [
      '--color=never',
      '-r',
      '-n',
      '-H',
      '--include=*.{ts,tsx,js,jsx,json,md,py,go,rs,java,kt,swift,c,cpp,h,hpp,css,scss,html,xml,yaml,yml,toml}',
    ];

    if (params.include) {
      args.push(`--include=${params.include}`);
    }

    // Exclude common directories
    args.push('--exclude-dir=node_modules');
    args.push('--exclude-dir=.git');
    args.push('--exclude-dir=dist');
    args.push('--exclude-dir=build');
    args.push('--exclude-dir=.next');

    args.push('-E'); // Extended regex
    args.push(params.pattern);
    args.push(params.path || '.');

    const child = spawn('grep', args, {
      cwd: process.cwd(),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      // grep returns 1 if no matches, which is not an error
      if (code === 1 && !stderr) {
        resolve({
          success: true,
          output: 'No matches found.',
        });
        return;
      }

      if (code !== 0 && code !== 1) {
        resolve({
          success: false,
          output: '',
          error: stderr || `grep exited with code ${code}`,
        });
        return;
      }

      // Limit output
      const lines = stdout.trim().split('\n').filter(Boolean);
      const maxResults = 50;

      if (lines.length > maxResults) {
        const output = lines.slice(0, maxResults).join('\n');
        resolve({
          success: true,
          output: `Found ${lines.length} matches (showing first ${maxResults}):\n${output}`,
        });
      } else {
        resolve({
          success: true,
          output: lines.length > 0 ? `Found ${lines.length} match(es):\n${stdout.trim()}` : 'No matches found.',
        });
      }
    });

    child.on('error', (error) => {
      // Fall back to ripgrep if grep is not available
      resolve({
        success: false,
        output: '',
        error: `grep error: ${error.message}`,
      });
    });
  });
}
