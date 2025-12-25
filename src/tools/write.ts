import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface WriteToolParams {
  file_path: string;
  content: string;
}

export async function writeTool(params: WriteToolParams): Promise<ToolResult> {
  try {
    const filePath = path.resolve(params.file_path);

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write the file
    await fs.writeFile(filePath, params.content, 'utf-8');

    const lines = params.content.split('\n').length;
    return {
      success: true,
      output: `File written successfully: ${filePath} (${lines} lines)`,
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, output: '', error: `Error writing file: ${err.message}` };
  }
}
