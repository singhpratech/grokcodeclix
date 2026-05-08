import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';
import { computeDiff, renderDiff, formatDiffSummary } from '../utils/diff.js';

export interface MultiEditOperation {
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export interface MultiEditToolParams {
  file_path: string;
  edits: MultiEditOperation[];
}

/**
 * Apply many string-replacement edits to one file atomically.
 *
 * Edits are applied sequentially in order — each edit operates on the result
 * of the previous edit. If any edit fails (string not found / not unique),
 * the whole operation aborts and the file is not modified.
 */
export async function multiEditTool(params: MultiEditToolParams): Promise<ToolResult> {
  try {
    if (!params.edits || !Array.isArray(params.edits) || params.edits.length === 0) {
      return { success: false, output: '', error: 'edits must be a non-empty array' };
    }

    const filePath = path.resolve(params.file_path);

    let content: string;
    try {
      content = await fs.readFile(filePath, 'utf-8');
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        return { success: false, output: '', error: `File not found: ${params.file_path}` };
      }
      throw error;
    }

    const original = content;
    let working = content;
    let totalReplacements = 0;

    for (let i = 0; i < params.edits.length; i++) {
      const edit = params.edits[i];

      if (edit.old_string === edit.new_string) {
        return {
          success: false,
          output: '',
          error: `Edit #${i + 1}: old_string and new_string are identical`,
        };
      }

      if (!working.includes(edit.old_string)) {
        return {
          success: false,
          output: '',
          error: `Edit #${i + 1}: string not found in file. After previous edits, the target text may have changed. Read the file again to see the current state.`,
        };
      }

      if (!edit.replace_all) {
        const occurrences = working.split(edit.old_string).length - 1;
        if (occurrences > 1) {
          return {
            success: false,
            output: '',
            error: `Edit #${i + 1}: found ${occurrences} occurrences. Pass replace_all: true or include more context.`,
          };
        }
      }

      if (edit.replace_all) {
        const parts = working.split(edit.old_string);
        totalReplacements += parts.length - 1;
        working = parts.join(edit.new_string);
      } else {
        working = working.replace(edit.old_string, edit.new_string);
        totalReplacements += 1;
      }
    }

    const diff = computeDiff(original, working);
    const rendered = renderDiff(diff, 40, 2);
    const summary = formatDiffSummary(diff);

    await fs.writeFile(filePath, working, 'utf-8');

    const rel = path.relative(process.cwd(), filePath);
    const relPath = !rel || rel.startsWith('..') ? filePath : rel;

    return {
      success: true,
      output: `Applied ${params.edits.length} edit${params.edits.length > 1 ? 's' : ''} (${totalReplacements} replacement${totalReplacements > 1 ? 's' : ''}, ${summary}) to ${filePath}`,
      display: {
        summary: `${params.edits.length} edits to ${relPath} — ${summary}`,
        preview: rendered,
        diff: { additions: diff.additions, removals: diff.removals, rendered },
      },
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, output: '', error: `MultiEdit error: ${err.message}` };
  }
}
