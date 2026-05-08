import { Tool } from '../grok/client.js';
import { readTool, ReadToolParams } from './read.js';
import { writeTool, WriteToolParams } from './write.js';
import { editTool, EditToolParams } from './edit.js';
import { multiEditTool, MultiEditToolParams } from './multiedit.js';
import { bashTool, BashToolParams } from './bash.js';
import { readBackgroundOutput, killBackgroundBash, BashOutputParams, KillBashParams } from './bash_bg.js';
import { globTool, GlobToolParams } from './glob.js';
import { grepTool, GrepToolParams } from './grep.js';
import { webFetchTool, WebFetchToolParams } from './webfetch.js';
import { webSearchTool, WebSearchToolParams } from './websearch.js';
import { todoWriteTool, TodoWriteParams } from './todowrite.js';
import { exitPlanModeTool, ExitPlanModeParams } from './exitplan.js';
import { generateImageTool, GenerateImageParams } from './imagegen.js';
import { transcribeAudioTool, TranscribeAudioParams } from './transcribe.js';
import { speakTextTool, SpeakTextParams } from './speak.js';

export type ToolParams =
  | { name: 'Read'; params: ReadToolParams }
  | { name: 'Write'; params: WriteToolParams }
  | { name: 'Edit'; params: EditToolParams }
  | { name: 'MultiEdit'; params: MultiEditToolParams }
  | { name: 'Bash'; params: BashToolParams }
  | { name: 'BashOutput'; params: BashOutputParams }
  | { name: 'KillBash'; params: KillBashParams }
  | { name: 'Glob'; params: GlobToolParams }
  | { name: 'Grep'; params: GrepToolParams }
  | { name: 'WebFetch'; params: WebFetchToolParams }
  | { name: 'WebSearch'; params: WebSearchToolParams }
  | { name: 'TodoWrite'; params: TodoWriteParams }
  | { name: 'ExitPlanMode'; params: ExitPlanModeParams }
  | { name: 'GenerateImage'; params: GenerateImageParams }
  | { name: 'TranscribeAudio'; params: TranscribeAudioParams }
  | { name: 'SpeakText'; params: SpeakTextParams };

export interface ToolResult {
  success: boolean;
  /** The tool output as text — this goes back to the model */
  output: string;
  error?: string;
  /** Optional display metadata for Claude-Code-style result rendering */
  display?: {
    /** Short summary line, e.g. "Read 141 lines" */
    summary?: string;
    /** Full result preview to show the user (colored, truncated) */
    preview?: string;
    /** Structured diff for Edit/Write operations */
    diff?: {
      additions: number;
      removals: number;
      rendered: string;
    };
  };
}

