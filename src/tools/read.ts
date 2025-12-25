import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface ReadToolParams {
  file_path: string;
  offset?: number;
  limit?: number;
}

export async function readTool(params: ReadToolParams): Promise<ToolResult> {
  try {
    const filePath = path.resolve(params.file_path);
    const content = await fs.readFile(filePath, 'utf-8');
    const lines = content.split('\n');

    const offset = (params.offset ?? 1) - 1;
    const limit = params.limit ?? lines.length;

    const selectedLines = lines.slice(offset, offset + limit);

    // Format with line numbers like cat -n
    const output = selectedLines
      .map((line, i) => {
        const lineNum = offset + i + 1;
        const padding = String(lines.length).length;
        return `${String(lineNum).padStart(padding)}\t${line}`;
      })
      .join('\n');

    return {
      success: true,
      output: output || '(empty file)',
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { success: false, output: '', error: `File not found: ${params.file_path}` };
    }
    if (err.code === 'EISDIR') {
      return { success: false, output: '', error: `Path is a directory: ${params.file_path}` };
    }
    return { success: false, output: '', error: `Error reading file: ${err.message}` };
  }
}
