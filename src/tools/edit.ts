import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface EditToolParams {
  file_path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

export async function editTool(params: EditToolParams): Promise<ToolResult> {
  try {
    const filePath = path.resolve(params.file_path);

    // Read existing content
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

    // Check if old_string exists
    if (!content.includes(params.old_string)) {
      return {
        success: false,
        output: '',
        error: `String not found in file. Make sure the old_string matches exactly including whitespace.`,
      };
    }

    // Check for uniqueness if not replace_all
    if (!params.replace_all) {
      const occurrences = content.split(params.old_string).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          output: '',
          error: `Found ${occurrences} occurrences of the string. Use replace_all: true to replace all, or provide a more specific string.`,
        };
      }
    }

    // Perform replacement
    let newContent: string;
    let replacements: number;

    if (params.replace_all) {
      const parts = content.split(params.old_string);
      replacements = parts.length - 1;
      newContent = parts.join(params.new_string);
    } else {
      newContent = content.replace(params.old_string, params.new_string);
      replacements = 1;
    }

    // Write back
    await fs.writeFile(filePath, newContent, 'utf-8');

    return {
      success: true,
      output: `File edited successfully: ${filePath} (${replacements} replacement${replacements > 1 ? 's' : ''})`,
    };
  } catch (error) {
    const err = error as Error;
    return { success: false, output: '', error: `Error editing file: ${err.message}` };
  }
}
