import { glob } from 'glob';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface GlobToolParams {
  pattern: string;
  path?: string;
}

export async function globTool(params: GlobToolParams): Promise<ToolResult> {
  try {
    const cwd = params.path ? path.resolve(params.path) : process.cwd();

    const matches = await glob(params.pattern, {
      cwd,
      nodir: true,
      absolute: false,
      ignore: ['node_modules/**', '.git/**', 'dist/**', 'build/**'],
    });

    if (matches.length === 0) {
      return {
        success: true,
        output: 'No files found matching the pattern.',
      };
    }

    // Sort by path
    matches.sort();

    // Limit output to prevent overwhelming responses
    const maxResults = 100;
    const limited = matches.slice(0, maxResults);
    const remaining = matches.length - maxResults;

    let output = limited.join('\n');
    if (remaining > 0) {
      output += `\n\n... and ${remaining} more files`;
    }

    return {
      success: true,
      output: `Found ${matches.length} file(s):\n${output}`,
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, output: '', error: `Glob error: ${err.message}` };
  }
}
