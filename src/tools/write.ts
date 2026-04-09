import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';
import { validatePath } from '../utils/security.js';
import { computeDiff, renderDiff, formatDiffSummary } from '../utils/diff.js';

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

    // Check if file exists (for diff display)
    let wasExisting = false;
    let previousContent = '';
    try {
      previousContent = await fs.readFile(filePath, 'utf-8');
      wasExisting = true;
    } catch {
      // File doesn't exist — treat as creating new
    }

    // Ensure directory exists
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    // Write the file
    await fs.writeFile(filePath, params.content, 'utf-8');

    const lines = params.content.split('\n').length;
    const size = params.content.length;
    const rel = path.relative(process.cwd(), filePath);
    const relPath = !rel || rel.startsWith('..') ? filePath : rel;

    if (wasExisting) {
      const diff = computeDiff(previousContent, params.content);
      const rendered = renderDiff(diff, 30, 2);
      const summary = formatDiffSummary(diff);
      return {
        success: true,
        output: `File updated: ${filePath} (${lines} lines, ${formatSize(size)}, ${summary})`,
        display: {
          summary: `Updated ${relPath} with ${summary}`,
          preview: rendered,
          diff: {
            additions: diff.additions,
            removals: diff.removals,
            rendered,
          },
        },
      };
    }

    return {
      success: true,
      output: `File created: ${filePath} (${lines} lines, ${formatSize(size)})`,
      display: {
        summary: `Created ${relPath} (${lines} lines, ${formatSize(size)})`,
      },
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
