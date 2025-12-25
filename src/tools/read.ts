import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';
import { validatePath } from '../utils/security.js';
import chalk from 'chalk';

export interface ReadToolParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

// Maximum file size to read (10MB)
const MAX_FILE_SIZE = 10 * 1024 * 1024;

// Maximum lines to return
const MAX_LINES = 2000;

export async function readTool(params: ReadToolParams): Promise<ToolResult> {
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

    // Check file stats first
    let stats;
    try {
      stats = await fs.stat(filePath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${params.file_path}` };
      }
      throw error;
    }

    if (stats.isDirectory()) {
      return { success: false, output: '', error: `Path is a directory: ${params.file_path}` };
    }

    if (stats.size > MAX_FILE_SIZE) {
      return {
        success: false,
        output: '',
        error: `File too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_FILE_SIZE / 1024 / 1024}MB. Use offset/limit to read portions.`,
      };
    }

    // Read the file
    const content = await fs.readFile(filePath, 'utf-8');

    // Handle binary files
    if (content.includes('\0')) {
      return {
        success: false,
        output: '',
        error: 'File appears to be binary. Cannot display binary content.',
      };
    }

    const lines = content.split('\n');
    const totalLines = lines.length;

    const offset = Math.max(0, (params.offset ?? 1) - 1);
    const limit = Math.min(params.limit ?? MAX_LINES, MAX_LINES);

    const selectedLines = lines.slice(offset, offset + limit);

    // Format with line numbers like cat -n
    const padding = String(totalLines).length;
    const output = selectedLines
      .map((line, i) => {
        const lineNum = offset + i + 1;
        // Truncate very long lines
        const displayLine = line.length > 2000 ? line.slice(0, 2000) + '...' : line;
        return `${String(lineNum).padStart(padding)}${chalk.gray('│')} ${displayLine}`;
      })
      .join('\n');

    // Add metadata
    let header = '';
    if (offset > 0 || selectedLines.length < totalLines) {
      header = chalk.gray(`Showing lines ${offset + 1}-${offset + selectedLines.length} of ${totalLines}\n`);
    }

    // Security warning if applicable
    if (security.severity === 'medium') {
      header = chalk.yellow(`⚠️ ${security.suggestion}\n`) + header;
    }

    return {
      success: true,
      output: header + (output || '(empty file)'),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { success: false, output: '', error: `File not found: ${params.file_path}` };
    }
    if (err.code === 'EACCES') {
      return { success: false, output: '', error: `Permission denied: ${params.file_path}` };
    }
    if (err.code === 'EISDIR') {
      return { success: false, output: '', error: `Path is a directory: ${params.file_path}` };
    }
    return { success: false, output: '', error: `Error reading file: ${err.message}` };
  }
}