export const allTools: Tool[] = [
  {
    type: 'function',
    function: {
      name: 'Read',
      description:
        'Read a file from the local filesystem. Returns line-numbered content (cat -n style). Supports offset and limit for partial reads. Always Read a file before you Edit it.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path to the file' },
          offset: { type: 'number', description: '1-based line to start at' },
          limit: { type: 'number', description: 'Max lines to return (default 2000)' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Write',
      description:
        'Create or completely overwrite a file. Prefer Edit/MultiEdit for modifying existing files — Write erases anything not in the supplied content.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path' },
          content: { type: 'string', description: 'Full file content' },
        },
        required: ['file_path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Edit',
      description:
        'Replace ONE exact string in a file with another. old_string must be unique unless replace_all is true. Always Read the file first so you have the exact text including whitespace.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path' },
          old_string: { type: 'string', description: 'Exact text to find (whitespace-sensitive)' },
          new_string: { type: 'string', description: 'Replacement text' },
          replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
        },
        required: ['file_path', 'old_string', 'new_string'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'MultiEdit',
      description:
        'Apply multiple Edit operations to ONE file in a single atomic call. Edits are applied sequentially in order — each edit operates on the result of the previous one. If any edit fails, no changes are written. Use this for refactors that touch many spots in the same file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Absolute or relative path' },
          edits: {
            type: 'array',
            description: 'Edits to apply, in order',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: 'Exact text to find' },
                new_string: { type: 'string', description: 'Replacement text' },
                replace_all: { type: 'boolean', description: 'Replace every occurrence (default false)' },
              },
              required: ['old_string', 'new_string'],
            },
          },
        },
        required: ['file_path', 'edits'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Bash',
      description:
        'Execute a bash command. Use for git, npm, tests, build steps, package managers — actions the dedicated tools cannot do. Avoid Bash cat/grep/find — use Read/Grep/Glob. Long commands should set run_in_background:true and be polled with BashOutput.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to execute' },
          timeout: { type: 'number', description: 'Foreground timeout in ms (default 120000, max 600000)' },
          run_in_background: {
            type: 'boolean',
            description: 'Run as a long-lived background process. Returns a bash_id immediately.',
          },
          description: { type: 'string', description: 'One short sentence describing what this command does' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'BashOutput',
      description:
        'Read new output from a background Bash process started with run_in_background:true. Returns only output produced since the previous BashOutput call (cursor-based). Optional regex filter.',
      parameters: {
        type: 'object',
        properties: {
          bash_id: { type: 'string', description: 'The id returned by Bash with run_in_background:true' },
          filter: { type: 'string', description: 'Optional regex — only lines matching are returned' },
        },
        required: ['bash_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'KillBash',
      description: 'Terminate a background Bash process started with run_in_background:true.',
      parameters: {
        type: 'object',
        properties: {
          bash_id: { type: 'string', description: 'The id returned by Bash with run_in_background:true' },
        },
        required: ['bash_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Glob',
      description: 'Find files by glob pattern (e.g. **/*.ts). Faster and safer than `find`. Returns paths sorted by modification time.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern, e.g. **/*.ts or src/**/*.test.js' },
          path: { type: 'string', description: 'Directory to search in (default cwd)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'Grep',
      description:
        'Regex search across files (ripgrep-style). Use this instead of Bash grep — it is faster, respects .gitignore, and returns structured results.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern' },
          path: { type: 'string', description: 'File or directory to search (default cwd)' },
          include: { type: 'string', description: 'Glob filter for files to include (e.g. *.ts)' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebFetch',
      description: 'Fetch a URL and return its content. HTML is converted to readable text, JSON is parsed.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The URL to fetch' },
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'DELETE'], description: 'HTTP method (default GET)' },
          headers: { type: 'object', description: 'Additional HTTP headers' },
          body: { type: 'string', description: 'Request body for POST/PUT' },
          timeout: { type: 'number', description: 'Timeout in ms (default 30000)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'WebSearch',
      description: 'Search the web for current information, library docs, error messages. Returns title/url/snippet results.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query' },
          num_results: { type: 'number', description: '1–20, default 10' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ExitPlanMode',
      description:
        'Call this when you are in plan mode and have finished planning. Pass the proposed plan as `plan`. The user will be asked to approve before any side-effecting tools (Write, Edit, MultiEdit, Bash) are allowed to run.',
      parameters: {
        type: 'object',
        properties: {
          plan: {
            type: 'string',
            description: 'A concise markdown plan of the steps you intend to execute',
          },
        },
        required: ['plan'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'GenerateImage',
      description:
        'Generate an image from a text prompt using xAI grok-2-image (or the same model via OpenRouter). Saves PNG(s) into ./grok-images/ and returns the saved paths so the user can open them. Use only when the user explicitly asks to create / draw / generate an image.',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'Detailed description of the image to generate' },
          n: { type: 'number', description: 'Number of images to generate, 1–4 (default 1)' },
          model: { type: 'string', description: 'Override the image model (default grok-2-image-latest / x-ai/grok-2-image)' },
          output_dir: { type: 'string', description: 'Directory to save images in (default ./grok-images)' },
        },
        required: ['prompt'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'SpeakText',
      description:
        'Synthesize speech from text. Tries xAI native TTS first, falls back to OpenRouter / OpenAI TTS. Saves the audio file under ./grok-audio/. Use only when the user asks to read something aloud or generate speech.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Text to speak (required)' },
          voice: { type: 'string', description: 'Voice id (xAI: aurora; OpenAI: alloy/echo/fable/onyx/nova/shimmer)' },
          output_path: { type: 'string', description: 'Where to save the audio (default ./grok-audio/grok-<ts>.<format>)' },
          model: { type: 'string', description: 'Override the TTS model id' },
          format: { type: 'string', enum: ['mp3', 'wav', 'opus', 'aac', 'flac', 'pcm'], description: 'Output format (default mp3)' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TranscribeAudio',
      description:
        'Transcribe a local audio file (mp3, m4a, wav, webm, flac, ogg) to text. Routed through OpenRouter to Whisper — only works when the active provider is OpenRouter. xAI direct does not yet expose audio.',
      parameters: {
        type: 'object',
        properties: {
          audio_path: { type: 'string', description: 'Path to the audio file' },
          model: { type: 'string', description: 'Whisper model id (default openai/whisper-1)' },
          language: { type: 'string', description: 'BCP-47 language hint, e.g. "en" or "hi" (optional)' },
        },
        required: ['audio_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'TodoWrite',
      description:
        'Maintain a structured todo list for the current session. Replace the entire list on each call. Use for non-trivial multi-step tasks: create the plan upfront, mark exactly one item in_progress while you work on it, and mark it completed before moving to the next. Skip for trivial single-step requests.',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: 'The complete todo list — replaces previous list',
            items: {
              type: 'object',
              properties: {
                content: { type: 'string', description: 'Imperative form, e.g. "Add OpenRouter support"' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] },
                activeForm: { type: 'string', description: 'Present continuous, e.g. "Adding OpenRouter support"' },
              },
              required: ['content', 'status'],
            },
          },
        },
        required: ['todos'],
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
    case 'MultiEdit':
      return multiEditTool(params as unknown as MultiEditToolParams);
    case 'Bash':
      return bashTool(params as unknown as BashToolParams);
    case 'BashOutput':
      return readBackgroundOutput(params as unknown as BashOutputParams);
    case 'KillBash':
      return killBackgroundBash(params as unknown as KillBashParams);
    case 'Glob':
      return globTool(params as unknown as GlobToolParams);
    case 'Grep':
      return grepTool(params as unknown as GrepToolParams);
    case 'WebFetch':
      return webFetchTool(params as unknown as WebFetchToolParams);
    case 'WebSearch':
      return webSearchTool(params as unknown as WebSearchToolParams);
    case 'TodoWrite':
      return todoWriteTool(params as unknown as TodoWriteParams);
    case 'ExitPlanMode':
      return exitPlanModeTool(params as unknown as ExitPlanModeParams);
    case 'GenerateImage':
      return generateImageTool(params as unknown as GenerateImageParams);
    case 'TranscribeAudio':
      return transcribeAudioTool(params as unknown as TranscribeAudioParams);
    case 'SpeakText':
      return speakTextTool(params as unknown as SpeakTextParams);
    default:
      return { success: false, output: '', error: `Unknown tool: ${name}` };
  }
}
