import { Tool } from '../grok/client.js';
import { readTool, ReadToolParams } from './read.js';
import { writeTool, WriteToolParams } from './write.js';
import { editTool, EditToolParams } from './edit.js';
import { bashTool, BashToolParams } from './bash.js';
import { globTool, GlobToolParams } from './glob.js';
import { grepTool, GrepToolParams } from './grep.js';
import { webFetchTool, WebFetchToolParams } from './webfetch.js';

export type ToolParams =
  | { name: 'Read'; params: ReadToolParams }
  | { name: 'Write'; params: WriteToolParams }
  | { name: 'Edit'; params: EditToolParams }
  | { name: 'Bash'; params: BashToolParams }
  | { name: 'Glob'; params: GlobToolParams }
  | { name: 'Grep'; params: GrepToolParams }
  | { name: 'WebFetch'; params: WebFetchToolParams };

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

export const allTools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description: 'Read the contents of a file. Returns the file content with line numbers.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The absolute or relative path to the file to read',
          },
          offset: {
            type: 'number',
            description: 'Line number to start reading from (1-based)',
          },
          limit: {
            type: 'number',
            description: 'Maximum number of lines to read',
          },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description: 'Write content to a file. Creates the file if it doesn\'t exist, overwrites if it does.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The absolute or relative path to the file to write',
          },
          content: {
            type: 'string',
            description: 'The content to write to the file',
          },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description: 'Edit a file by replacing a specific string with a new string.',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'The absolute or relative path to the file to edit',
          },
          old_string: {
            type: 'string',
            description: 'The exact string to find and replace',
          },
          new_string: {
            type: 'string',
            description: 'The string to replace it with',
          },
          replace_all: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false)',
          },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description: 'Execute a bash command. Use for terminal operations, git commands, npm, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 120000)',
          },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files matching a glob pattern.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The glob pattern to match (e.g., "**/*.ts", "src/**/*.js")',
          },
          path: {
            type: 'string',
            description: 'The directory to search in (default: current directory)',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description: 'Search for a pattern in files using regex.',
      parameters: {
        type: 'object',
        properties: {
          pattern: {
            type: 'string',
            description: 'The regex pattern to search for',
          },
          path: {
            type: 'string',
            description: 'The file or directory to search in',
          },
          include: {
            type: 'string',
            description: 'Glob pattern for files to include (e.g., "*.ts")',
          },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'Fetch content from a URL. Returns the response body as text. HTML is converted to readable text.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The URL to fetch',
          },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'DELETE'],
            description: 'HTTP method (default: GET)',
          },
          headers: {
            type: 'object',
            description: 'Additional HTTP headers',
          },
          body: {
            type: 'string',
            description: 'Request body for POST/PUT requests',
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)',
          },
        },
        required: ['url'],
      },
    },
  },
];

export async function executeTool(name: string, params: Record<string, unknown>): Promise<ToolResult> {
  switch (name) {
    case 'Read':
      return readTool(params as unknown as ReadToolParams);
    case 'Write':
      return writeTool(params as unknown as WriteToolParams);
    case 'Edit':
      return editTool(params as unknown as EditToolParams);
    case 'Bash':
      return bashTool(params as unknown as BashToolParams);
    case 'Glob':
      return globTool(params as unknown as GlobToolParams);
    case 'Grep':
      return grepTool(params as unknown as GrepToolParams);
    case 'WebFetch':
      return webFetchTool(params as unknown as WebFetchToolParams);
    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}
