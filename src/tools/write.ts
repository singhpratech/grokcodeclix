import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';
import { validatePath } from '../utils/security.js';
import chalk from 'chalk';

export interface WriteToolParams {
  file_path: string;
  content: string;
}

// Maximum file size to write (50MB)
const MAX_CONTENT_SIZE = 50 * 1024 * 1024;

export async function writeTool(params: WriteToolParams): Promise<ToolResult> {
  try {
    const filePath = path.resolve(params.file_path);

    // Security validation
    const security = validatePath(filePath);
    if (!security.allowed) {
      return {
        success: false,
        output: '',
        error: `Security: ${security.reason}`,
      };
    }

    // Check content size
    if (params.content.length > MAX_CONTENT_SIZE) {
      return {
        success: false,
        output: '',
        error: `Content too large (${(params.content.length / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_CONTENT_SIZE / 1024 / 1024}MB.`,
      };
    }

    // Check if file exists (for backup/warning)
    let wasExisting = false;
    let previousSize = 0;
    try {
      const stats = await fs.stat(filePath);
      wasExisting = true;
      previousSize = stats.size;
    } catch {
      // File doesn't exist, that's fine
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write the file
    await fs.writeFile(filePath, params.content, 'utf-8');

    const lines = params.content.split('\n').length;
    const size = params.content.length;

    let output = `${chalk.white('✓')} File written: ${filePath}\n`;
    output += `  ${chalk.gray('Lines:')} ${lines}\n`;
    output += `  ${chalk.gray('Size:')} ${formatSize(size)}`;

    if (wasExisting) {
      const diff = size - previousSize;
      const diffStr = diff >= 0 ? `+${formatSize(diff)}` : `-${formatSize(Math.abs(diff))}`;
      output += ` (${diffStr} from previous)`;
    }

    // Security warning if applicable
    if (security.severity === 'medium') {
      output = chalk.yellow(`⚠️ ${security.suggestion}\n`) + output;
    }

    return {
      success: true,
      output,
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'EACCES') {
      return { success: false, output: '', error: `Permission denied: ${params.file_path}` };
    }
    if (err.code === 'ENOSPC') {
      return { success: false, output: '', error: 'No space left on device' };
    }
    return { success: false, output: '', error: `Error writing file: ${err.message}` };
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
