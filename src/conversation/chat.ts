import * as readline from 'readline';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { GrokClient, GrokMessage, GrokContentPart, ToolCall, ChatOptions as GrokChatOptions } from '../grok/client.js';
import { allTools, executeTool, ToolResult } from '../tools/registry.js';
import { planExitState } from '../tools/exitplan.js';
import { todoState, renderTodoList } from '../tools/todowrite.js';
import { NAAVI_MASCOT } from '../utils/mascot.js';
import { PermissionManager } from '../permissions/manager.js';
import { HistoryManager, ConversationSession } from './history.js';
import { ConfigManager } from '../config/manager.js';
import { interactiveSelect, SelectorOption } from '../utils/selector.js';
import { renderMarkdown, stripMarkdown } from '../utils/markdown.js';
import {
  loadCustomCommands,
  processCommandArgs,
  initCommandsDir,
  getCommandHelp,
  CustomCommand,
} from '../commands/loader.js';
import {
  loadImageFromClipboard,
  loadImageFromFile,
  extractImageReferences,
  ImageAttachment,
  formatSize,
} from '../utils/image.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));

const VERSION = packageJson.version;

// Tiranga palette — saffron / white / green from the Indian flag.
// Saffron is the primary accent (tool-call ●, welcome ✻, spinner).
// Green is the success/additions color (also used by the diff renderer).
// White is for bold emphasis.
const SAFFRON = chalk.hex('#FF9933');
const INDIA_GREEN = chalk.hex('#138808');

/**
 * Print a key prefix safe to display on screen. xAI keys always begin
 * `xai-`, OpenRouter keys always begin `sk-or-`, so the prefix alone is
 * irrefutable proof of which provider the request will hit.
 */
function redactKey(key: string | undefined): string {
  if (!key) return '(none)';
  // Show enough of the prefix to reveal the provider, then mask the rest.
  // `xai-aBcD1234EfGh…` for xAI, `sk-or-v1-aBcD1234…` for OpenRouter.
  if (key.length <= 8) return key + '…';
  const head = key.startsWith('sk-or-') ? key.slice(0, 14) : key.slice(0, 8);
  return head + '…' + key.slice(-4);
}

// Cheap structural detection — anything that the markdown renderer would
// transform visibly. Plain prose / file paths / tool descriptions hit the
// fast path (no rewind = no flicker). Code blocks, headers, lists, bold,
// italic, blockquotes, tables, links go through the renderer.
function hasMarkdownMarkers(text: string): boolean {
  if (text.includes('```')) return true;            // fenced code
  if (/(^|\n)#{1,6}\s/.test(text)) return true;     // headers
  if (/(^|\n)\s*[-*]\s/.test(text)) return true;    // bullets
  if (/(^|\n)\s*\d+\.\s/.test(text)) return true;   // ordered lists
  if (/(^|\n)>\s/.test(text)) return true;          // blockquote
  if (/(^|\n)\s*\|.*\|/.test(text)) return true;    // table row
  if (/\*\*[^*\n]+\*\*/.test(text)) return true;    // bold
  if (/\*[^*\s][^*\n]*\*/.test(text)) return true;  // italic
  if (/`[^`\n]+`/.test(text)) return true;          // inline code
  if (/\[[^\]\n]+\]\([^)\n]+\)/.test(text)) return true; // link
  return false;
}

function buildSystemPrompt(cwd: string, workingDirs: string[], projectContext: string): string {
  const dirList = workingDirs.length > 1
    ? '\n' + workingDirs.map((d, i) => `  ${i === 0 ? '→' : ' '} ${d}`).join('\n')
    : ` ${cwd}`;

  return `You are Grok Code, an agentic CLI coding assistant powered by xAI's Grok models. You help users with software engineering tasks directly from the terminal.

# Tone and style
Be concise, direct, and to the point. Output will be rendered in a terminal, so keep it scannable. Default to one or two short sentences. Only go long when the user asks for explanation or the task genuinely needs it. Skip preamble ("I'll help you...", "Sure!", "Let me..."). Don't restate what the user said. Don't summarize what you just did unless asked. Don't emit filler.

You MAY use GitHub-flavored Markdown. Code blocks should use fenced syntax with a language tag so the terminal can highlight them.

# Proactiveness
Do exactly what the user asked. Don't refactor code you weren't asked to refactor. Don't "improve" working code. Don't add comments to code you didn't change. Don't add speculative error handling. Match the existing code style.

# Following conventions
Before editing a file, read it. Mimic naming, formatting, and patterns from the surrounding code. Check imports and neighbouring files before introducing new patterns. If the repo uses a particular library or convention, follow it — don't introduce a new dependency unless necessary.

# Task management
- For non-trivial multi-step work (3+ steps), call **TodoWrite** to plan upfront. Mark exactly one item \`in_progress\` while you work on it; mark it \`completed\` before moving to the next. Skip TodoWrite for trivial single-step requests.
- Read relevant files before making edits. Verify assumptions before acting.
- When the task is done, stop. Don't volunteer unrelated follow-ups.

# Tool use rules
- **Parallelism matters.** When multiple tool calls are independent — reading several files, running independent searches, kicking off two unrelated bash commands — issue them in a SINGLE response so they execute concurrently. Only sequence calls when one truly needs the result of another.
- **Read before you Edit.** Never edit a file you haven't read in this session.
- **MultiEdit for refactors.** If you need to change many spots in the same file, call MultiEdit ONCE with all edits — don't fire many Edit calls. MultiEdit is atomic: all-or-nothing.
- **Edit requires exact matches.** \`old_string\` must match exactly including whitespace. If it is not unique, include more context or set \`replace_all: true\`.
- **Prefer dedicated tools.** Read instead of \`cat\`, Write instead of \`echo >\`, Edit instead of \`sed\`, Grep instead of \`grep\`, Glob instead of \`find\`. The dedicated tools are faster and structured.
- **Long-running commands** (servers, watchers, builds taking minutes) should set \`run_in_background: true\` on Bash. Then poll with **BashOutput** to read incremental output and **KillBash** to stop. Don't block on a long foreground command.
- **Bash is for actions** dedicated tools cannot do: git, npm, package managers, running tests, build scripts, deploys.
- **WebSearch / WebFetch** for current info, docs, error message lookups, package versions — anything not in the workspace.

# Available tools
- **Read**: Read a file with line numbers. Supports offset / limit.
- **Write**: Create / overwrite a file. Use for new files; prefer Edit/MultiEdit for existing files.
- **Edit**: Replace one exact string in a file (or all occurrences with replace_all).
- **MultiEdit**: Apply many string-replacements to one file atomically. Use for in-file refactors.
- **Glob**: Find files by pattern (e.g. \`**/*.ts\`).
- **Grep**: Regex search across files.
- **Bash**: Run a shell command. Set \`run_in_background\` for long-running.
- **BashOutput**: Read incremental output from a background Bash process by bash_id.
- **KillBash**: Stop a background Bash process by bash_id.
- **WebFetch**: Fetch a URL — HTML is converted to readable text.
- **WebSearch**: Search the web (Grok Live Search).
- **TodoWrite**: Maintain a structured plan for non-trivial tasks. Call early and update as you progress.
- **GenerateImage**: Generate an image from a prompt (saves PNG to ./grok-images/). Use ONLY when the user explicitly asks for an image / illustration / generated picture.
- **TranscribeAudio**: Transcribe a local audio file. Tries xAI native first, falls back to OpenRouter Whisper.
- **SpeakText**: Synthesize speech from text (saves audio to ./grok-audio/). Use only when the user asks to read something aloud / generate speech.

# Security
Never introduce vulnerabilities (XSS, SQL injection, command injection, insecure deserialization). Never log or commit secrets. Treat user-provided file paths and commands as untrusted input — the permission layer will prompt the user for risky operations, but you should still pick the safest tool for the job.

# Git
Use Bash for git operations. Write clear commit messages focused on *why*, not *what*. Never force-push to main. Don't commit unless the user asks. Before creating a commit, check \`git status\` and \`git diff\` to confirm what you're staging.

# Environment
- Working directory:${dirList}
- Platform: ${process.platform} (${os.arch()})
- Date: ${new Date().toISOString().slice(0, 10)}
- Node: ${process.version}
${projectContext ? `\n# Project context (from GROK.md)\n${projectContext}\n` : ''}`;
}

export interface ChatInitOptions {
  apiKey: string;
  model?: string;
  resume?: boolean;
  sessionId?: string;
  /** If true, bypass all permission prompts (for scripting / non-interactive use). */
  yes?: boolean;
}

// Keep old name as alias for backwards compat with index.ts exports
export type ChatOptions = ChatInitOptions;

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

interface PendingAttachments {
  images: ImageAttachment[];
}

export class GrokChat {
  private client: GrokClient;
  private messages: GrokMessage[] = [];
  private rl: readline.Interface;
  private permissions: PermissionManager;
  private history: HistoryManager;
  private config: ConfigManager;
  private session: ConversationSession | null = null;
  private useStreaming: boolean = true;
  private workingDirs: string[] = [process.cwd()];
  private tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 };
  private sessionStartTime: Date = new Date();
  private apiKey: string;
  private abortController: AbortController | null = null;
  private thinkingMode: boolean = true; // true = reasoning model, false = fast model
  private baseModel: string = 'grok-4-1';
  private planMode: boolean = false; // read-only mode
  private customCommands: CustomCommand[] = [];
  private projectContext: string = '';
  private pending: PendingAttachments = { images: [] };
  private contextWindowTokens: number = 256_000; // Grok 4.1 default
  private outputStyle: 'default' | 'concise' | 'verbose' = 'default';
  private theme: 'tiranga' | 'claude' | 'mono' = 'tiranga';
  /** Snapshots of the messages array for /back undo */
  private undoStack: GrokMessage[][] = [];
  /** Live slash-popup bookkeeping */
  private slashPopupActive: boolean = false;
  private slashPopupLines: number = 0;
  /** Currently selected item index in the slash popup */
  private slashPopupSelectedIndex: number = 0;
  /** Cached match list rendered by the popup so up/down can navigate it */
  private slashPopupMatches: Array<[string, string]> = [];
  /** In-session todo list */
  private todos: { text: string; done: boolean }[] = [];
  /** Vim mode for input editing */
  private vimMode: boolean = false;

  // Built-in slash commands with descriptions (matching Claude Code coverage).
  private static SLASH_COMMANDS: Record<string, string> = {
    // Session
    '/help': 'Show available commands',
    '/clear': 'Clear the conversation',
    '/compact': 'Compact the conversation context',
    '/history': 'Browse previous sessions',
    '/resume': 'Resume a previous session',
    '/rename': 'Rename the current session',
    '/export': 'Export conversation to file',
    '/save': 'Save the current session',
    '/back': 'Undo the last turn (user + assistant)',
    '/backup': 'Save a named backup snapshot of this session',
    '/exit': 'Exit and save',

    // Config
    '/config': 'Show configuration',
    '/model': 'Change the Grok model',
    '/plan': 'Toggle plan mode (read-only)',
    '/stream': 'Toggle streaming responses',
    '/permissions': 'View permission settings',
    '/output-style': 'Set response style (default / concise / verbose)',
    '/theme': 'Change color theme',
    '/login': 'Authenticate with xAI',
    '/logout': 'Clear stored credentials',

    // Info
    '/status': 'Show session status',
    '/whoami': 'Probe the live API to prove which provider + model is active',
    '/context': 'Show context window usage',
    '/cost': 'Show token usage and estimated cost',
    '/usage': 'Show usage statistics',
    '/doctor': 'Run diagnostic checks',
    '/version': 'Show version',
    '/release-notes': 'Show recent changes',
    '/bug': 'Report a bug (opens GitHub issues)',

    // Project
    '/init': 'Initialize GROK.md in this project',
    '/memory': 'View or edit GROK.md project memory',
    '/review': 'Ask Grok to review recent changes',
    '/security-review': 'Security review of uncommitted changes',
    '/pr-comments': 'View comments on a GitHub PR (needs gh)',
    '/add-dir': 'Add a working directory',
    '/pwd': 'Show working directories',

    // Attachments & custom
    '/image': 'Attach an image from a file path',
    '/paste': 'Paste image from clipboard',
    '/imagine': 'Generate an image from a prompt (grok-2-image)',
    '/voice': 'Transcribe an audio file (xAI / OpenRouter Whisper)',
    '/speak': 'Synthesize speech from text (xAI TTS / OpenAI TTS)',
    '/commands': 'List custom commands',

    // Tasks & utilities
    '/todos': 'Show in-session todo list',
    '/todo': 'Add a todo item or toggle one done',
    '/vim': 'Toggle vim editing mode for input',
    '/terminal-setup': 'Show terminal setup tips',
    '/upgrade': 'Show how to update Grok Code',
    '/feedback': 'Send feedback (opens GitHub Discussions)',
  };

  constructor(options: ChatInitOptions) {
    this.apiKey = options.apiKey;

    // Parse initial model to determine base and mode
    const initialModel = options.model || 'grok-4-1-fast-non-reasoning';
    this.parseModelMode(initialModel);
    this.client = new GrokClient(options.apiKey, this.getCurrentModel());

    // Publish key + provider to env so tools that need their own HTTP calls
    // (GenerateImage, TranscribeAudio) can pick them up without a circular
    // dependency on this class.
    process.env.GROK_RUNTIME_API_KEY = options.apiKey;
    process.env.GROK_RUNTIME_PROVIDER = this.client.provider;

    // Autocomplete: shows matching slash commands (built-in + custom)
    const completer = (line: string): [string[], string] => {
      if (line === '') {
        return [[], ''];
      }
      if (line.startsWith('/')) {
        const all = this.getAllCommandNames();
        const matches = all.filter((cmd) => cmd.startsWith(line));
        return [matches.length ? matches : all, line];
      }
      return [[], line];
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
      terminal: true,
    });
    this.permissions = new PermissionManager();
    this.permissions.setReadlineInterface(this.rl);
    if (options.yes) {
      this.permissions.setYolo(true);
    }
    this.history = new HistoryManager();
    this.config = new ConfigManager();

    // Extra keybindings: Ctrl+O (backup), Ctrl+B (back/undo),
    // Ctrl+L (clear screen), Shift+Tab (toggle plan mode), plus
    // live slash-command suggestions that pop up as the user types.
    if (process.stdin.isTTY) {
      readline.emitKeypressEvents(process.stdin, this.rl);
      process.stdin.on('keypress', (_str: string, key: { name?: string; ctrl?: boolean; shift?: boolean } | undefined) => {
        if (!key || this.abortController) return; // ignore during streaming

        // Ctrl+L — clear screen, keep prompt
        if (key.ctrl && key.name === 'l') {
          process.stdout.write('\x1Bc');
          this.rl.prompt(true);
          return;
        }

        // Ctrl+O — quick backup snapshot
        if (key.ctrl && key.name === 'o') {
          console.log();
          this.handleBackup().catch((e) => console.log(chalk.red('  ' + (e as Error).message)));
          return;
        }

        // Ctrl+B — undo last turn
        if (key.ctrl && key.name === 'b') {
          console.log();
          this.handleBack();
          return;
        }

        // Shift+Tab — toggle plan mode (Claude Code style)
        if (key.shift && key.name === 'tab') {
          this.planMode = !this.planMode;
          console.log();
          console.log(
            chalk.dim('  plan mode ') + (this.planMode ? chalk.yellow('on') : chalk.dim('off'))
          );
          return;
        }

        // Slash-popup interactions when the popup is open.
        if (this.slashPopupActive && this.slashPopupMatches.length > 0) {
          // Up/Down navigates the selection. Readline will also try to
          // browse history on the same keys — we save the typed buffer
          // and restore it on the next tick so history nav is undone
          // and the popup-navigation feel wins.
          if (key.name === 'up' || key.name === 'down') {
            const savedLine = this.rl.line ?? '';
            const savedCursor = (this.rl as unknown as { cursor: number }).cursor;
            if (key.name === 'up') {
              this.slashPopupSelectedIndex = Math.max(0, this.slashPopupSelectedIndex - 1);
            } else {
              this.slashPopupSelectedIndex = Math.min(
                this.slashPopupMatches.length - 1,
                this.slashPopupSelectedIndex + 1,
              );
            }
            setImmediate(() => {
              (this.rl as unknown as { line: string }).line = savedLine;
              (this.rl as unknown as { cursor: number }).cursor = savedCursor;
              this.rl.prompt(true);
              this.updateSlashPopup();
            });
            return;
          }
          // Tab inserts the selected command and dismisses the popup.
          if (key.name === 'tab') {
            const [cmd] = this.slashPopupMatches[this.slashPopupSelectedIndex];
            const current = this.rl.line ?? '';
            const remainder = cmd.slice(current.length);
            if (remainder) {
              (this.rl as unknown as { line: string }).line = cmd;
              (this.rl as unknown as { cursor: number }).cursor = cmd.length;
              this.rl.prompt(true);
            }
            this.clearSlashPopup();
            return;
          }
          // Esc dismisses the popup but keeps the typed text.
          if (key.name === 'escape') {
            this.clearSlashPopup();
            return;
          }
        }

        // Live slash-command popup — IMPORTANT: keypress events fire
        // BEFORE readline updates rl.line with the new character, so
        // we have to defer the check to the next microtask to read
        // the updated line. We reset the selection to the top whenever
        // the line content actually changes.
        if (!key.ctrl) {
          setImmediate(() => {
            const current = this.rl.line ?? '';
            if (current.startsWith('/')) {
              this.updateSlashPopup({ resetSelection: true });
            } else if (this.slashPopupActive) {
              this.clearSlashPopup();
            }
          });
        }
      });
    }

    // Ctrl+C: abort streaming or exit cleanly
    this.rl.on('SIGINT', async () => {
      if (this.abortController) {
        this.abortController.abort();
        console.log(chalk.dim('\n  Interrupted.'));
      } else {
        await this.saveSession();
        console.log(chalk.gray('\n\nSession saved. Goodbye!\n'));
        process.exit(0);
      }
    });
  }

  private getAllCommandNames(): string[] {
    return [
      ...Object.keys(GrokChat.SLASH_COMMANDS),
      ...this.customCommands.map((c) => `/${c.name}`),
    ].sort();
  }

  // Parse model string to determine base model and thinking mode
  private parseModelMode(model: string): void {
    if (model.includes('fast-reasoning') || model.includes('fast-non-reasoning')) {
      this.thinkingMode = !model.includes('non-reasoning');
      this.baseModel = model.replace(/-fast-reasoning$/, '').replace(/-fast-non-reasoning$/, '');
    } else {
      this.thinkingMode = model.includes('reasoning');
      this.baseModel = model;
    }
  }

  private getCurrentModel(): string {
    if (this.baseModel.startsWith('grok-4')) {
      return this.thinkingMode ? `${this.baseModel}-fast-reasoning` : `${this.baseModel}-fast-non-reasoning`;
    }
    return this.baseModel;
  }

  private toggleThinkingMode(): void {
    this.thinkingMode = !this.thinkingMode;
    const newModel = this.getCurrentModel();
    this.client = new GrokClient(this.apiKey, newModel);
    this.announceModelChange(newModel);
  }

  // Claude Code-style memory hierarchy:
  //   1. Global user memory: ~/.grok/GROK.md  (applies everywhere)
  //   2. Project memory: ./GROK.md walked up from cwd to $HOME  (per-project)
  //      — closest file wins when there are multiple
  // All found files are concatenated into this.projectContext and injected
  // into the system prompt.
  private async loadProjectContext(): Promise<void> {
    const contexts: string[] = [];
    const home = os.homedir();

    // 1. Global user memory
    const globalGrokMd = path.join(home, '.grok', 'GROK.md');
    try {
      const content = await fs.readFile(globalGrokMd, 'utf-8');
      contexts.push(`[From ~/.grok/GROK.md — global memory]\n${content.trim()}`);
    } catch {
      // not set up
    }

    // 2. Project memory — walk up from cwd to $HOME collecting GROK.md files
    const projectPaths: string[] = [];
    let dir = process.cwd();
    while (dir && dir !== path.dirname(dir)) {
      projectPaths.push(path.join(dir, 'GROK.md'));
      if (dir === home) break;
      dir = path.dirname(dir);
    }
    // Nearest first so they win when conflicting
    for (const p of projectPaths) {
      try {
        const content = await fs.readFile(p, 'utf-8');
        const rel = path.relative(process.cwd(), p) || p;
        contexts.push(`[From ${rel}]\n${content.trim()}`);
      } catch {
        // not found
      }
    }

    this.projectContext = contexts.join('\n\n');
  }

  /** Append a line to GROK.md memory (project or global). */
  private async addToMemory(text: string, scope: 'project' | 'global' = 'project'): Promise<void> {
    const target =
      scope === 'global'
        ? path.join(os.homedir(), '.grok', 'GROK.md')
        : path.join(process.cwd(), 'GROK.md');

    await fs.mkdir(path.dirname(target), { recursive: true });

    let existing = '';
    try {
      existing = await fs.readFile(target, 'utf-8');
    } catch {
      existing = `# ${path.basename(process.cwd())}\n\n## Notes\n`;
    }

    const bullet = `- ${text.trim()}\n`;
    if (/^## Notes/m.test(existing)) {
      // Insert under ## Notes
      const updated = existing.replace(/(^## Notes\s*\n)/m, `$1${bullet}`);
      await fs.writeFile(target, updated, 'utf-8');
    } else {
      await fs.writeFile(target, existing.trimEnd() + `\n\n## Notes\n${bullet}`, 'utf-8');
    }

    // Reload into system prompt
    await this.loadProjectContext();
    this.messages[0] = {
      role: 'system',
      content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
    };
  }

  private async initSession(fresh: boolean = true): Promise<void> {
    await this.loadProjectContext();
    try {
      this.customCommands = await loadCustomCommands();
    } catch {
      this.customCommands = [];
    }

    if (fresh) {
      this.messages = [
        {
          role: 'system',
          content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
        },
      ];
      this.session = await this.history.createSession(process.cwd());
      this.sessionStartTime = new Date();
    }
  }

  async start(): Promise<void> {
    await this.initSession(true);
    this.printWelcome();
    await this.loop();
  }

  // Non-interactive single prompt mode (piped input or CLI args)
  async sendSingle(prompt: string): Promise<void> {
    // In non-interactive mode there's no human to answer permission prompts.
    // Auto-approve everything so tool calls can complete.
    this.permissions.setYolo(true);

    await this.initSession(true);
    try {
      const trimmed = prompt.trim();

      // Slash commands and prefixes need to be routed through the same
      // handlers as the interactive loop — otherwise `grok chat "/init"`
      // would just send the literal text "/init" to Grok as a user
      // message instead of running handleInit.
      if (trimmed.startsWith('/') && trimmed !== '/') {
        await this.handleCommand(trimmed);
      } else if (trimmed.startsWith('!')) {
        const cmd = trimmed.slice(1).trim();
        if (cmd) await this.runShellEscape(cmd);
      } else {
        await this.processMessage(prompt, { quietPrompt: true });
      }
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }
    process.exit(0);
  }

  async resume(sessionId?: string): Promise<void> {
    await this.loadProjectContext();
    try {
      this.customCommands = await loadCustomCommands();
    } catch {
      this.customCommands = [];
    }

    let session: ConversationSession | null = null;
    if (sessionId) {
      session = await this.history.loadSession(sessionId);
    } else {
      session = await this.history.getLastSession();
    }

    if (!session) {
      console.log(chalk.yellow('No previous session found. Starting fresh.\n'));
      await this.start();
      return;
    }

    this.session = session;
    this.messages = session.messages;
    this.sessionStartTime = new Date();

    this.printWelcome(session.title);

    // Show recent context
    const recent = this.messages.filter((m) => m.role !== 'system').slice(-4);
    if (recent.length > 0) {
      console.log(chalk.dim('  ── Recent context ──'));
      for (const msg of recent) {
        const text = typeof msg.content === 'string' ? msg.content : '[multimodal]';
        if (msg.role === 'user') {
          console.log(chalk.dim('  › You: ') + chalk.dim(text.slice(0, 80) + (text.length > 80 ? '…' : '')));
        } else if (msg.role === 'assistant' && text) {
          console.log(chalk.dim('  › Grok: ') + chalk.dim(text.slice(0, 80) + (text.length > 80 ? '…' : '')));
        }
      }
      console.log();
    }

    await this.loop();
  }

  private printWelcome(resumedTitle?: string): void {
    // Claude-Code-faithful welcome: small bordered box, a single ✻ icon
    // (saffron, matching tiranga), help hint, and cwd. Mascot is shown
    // small and only on the FIRST run of a project — to greet the user
    // without dominating the screen on every launch.
    const cols = process.stdout.columns || 80;
    const width = Math.min(cols - 2, 62);
    const innerWidth = width - 4;

    const top = chalk.dim('╭' + '─'.repeat(width - 2) + '╮');
    const bot = chalk.dim('╰' + '─'.repeat(width - 2) + '╯');
    const line = (text: string): string => {
      const visible = text.replace(/\x1B\[[0-9;]*m/g, '');
      const pad = Math.max(0, innerWidth - visible.length);
      return chalk.dim('│ ') + text + ' '.repeat(pad) + chalk.dim(' │');
    };

    // Naavi mascot above the box. Suppressed in non-TTY (pipes, CI) so
    // log output stays clean.
    if (process.stdout.isTTY && cols >= 36) {
      console.log();
      console.log(NAAVI_MASCOT);
    }

    const cwd = process.cwd().replace(os.homedir(), '~');

    console.log();
    console.log(top);
    console.log(line(SAFFRON('✻') + ' ' + chalk.bold('Welcome to Grok Code!')));
    console.log(line(''));
    console.log(line(chalk.dim('  /help for help, /status for your current setup')));
    console.log(line(''));
    console.log(line(chalk.dim('  cwd: ') + cwd));
    // Provider + model + base URL + KEY PREFIX. The key prefix is the only
    // truly irrefutable proof of which provider the next request will hit:
    // `xai-...` keys MUST go to xAI, `sk-or-...` keys MUST go to OpenRouter,
    // because the routing is derived from the prefix.
    const provTag = this.client.provider === 'xai' ? SAFFRON('xai') : chalk.cyan('openrouter');
    const baseUrl = this.client.provider === 'xai' ? 'api.x.ai/v1' : 'openrouter.ai/api/v1';
    const keyPrefix = redactKey(this.apiKey);
    console.log(line(chalk.dim('  api: ') + provTag + chalk.dim(' · ') + chalk.white(this.client.model)));
    console.log(line(chalk.dim('       ') + chalk.dim(baseUrl) + chalk.dim(' · key ') + chalk.white(keyPrefix)));
    if (resumedTitle) {
      console.log(line(chalk.dim('  resumed: ') + chalk.yellow(resumedTitle)));
    }
    if (this.projectContext) {
      console.log(line(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(' GROK.md loaded')));
    }
    if (this.customCommands.length > 0) {
      console.log(line(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(` ${this.customCommands.length} custom command${this.customCommands.length === 1 ? '' : 's'}`)));
    }
    console.log(bot);
    console.log();
  }

  private async loop(): Promise<void> {
    const showPrompt = (): Promise<string> => {
      return new Promise((resolve) => {
        // Claude-Code-style boxed input:
        //
        //   ╭─────────────────────────────────────────╮
        //   │ > _                                     │
        //   ╰─────────────────────────────────────────╯
        //     ⏵⏵ plan mode on (shift+tab to cycle)        ⎿  ▾  model
        //
        // We can't draw the right `│` and bottom `╰─╯` *during* typing
        // without a full Ink-style renderer, so:
        //   • top border is printed before the readline prompt
        //   • prompt becomes `│ > ` (left edge baked in)
        //   • after the user submits, bottom border + footer are printed
        // This keeps the visual identical to Claude Code at the moment
        // the response begins, even if the box is "open-bottom" while the
        // user is typing.
        const cols = process.stdout.columns || 80;
        const width = Math.min(cols - 2, 90);
        const top = chalk.dim('╭' + '─'.repeat(width - 2) + '╮');
        const bot = chalk.dim('╰' + '─'.repeat(width - 2) + '╯');

        const modeBadges: string[] = [];
        if (this.planMode) {
          modeBadges.push(chalk.yellow('⏵⏵ plan mode on') + chalk.dim(' (shift+tab to cycle)'));
        } else {
          modeBadges.push(chalk.dim('⏵⏵ ') + chalk.dim('default mode') + chalk.dim(' (shift+tab to cycle)'));
        }
        if (this.pending.images.length > 0) {
          const n = this.pending.images.length;
          modeBadges.push(chalk.magenta(`${n} image${n === 1 ? '' : 's'} attached`));
        }

        const modelLabel = (this.thinkingMode ? '🧠 ' : '⚡ ') + this.client.model;
        // Provider tag — saffron for xAI direct, cyan for OpenRouter — so the
        // user always knows whose API the next message is going to and there's
        // no surprise on the billing dashboard.
        const providerTag = this.client.provider === 'xai'
          ? SAFFRON('xai')
          : chalk.cyan('openrouter');
        const left = chalk.dim('  ') + modeBadges.join(chalk.dim(' · '));
        const right = chalk.dim('⎿  ▾  ') + chalk.white(modelLabel) + chalk.dim(' on ') + providerTag;
        const visibleLen = (s: string): number => s.replace(/\x1B\[[0-9;]*m/g, '').length;
        const padCount = Math.max(2, width - visibleLen(left) - visibleLen(right));
        const footer = left + ' '.repeat(padCount) + right;

        console.log(top);
        this.rl.question(chalk.dim('│ ') + chalk.dim('> '), (answer) => {
          this.clearSlashPopup();
          console.log(bot);
          console.log(footer);
          console.log();
          resolve(answer);
        });
      });
    };

    while (true) {
      let input: string;
      try {
        input = await showPrompt();
      } catch {
        break;
      }
      const trimmed = input.trim();

      if (!trimmed && this.pending.images.length === 0) continue;

      // Shortcut: "exit"/"quit"
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        this.rl.close();
        break;
      }

      // ! prefix — shell escape. Runs the command directly via Bash tool
      // without involving Grok. Useful for quick git/ls/grep in-session.
      if (trimmed.startsWith('!')) {
        const command = trimmed.slice(1).trim();
        if (command) {
          await this.runShellEscape(command);
        }
        continue;
      }

      // # prefix — quick-add a line to GROK.md memory.
      if (trimmed.startsWith('#')) {
        const text = trimmed.slice(1).trim();
        if (text) {
          await this.handleMemoryAdd(text);
        }
        continue;
      }

      // ? — show help
      if (trimmed === '?') {
        this.showHelp();
        continue;
      }

      // Handle slash commands
      if (trimmed === '/') {
        const options: SelectorOption[] = [
          ...Object.entries(GrokChat.SLASH_COMMANDS).map(([cmd, desc]) => ({
            label: cmd,
            value: cmd,
            description: desc,
          })),
          ...this.customCommands.map((c) => ({
            label: `/${c.name}`,
            value: `/${c.name}`,
            description: `${c.source === 'project' ? '[project]' : '[user]'} ${c.description}`,
          })),
        ];

        const selected = await interactiveSelect('Commands:', options);
        if (selected) {
          const shouldExit = await this.handleCommand(selected);
          if (shouldExit) {
            this.rl.close();
            break;
          }
        }
        continue;
      }

      if (trimmed.startsWith('/')) {
        const shouldExit = await this.handleCommand(trimmed);
        if (shouldExit) {
          this.rl.close();
          break;
        }
        continue;
      }

      // Auto-compact if context is getting full (~80%)
      const totalChars = this.estimateTokens();
      if (totalChars > this.contextWindowTokens * 0.8) {
        console.log(chalk.dim('  Auto-compacting context...'));
        await this.handleCompact();
      }

      await this.processMessage(trimmed);
    }
  }

  // === Command Handler ===

  private async handleCommand(command: string): Promise<boolean> {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    // Check custom commands first (allow project overrides)
    const custom = this.customCommands.find((c) => c.name.toLowerCase() === cmd);
    if (custom) {
      const processed = processCommandArgs(custom.content, args);
      console.log(chalk.dim(`  ▸ Running custom command: /${custom.name}`));
      await this.processMessage(processed);
      return false;
    }

    switch (cmd) {
      // Session
      case 'clear':
      case 'c':
        this.messages = [this.messages[0]];
        this.session = await this.history.createSession(process.cwd());
        this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, reasoningTokens: 0 };
        console.log(chalk.dim('  Conversation cleared.'));
        break;

      case 'exit':
      case 'q':
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        return true;

      case 'save':
      case 's':
        await this.saveSession();
        console.log(chalk.dim('  Session saved.'));
        break;

      case 'compact':
        await this.handleCompact(args);
        break;

      case 'history':
        await this.showHistory();
        break;

      case 'resume':
        await this.handleResume(args);
        break;

      case 'rename':
        await this.handleRename(args);
        break;

      case 'export':
        await this.handleExport(args);
        break;

      // Config
      case 'config':
        await this.handleConfig();
        break;

      case 'model':
        await this.handleModel(args);
        break;

      case 'stream':
        this.useStreaming = !this.useStreaming;
        console.log();
        console.log('  ' + chalk.bold('Streaming ') + (this.useStreaming ? chalk.green('on') : chalk.dim('off')));
        console.log();
        break;

      case 'plan':
        this.planMode = !this.planMode;
        console.log();
        if (this.planMode) {
          console.log(
            '  ' + chalk.bold('Plan mode ') + chalk.yellow('on') +
            chalk.dim(' — read-only. Write/Edit/MultiEdit/Bash/KillBash blocked until ExitPlanMode is approved.')
          );
        } else {
          console.log('  ' + chalk.bold('Plan mode ') + chalk.dim('off'));
        }
        console.log();
        break;

      case 'permissions':
        this.handlePermissions();
        break;

      // Status & info
      case 'status':
        this.showStatus();
        break;

      case 'whoami':
        await this.handleWhoami();
        break;

      case 'context':
        this.showContext();
        break;

      case 'cost':
        this.showCost();
        break;

      case 'usage':
        this.showUsage();
        break;

      case 'doctor':
        await this.runDoctor();
        break;

      // Directories
      case 'add-dir':
        this.handleAddDir(args);
        break;

      case 'pwd':
        console.log();
        console.log(chalk.bold('  Working directories:'));
        this.workingDirs.forEach((dir, i) => {
          console.log(`  ${i === 0 ? chalk.cyan('→') : ' '} ${dir}`);
        });
        console.log();
        break;

      // Auth
      case 'login': {
        // Pass our own rl so setupAuth doesn't spawn a second readline
        // interface on the same stdin (that was the "disrupting" bug).
        const loginSuccess = await this.config.setupAuth(this.rl);
        if (loginSuccess) {
          const newKey = await this.config.getApiKey();
          if (newKey) {
            this.apiKey = newKey;
            this.client = new GrokClient(newKey, this.client.model);
            process.env.GROK_RUNTIME_API_KEY = newKey;
            process.env.GROK_RUNTIME_PROVIDER = this.client.provider;
            console.log(chalk.dim('  ✓ Logged in.'));
          }
        }
        break;
      }

      case 'logout': {
        const hadKey = !!(await this.config.getApiKey());
        this.config.delete('apiKey');
        if (hadKey) {
          console.log(chalk.dim('  ✓ Logged out. Run /login to authenticate again.'));
        } else {
          console.log(chalk.dim('  (no credentials stored)'));
        }
        break;
      }

      // Images
      case 'image':
      case 'paste':
        if (args && !args.startsWith('clipboard')) {
          await this.attachImageFromPath(args);
        } else {
          await this.attachImageFromClipboard();
        }
        break;

      case 'imagine':
        await this.handleImagine(args);
        break;

      case 'voice':
      case 'transcribe':
        await this.handleVoice(args);
        break;

      case 'speak':
      case 'tts':
        await this.handleSpeak(args);
        break;

      // Custom commands listing
      case 'commands':
        console.log();
        console.log(getCommandHelp(this.customCommands));
        console.log(chalk.dim('\n  Drop .md files in .grok/commands/ or ~/.grok/commands/ to add more.\n'));
        break;

      // Help
      case 'help':
      case 'h':
        this.showHelp();
        break;

      case 'version':
      case 'v':
        console.log(chalk.dim(`  Grok Code v${VERSION}`));
        break;

      // Project
      case 'init':
        await this.handleInit();
        break;

      case 'memory':
        await this.handleMemory(args);
        break;

      case 'review':
        await this.handleReview(args);
        break;

      case 'security-review':
      case 'sec-review':
        await this.handleSecurityReview();
        break;

      case 'pr-comments':
      case 'pr':
        await this.handlePrComments(args);
        break;

      // Tasks & utilities
      case 'todos':
        this.showTodos();
        break;

      case 'todo':
        this.handleTodo(args);
        break;

      case 'vim':
        this.toggleVimMode();
        break;

      case 'terminal-setup':
        this.showTerminalSetup();
        break;

      case 'upgrade':
      case 'update':
        this.showUpgrade();
        break;

      case 'feedback':
        this.showFeedback();
        break;

      // Undo / backup
      case 'back':
      case 'undo':
        this.handleBack();
        break;

      case 'backup':
        await this.handleBackup(args);
        break;

      // Style / theme
      case 'output-style':
      case 'style':
        await this.handleOutputStyle(args);
        break;

      case 'theme':
        await this.handleTheme(args);
        break;

      // Info
      case 'release-notes':
      case 'releases':
      case 'changelog':
        await this.handleReleaseNotes();
        break;

      case 'bug':
      case 'report':
        this.handleBug();
        break;

      default:
        console.log(chalk.yellow(`  Unknown command: /${cmd}`));
        console.log(chalk.dim('  Type /help to see available commands.'));
    }

    return false;
  }

  // === Command Handlers ===

  private async handleCompact(instructions?: string): Promise<void> {
    const keepCount = 20;
    const originalCount = this.messages.length;

    if (this.messages.length > keepCount + 1) {
      const systemPrompt = this.messages[0];
      const recentMessages = this.messages.slice(-keepCount);
      this.messages = [systemPrompt, ...recentMessages];
    }

    const removedCount = originalCount - this.messages.length;
    console.log(chalk.dim(`  Compacted: removed ${removedCount} messages, kept ${this.messages.length}.`));

    if (instructions) {
      console.log(chalk.dim(`  Focus: ${instructions}`));
    }
  }

  private async handleResume(sessionId: string): Promise<void> {
    const sessions = await this.history.listSessions(10);

    if (sessions.length === 0) {
      console.log(chalk.dim('  No saved sessions.'));
      return;
    }

    if (!sessionId) {
      const options: SelectorOption[] = sessions.map((s) => {
        const date = new Date(s.updatedAt).toLocaleDateString();
        return {
          label: s.title || s.id.slice(0, 8),
          value: s.id,
          description: `${date} • ${s.messages.length} msgs`,
        };
      });

      console.log();
      const selected = await interactiveSelect('Resume session:', options);
      if (!selected) return;
      sessionId = selected;
    }

    let session = await this.history.loadSession(sessionId);
    if (!session) {
      const match = sessions.find((s) => s.id.startsWith(sessionId));
      if (match) session = match;
      else {
        console.log(chalk.red(`  Session not found: ${sessionId}`));
        return;
      }
    }

    this.session = session;
    this.messages = session.messages;
    console.log(chalk.dim(`  ✓ Resumed: ${session.title}`));
  }

  private async handleRename(name: string): Promise<void> {
    if (!name) {
      console.log(chalk.yellow('  Usage: /rename <new-name>'));
      return;
    }

    if (this.session) {
      this.session.title = name;
      await this.saveSession();
      console.log(chalk.dim(`  Session renamed: ${name}`));
    } else {
      console.log(chalk.red('  No active session.'));
    }
  }

  private async handleExport(filename?: string): Promise<void> {
    const content = this.messages
      .filter((m) => m.role !== 'system')
      .map((m) => {
        const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Grok' : 'Tool';
        const text = typeof m.content === 'string' ? m.content : '[multimodal content]';
        return `## ${role}\n\n${text}\n`;
      })
      .join('\n---\n\n');

    if (filename) {
      const filePath = path.resolve(filename);
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(chalk.dim(`  Exported to ${filePath}`));
    } else {
      console.log(chalk.dim('\n  ── Exported conversation ──\n'));
      console.log(content.slice(0, 2000));
      if (content.length > 2000) {
        console.log(chalk.dim('\n  … (truncated, use /export <filename> to save full)'));
      }
      console.log();
    }
  }

  private async handleConfig(): Promise<void> {
    console.log();
    console.log(chalk.bold('  Configuration'));
    console.log(chalk.dim('  ─────────────'));
    const apiKey = await this.config.getApiKey();
    console.log(`  API Key:      ${apiKey ? chalk.green('✓ set') : chalk.red('✗ not set')}`);
    console.log(`  Model:        ${this.client.model}`);
    console.log(`  Streaming:    ${this.useStreaming ? 'on' : 'off'}`);
    console.log(`  Plan mode:    ${this.planMode ? 'on' : 'off'}`);
    console.log(`  Temperature:  ${this.config.get('temperature')}`);
    console.log(`  Max tokens:   ${this.config.get('maxTokens')}`);
    console.log(`  Auto-approve: ${(this.config.get('autoApprove') as string[]).join(', ') || 'none'}`);
    console.log();
  }

  private async handleModel(modelName?: string): Promise<void> {
    process.stdout.write(chalk.dim('  Fetching models…'));

    let availableModels: string[] = [];
    try {
      availableModels = await this.client.listModels();
      availableModels.sort();
    } catch {
      availableModels = [
        'grok-4-1-fast-reasoning',
        'grok-4-1-fast-non-reasoning',
        'grok-4-0709',
        'grok-4-fast-reasoning',
        'grok-4-fast-non-reasoning',
        'grok-3',
        'grok-3-mini',
      ];
    }

    process.stdout.write('\r\x1B[K');

    if (modelName) {
      let matchedModel = modelName;
      if (!availableModels.includes(modelName)) {
        const normalized = modelName
          .toLowerCase()
          .replace(/grok\s*(\d)(\d)?/g, (_, d1, d2) => (d2 ? `grok-${d1}-${d2}` : `grok-${d1}`))
          .replace(/(\d+)\.(\d+)/g, '$1-$2')
          .replace(/\s+/g, '-');

        const partialMatch =
          availableModels.find((m) => m.toLowerCase().includes(normalized)) ||
          availableModels.find((m) => m.toLowerCase().includes(modelName.toLowerCase()));

        if (partialMatch) matchedModel = partialMatch;
        else {
          console.log(chalk.red(`  Unknown model: ${modelName}`));
          return;
        }
      }

      this.parseModelMode(matchedModel);
      this.client = new GrokClient(this.apiKey, matchedModel);
      this.announceModelChange(matchedModel);
      return;
    }

    const options: SelectorOption[] = [];

    const grok41 = availableModels.filter((m) => m.startsWith('grok-4-1'));
    const grok4 = availableModels.filter((m) => m.startsWith('grok-4') && !m.startsWith('grok-4-1'));
    const grok3 = availableModels.filter((m) => m.startsWith('grok-3'));
    const grok2 = availableModels.filter((m) => m.startsWith('grok-2'));
    const others = availableModels.filter(
      (m) => !m.startsWith('grok-4') && !m.startsWith('grok-3') && !m.startsWith('grok-2')
    );

    // Vision capability heuristics. Grok 4 (and later 4.x), all 2-vision
    // variants, and explicitly named -vision models accept image_url parts.
    // grok-3 and grok-3-mini are text-only.
    const supportsVision = (model: string): boolean => {
      const m = model.toLowerCase();
      if (m.includes('vision')) return true;
      if (m.includes('image')) return true; // image-gen / multimodal
      if (m.startsWith('grok-4') || m.startsWith('x-ai/grok-4')) return true;
      if (m.startsWith('grok-2-vision')) return true;
      return false;
    };

    const describe = (model: string): string => {
      const tags: string[] = [];
      if (model.includes('non-reasoning')) tags.push('fast');
      else if (model.includes('reasoning')) tags.push('reasoning');
      else if (model.includes('mini')) tags.push('small/fast');
      if (model.includes('image')) tags.push('image gen');
      else if (model.includes('vision')) tags.push('vision');
      if (supportsVision(model) && !tags.includes('vision')) tags.push('👁 vision');
      return tags.join(' · ');
    };

    for (const m of [...grok41, ...grok4, ...grok3, ...grok2, ...others]) {
      const labelPrefix = supportsVision(m) ? '👁 ' : '   ';
      options.push({ label: `${labelPrefix}${m}`, value: m, description: describe(m) });
    }

    console.log();
    const selected = await interactiveSelect('Select model:', options, this.client.model);

    if (selected && selected !== this.client.model) {
      this.parseModelMode(selected);
      this.client = new GrokClient(this.apiKey, selected);
      this.announceModelChange(selected);
    } else if (!selected) {
      console.log(chalk.dim('  Cancelled.'));
    }
  }

  /**
   * Show a prominent Claude Code-style acknowledgement when the active
   * model changes — matches the visual weight of a tool-call header so
   * the user can't miss it.
   */
  private announceModelChange(model: string): void {
    const modeIcon = this.thinkingMode ? '🧠' : '⚡';
    const modeLabel = this.thinkingMode ? 'thinking' : 'fast';
    console.log();
    console.log(
      '  ' + chalk.bold('Model set to ') +
      chalk.white(model) +
      chalk.dim(`  (${modeIcon} ${modeLabel} mode)`)
    );
    console.log();
  }

  private handlePermissions(): void {
    console.log();
    console.log(chalk.bold('  Permissions'));
    console.log(chalk.dim('  ───────────'));
    console.log(`  ${chalk.green('📖 Read')}    Read, Glob, Grep, WebFetch, WebSearch`);
    console.log(`  ${chalk.yellow('✏️  Write')}   Write, Edit`);
    console.log(`  ${chalk.red('⚡ Execute')} Bash`);
    console.log();
    console.log(chalk.bold('  Prompt responses'));
    console.log('  ' + chalk.dim('1. Yes  ·  2. Yes, don\'t ask again this session  ·  3. No (esc)'));
    console.log();
    const auto = (this.config.get('autoApprove') as string[]).join(', ') || 'none';
    console.log(chalk.dim(`  Auto-approved: ${auto}`));
    console.log();
  }

  /**
   * /whoami — irrefutable proof of which provider + model is active.
   * Hits the live API for a real round-trip and prints what came back.
   * Useful when the user wants to verify their OpenRouter / xAI key is
   * actually being used (instead of just trusting the in-app label).
   */
  private async handleWhoami(): Promise<void> {
    const provider = this.client.provider;
    const baseUrl = provider === 'xai' ? 'https://api.x.ai/v1' : 'https://openrouter.ai/api/v1';
    const provTag = provider === 'xai'
      ? SAFFRON('xai (api.x.ai/v1)')
      : chalk.cyan('openrouter (openrouter.ai/api/v1)');

    console.log();
    console.log(chalk.bold('  /whoami'));
    console.log(chalk.dim('  ───────'));
    console.log(`  Configured:  ${provTag}`);
    console.log(`  Key:         ${chalk.white(redactKey(this.apiKey))}`);
    console.log(`  Model:       ${chalk.white(this.client.model)}`);
    console.log();
    console.log(chalk.dim('  Probing the live API to confirm…'));

    const startedAt = Date.now();
    let probeOk = false;
    let probeDetail = '';
    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...(provider === 'openrouter' ? {
            'HTTP-Referer': 'https://github.com/singhpratech/grokcodeclix',
            'X-Title': 'Grok Code CLI',
          } : {}),
        },
      });
      const ms = Date.now() - startedAt;
      if (response.ok) {
        const data = (await response.json()) as { data?: Array<{ id: string }> };
        const ids = (data.data || []).map((m) => m.id);
        probeOk = true;
        const grokIds = ids.filter((id) => /grok/i.test(id));
        const total = ids.length;
        const sample = grokIds.slice(0, 5).join(', ') || '(none with "grok" in id)';
        probeDetail =
          `${INDIA_GREEN('✓')} HTTP 200 in ${ms}ms · ${total} models listed\n` +
          `       sample (grok-only): ${chalk.dim(sample)}`;

        // Sanity-check: the configured model id should be in the list.
        const exact = ids.includes(this.client.model);
        if (exact) {
          probeDetail += `\n       ${INDIA_GREEN('✓')} ${chalk.white(this.client.model)} is in the model list returned by ${provider}`;
        } else {
          probeDetail += `\n       ${chalk.yellow('!')} ${chalk.white(this.client.model)} is NOT in the model list — request may 404`;
        }
      } else {
        const text = await response.text().catch(() => '');
        probeDetail = `${chalk.red('✗')} HTTP ${response.status} in ${ms}ms · ${text.slice(0, 200)}`;
      }
    } catch (err) {
      const ms = Date.now() - startedAt;
      probeDetail = `${chalk.red('✗')} Network error in ${ms}ms · ${(err as Error).message}`;
    }

    console.log(`  Probe:       ${probeDetail}`);
    console.log();
    console.log(chalk.dim('  Cross-check on the provider dashboard:'));
    if (provider === 'openrouter') {
      console.log(chalk.dim('    https://openrouter.ai/activity — should show this request'));
    } else {
      console.log(chalk.dim('    https://console.x.ai/        — should show this request under Usage'));
    }
    console.log();
    if (!probeOk) return;
  }

  private showStatus(): void {
    const uptime = Math.floor((Date.now() - this.sessionStartTime.getTime()) / 1000);
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;
    const estTokens = this.estimateTokens();
    const usagePct = Math.min(100, Math.round((estTokens / this.contextWindowTokens) * 100));

    console.log();
    console.log('  ' + chalk.bold('Grok Code Status'));
    console.log(chalk.dim('  ────────────────'));
    console.log();

    console.log(chalk.bold('  Version & model'));
    console.log(`    Version:   ${VERSION}`);
    const provLabel = this.client.provider === 'xai'
      ? SAFFRON('xai') + chalk.dim(' (api.x.ai/v1)')
      : chalk.cyan('openrouter') + chalk.dim(' (openrouter.ai/api/v1)');
    console.log(`    Provider:  ${provLabel}`);
    console.log(`    Model:     ${chalk.white(this.client.model)}`);
    console.log(`    Mode:      ${this.thinkingMode ? '🧠 Thinking' : '⚡ Fast'}${this.planMode ? chalk.yellow(' · plan mode') : ''}`);
    console.log(`    Streaming: ${this.useStreaming ? 'on' : 'off'}`);
    console.log(`    Style:     ${this.outputStyle}`);
    console.log();

    console.log(chalk.bold('  Session'));
    console.log(`    Title:     ${this.session?.title || 'Untitled'}`);
    console.log(`    ID:        ${this.session?.id.slice(0, 8) || 'N/A'}`);
    console.log(`    Messages:  ${this.messages.length} (${this.messages.filter((m) => m.role === 'user').length} user, ${this.messages.filter((m) => m.role === 'assistant').length} grok, ${this.messages.filter((m) => m.role === 'tool').length} tools)`);
    console.log(`    Uptime:    ${minutes}m ${seconds}s`);
    console.log(`    Undo:      ${this.undoStack.length} snapshot(s) available`);
    console.log();

    console.log(chalk.bold('  Context'));
    console.log(`    Used:      ~${estTokens.toLocaleString()} / ${this.contextWindowTokens.toLocaleString()} tokens (${usagePct}%)`);
    console.log(`    Tokens:    ${this.tokenUsage.totalTokens.toLocaleString()} this session`);
    console.log();

    console.log(chalk.bold('  Project'));
    console.log(`    CWD:       ${process.cwd()}`);
    if (this.workingDirs.length > 1) {
      for (const d of this.workingDirs.slice(1)) {
        console.log(`               ${d}`);
      }
    }
    console.log(`    Memory:    ${this.projectContext ? INDIA_GREEN('✓') + ' GROK.md loaded' : chalk.dim('none — run /init')}`);
    console.log(`    Commands:  ${this.customCommands.length > 0 ? INDIA_GREEN('✓') + ` ${this.customCommands.length} custom` : chalk.dim('none')}`);
    console.log();

    console.log(chalk.bold('  Environment'));
    console.log(`    Platform:  ${process.platform} ${os.arch()}`);
    console.log(`    Node:      ${process.version}`);
    console.log(`    Config:    ~/.config/grokcodecli-nodejs/`);
    console.log();
  }

  private estimateTokens(): number {
    const totalChars = this.messages.reduce((acc, m) => {
      if (typeof m.content === 'string') return acc + m.content.length;
      if (Array.isArray(m.content)) {
        return acc + m.content.reduce((a, p) => (p.type === 'text' ? a + p.text.length : a + 800), 0);
      }
      return acc;
    }, 0);
    return Math.ceil(totalChars / 4);
  }

  private showContext(): void {
    const estimatedTokens = this.estimateTokens();
    const maxTokens = this.contextWindowTokens;
    const usagePercent = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100));

    console.log();
    console.log(chalk.bold('  Context window'));
    console.log(chalk.dim('  ──────────────'));

    const barWidth = 40;
    const filledWidth = Math.round((usagePercent / 100) * barWidth);
    const bar = chalk.cyan('█'.repeat(filledWidth)) + chalk.dim('░'.repeat(barWidth - filledWidth));
    console.log(`  [${bar}] ${usagePercent}%`);
    console.log();
    console.log(`  Estimated tokens: ~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`);
    const userMessages = this.messages.filter((m) => m.role === 'user').length;
    const assistantMessages = this.messages.filter((m) => m.role === 'assistant').length;
    const toolMessages = this.messages.filter((m) => m.role === 'tool').length;
    console.log(`  Messages:         ${this.messages.length}  (you: ${userMessages}, grok: ${assistantMessages}, tools: ${toolMessages})`);
    console.log();
    if (usagePercent > 80) {
      console.log(chalk.yellow('  ⚠ Context is getting full. Consider /compact.'));
      console.log();
    }
  }

  private showCost(): void {
    const inputCostPer1M = 0.2;
    const cachedInputCostPer1M = 0.05;
    const outputCostPer1M = 0.5;

    const inputCost = (this.tokenUsage.promptTokens / 1_000_000) * inputCostPer1M;
    const outputCost = (this.tokenUsage.completionTokens / 1_000_000) * outputCostPer1M;
    const totalCost = inputCost + outputCost;

    console.log();
    console.log(chalk.bold('  Token usage (estimated cost)'));
    console.log(chalk.dim('  ────────────────────────────'));
    console.log(`  Input:     ${this.tokenUsage.promptTokens.toLocaleString()} tokens`);
    console.log(`  Output:    ${this.tokenUsage.completionTokens.toLocaleString()} tokens`);
    if (this.tokenUsage.reasoningTokens > 0) {
      console.log(`  Reasoning: ${this.tokenUsage.reasoningTokens.toLocaleString()} tokens`);
    }
    console.log(`  Total:     ${this.tokenUsage.totalTokens.toLocaleString()} tokens`);
    console.log();
    console.log(`  Estimated: ${chalk.cyan('$' + totalCost.toFixed(4))}`);
    console.log(chalk.dim(`  (rates vary by model — ~$${inputCostPer1M}/M input, $${outputCostPer1M}/M output for Grok 4.1 Fast; check console.x.ai)`));
    console.log();
  }

  private showUsage(): void {
    console.log();
    console.log(chalk.bold('  Usage'));
    console.log(chalk.dim('  ─────'));
    console.log(`  Session tokens: ${this.tokenUsage.totalTokens.toLocaleString()}`);
    console.log(`  Messages sent:  ${this.messages.filter((m) => m.role === 'user').length}`);
    console.log(`  Tool calls:     ${this.messages.filter((m) => m.role === 'tool').length}`);
    console.log();
    console.log(chalk.dim('  Billing: https://console.x.ai/'));
    console.log();
  }

  private async runDoctor(): Promise<void> {
    console.log();
    console.log(chalk.bold('  Running diagnostics…'));
    console.log();

    const checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[] = [];

    const apiKey = await this.config.getApiKey();
    if (apiKey) {
      checks.push({ name: 'API Key', status: 'ok', message: 'configured' });
    } else {
      checks.push({ name: 'API Key', status: 'fail', message: 'missing — run `grokclix auth`' });
    }

    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 18) {
      checks.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion} (≥18 required)` });
    } else {
      checks.push({ name: 'Node.js', status: 'fail', message: `${nodeVersion} — upgrade to ≥18` });
    }

    try {
      await fs.access(process.cwd(), fs.constants.R_OK | fs.constants.W_OK);
      checks.push({ name: 'Working Dir', status: 'ok', message: 'r/w access' });
    } catch {
      checks.push({ name: 'Working Dir', status: 'warn', message: 'limited access' });
    }

    const configDir = path.join(os.homedir(), '.config', 'grokcodecli');
    try {
      await fs.access(configDir);
      checks.push({ name: 'Config Dir', status: 'ok', message: configDir });
    } catch {
      checks.push({ name: 'Config Dir', status: 'warn', message: 'will be created on first use' });
    }

    try {
      const { execSync } = await import('child_process');
      execSync('git --version', { stdio: 'pipe' });
      checks.push({ name: 'Git', status: 'ok', message: 'available' });
    } catch {
      checks.push({ name: 'Git', status: 'warn', message: 'not found (optional)' });
    }

    // Memory files
    const globalMemPath = path.join(os.homedir(), '.grok', 'GROK.md');
    const projectMemPath = path.join(process.cwd(), 'GROK.md');
    try {
      await fs.access(globalMemPath);
      checks.push({ name: 'Global memory', status: 'ok', message: '~/.grok/GROK.md' });
    } catch {
      checks.push({ name: 'Global memory', status: 'warn', message: 'none (optional)' });
    }
    try {
      await fs.access(projectMemPath);
      checks.push({ name: 'Project memory', status: 'ok', message: 'GROK.md' });
    } catch {
      checks.push({ name: 'Project memory', status: 'warn', message: 'none — run /init' });
    }

    // Custom commands
    if (this.customCommands.length > 0) {
      checks.push({
        name: 'Custom commands',
        status: 'ok',
        message: `${this.customCommands.length} loaded`,
      });
    } else {
      checks.push({ name: 'Custom commands', status: 'warn', message: 'none' });
    }

    // Clipboard tools (for /paste)
    try {
      const { execSync } = await import('child_process');
      const tool =
        process.platform === 'darwin' ? 'pngpaste' :
        process.platform === 'win32' ? 'powershell' :
        'xclip';
      execSync(`which ${tool}`, { stdio: 'pipe' });
      checks.push({ name: 'Clipboard tool', status: 'ok', message: `${tool} available` });
    } catch {
      const suggestion =
        process.platform === 'darwin' ? 'brew install pngpaste' :
        process.platform === 'win32' ? 'n/a' :
        'sudo apt install xclip';
      checks.push({ name: 'Clipboard tool', status: 'warn', message: `not installed — ${suggestion}` });
    }

    if (apiKey) {
      try {
        const models = await this.client.listModels();
        checks.push({ name: 'API Connection', status: 'ok', message: `${models.length} models available` });
      } catch (error) {
        checks.push({ name: 'API Connection', status: 'fail', message: (error as Error).message });
      }
    }

    for (const check of checks) {
      const icon =
        check.status === 'ok'
          ? chalk.green('✓')
          : check.status === 'warn'
          ? chalk.yellow('⚠')
          : chalk.red('✗');
      console.log(`  ${icon} ${check.name.padEnd(16)} ${chalk.dim(check.message)}`);
    }

    const failures = checks.filter((c) => c.status === 'fail').length;
    const warnings = checks.filter((c) => c.status === 'warn').length;

    console.log();
    if (failures > 0) {
      console.log(chalk.red(`  ${failures} issue(s). Fix before using.`));
    } else if (warnings > 0) {
      console.log(chalk.yellow(`  ${warnings} warning(s). Should still work.`));
    } else {
      console.log(chalk.green('  All checks passed.'));
    }
    console.log();
  }

  private handleAddDir(dirPath: string): void {
    if (!dirPath) {
      console.log(chalk.yellow('  Usage: /add-dir <path>'));
      return;
    }

    const resolved = path.resolve(dirPath);
    if (this.workingDirs.includes(resolved)) {
      console.log(chalk.yellow(`  Already added: ${resolved}`));
      return;
    }

    this.workingDirs.push(resolved);
    // Rebuild system prompt with new cwd list
    this.messages[0] = {
      role: 'system',
      content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
    };
    console.log(chalk.dim(`  + ${resolved}`));
  }

  private async showHistory(): Promise<void> {
    const sessions = await this.history.listSessions(10);

    if (sessions.length === 0) {
      console.log(chalk.dim('  No saved sessions.'));
      return;
    }

    const options: SelectorOption[] = sessions.map((s) => {
      const date = new Date(s.updatedAt).toLocaleDateString();
      const isCurrent = s.id === this.session?.id;
      return {
        label: s.title || s.id.slice(0, 8),
        value: s.id,
        description: `${date} • ${s.messages.length} msgs${isCurrent ? ' (current)' : ''}`,
      };
    });

    console.log();
    const selected = await interactiveSelect('Sessions:', options, this.session?.id);

    if (selected && selected !== this.session?.id) {
      const session = sessions.find((s) => s.id === selected);
      if (session) {
        this.session = session;
        this.messages = session.messages;
        console.log(chalk.dim(`  ✓ Switched to: ${session.title}`));
      }
    }
  }

  private async handleInit(): Promise<void> {
    const grokMdPath = path.join(process.cwd(), 'GROK.md');
    const cwd = process.cwd();

    // Refuse to overwrite an existing GROK.md
    try {
      await fs.access(grokMdPath);
      console.log(chalk.yellow('  GROK.md already exists in this project.'));
      console.log(chalk.dim('  Delete it first or use /memory edit to modify.'));
      return;
    } catch {
      // doesn't exist — good, proceed
    }

    // Scaffold the .grok/commands/ directory alongside GROK.md
    await initCommandsDir();

    console.log();
    console.log(SAFFRON('✻ ') + chalk.bold('Initializing project memory…'));
    console.log(chalk.dim('  Analyzing the codebase and generating GROK.md with real content.'));
    console.log();

    // Agentic init: direct, imperative prompt that ends with an
    // unambiguous "call Write" instruction. Matches Claude Code /init.
    const initPrompt = `TASK: Create \`${cwd}/GROK.md\` — a project memory file that you (Grok Code) will read on every future session to understand this codebase.

This is a TOOL-CALL task. Your job is to use tools to investigate and then call the Write tool to create the file. Do NOT just describe what you would do — actually do it.

STEPS:
1. Use **Glob** with pattern \`*\` to see top-level files.
2. **Read** the project manifest (package.json, Cargo.toml, go.mod, pyproject.toml, etc. — whichever exists).
3. **Read** README.md if it exists.
4. Use **Glob** with pattern like \`src/**/*\` (or the main source dir's equivalent) to map the source layout. Do not pass a directory to Read — pass individual file paths.
5. **Read** 2-4 of the most important source files (entry points like \`cli\`, \`main\`, \`index\`, \`app\`).
6. Optionally **Bash** \`git log --oneline -10\` for recent context.
7. **Write** \`${cwd}/GROK.md\` using the Write tool. This step is MANDATORY — the task is not complete until Write is called.

FILE CONTENT: 40–80 lines of markdown, every section filled with REAL content you observed. No "<placeholder>", no "TODO", no fictional details. Structure:

\`\`\`markdown
# <actual project name from manifest>

<One-line tagline from README or manifest description>

## What this project does

<2–3 sentences explaining the actual purpose, based on what you read.>

## Tech stack

- **Language**: <primary language>
- **Runtime**: <Node.js / Python / Go / Rust / etc. with version if known>
- **Key dependencies**: <3–6 main libraries with a short note on what each is used for>
- **Build tools**: <compilation/bundling tools actually in use>

## Project structure

\`\`\`
<ASCII tree of 4–8 most important dirs/files with 1-line descriptions>
\`\`\`

## Common commands

\`\`\`bash
<Real commands from package.json scripts / Makefile / etc. — install, build, test, dev, lint>
\`\`\`

## Coding conventions

- <2–5 bullets about the style you observed: naming, indentation, import style, typing, test layout>

## Notes for Grok

- <Project-specific guidance from what you saw>
- Read files before editing them
- Match the existing code style exactly
\`\`\`

CRITICAL: You must call the Write tool with \`file_path\` = \`${cwd}/GROK.md\`. Do not end your turn until the Write tool has been called and succeeded. Do not just summarize — the file must exist on disk when you're done.`;

    await this.processMessage(initPrompt);

    // If Grok didn't write the file, send a follow-up nudging it to do so.
    let exists = false;
    try {
      await fs.access(grokMdPath);
      exists = true;
    } catch {
      // not yet
    }

    if (!exists) {
      console.log();
      console.log(chalk.yellow('  ⚠ GROK.md not yet created. Nudging Grok to call Write…'));
      console.log();
      await this.processMessage(
        `You did not call the Write tool. Call **Write** now with \`file_path\` = \`${grokMdPath}\` and \`content\` = the markdown GROK.md body we discussed. Do not respond with anything except the tool call.`
      );
      try {
        await fs.access(grokMdPath);
        exists = true;
      } catch {
        // still not
      }
    }

    if (exists) {
      await this.loadProjectContext();
      this.messages[0] = {
        role: 'system',
        content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
      };
      console.log();
      console.log('  ' + INDIA_GREEN('✓') + ' ' + chalk.bold('Project initialized.'));
      console.log(chalk.dim(`  ${grokMdPath}`));
      console.log(chalk.dim(`  GROK.md is loaded into the system prompt for this and future sessions.`));
      console.log();
    } else {
      console.log();
      console.log(chalk.yellow('  ⚠ GROK.md was not created. You can run /init again or write it manually with /memory.'));
      console.log();
    }
  }

  private async handleReview(focus?: string): Promise<void> {
    const reviewPrompt = focus
      ? `Review the recent code changes in this project, focusing on: ${focus}

Check for:
1. Code quality and best practices
2. Potential bugs or issues
3. Security vulnerabilities
4. Performance concerns
5. Test coverage gaps

Start by running \`git status\` and \`git diff\` to see what's changed, then provide specific, actionable feedback.`
      : `Review the recent code changes in this project.

Start by running \`git status\` and \`git diff\` to see the changes, then check for:
1. Code quality and best practices
2. Potential bugs or issues
3. Security vulnerabilities
4. Performance concerns
5. Test coverage gaps

Provide specific, actionable feedback.`;

    await this.processMessage(reviewPrompt);
  }

  // === Security review (agentic) ===

  private async handleSecurityReview(): Promise<void> {
    const prompt = `Run a focused security review on this project's UNCOMMITTED changes.

Steps:
1. Use Bash to run \`git status\` and \`git diff\` to see what's changed.
2. For each modified file, look for these specific issues:
   - **Injection**: SQL injection, command injection, XSS, prototype pollution
   - **Auth & secrets**: hardcoded credentials, exposed API keys, weak crypto, missing auth checks
   - **Path traversal**: unvalidated file paths, missing path normalization
   - **SSRF**: unvalidated URLs, internal IP access, file:// schemes
   - **Insecure deserialization**: untrusted JSON.parse without validation, eval/Function
   - **DoS**: regex catastrophic backtracking, unbounded loops, missing rate limits
   - **Crypto**: weak algorithms (MD5, SHA1), missing randomness, hardcoded IVs

For each issue found, report:
- File and line number
- The vulnerable pattern
- A concrete fix
- Severity (low / medium / high / critical)

Be concise and actionable. Do NOT make up issues — only flag what you see in the actual diff.`;

    await this.processMessage(prompt);
  }

  // === GitHub PR comments (gh wrapper) ===

  private async handlePrComments(args?: string): Promise<void> {
    if (!args || !args.trim()) {
      console.log(chalk.yellow('  Usage: /pr-comments <pr-url-or-number>'));
      console.log(chalk.dim('  Example: /pr-comments 42'));
      console.log(chalk.dim('  Example: /pr-comments https://github.com/owner/repo/pull/42'));
      return;
    }

    // Check gh is installed
    try {
      const { execSync } = await import('child_process');
      execSync('which gh', { stdio: 'pipe' });
    } catch {
      console.log(chalk.red('  gh CLI not found. Install: https://cli.github.com/'));
      return;
    }

    // Parse PR ref — accept "42", "owner/repo#42", or full URL
    let prRef = args.trim();
    let ghArgs: string[];
    if (/^\d+$/.test(prRef)) {
      ghArgs = ['pr', 'view', prRef, '--comments'];
    } else if (prRef.includes('://')) {
      ghArgs = ['pr', 'view', prRef, '--comments'];
    } else if (prRef.includes('#')) {
      const [repo, num] = prRef.split('#');
      ghArgs = ['pr', 'view', num, '--repo', repo, '--comments'];
    } else {
      ghArgs = ['pr', 'view', prRef, '--comments'];
    }

    console.log(SAFFRON('⏺ ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white(`gh ${ghArgs.join(' ')}`) + chalk.dim(')'));
    const spinner = startSpinner('Fetching…');
    try {
      const result = await executeTool('Bash', { command: `gh ${ghArgs.join(' ')}` });
      spinner.stop();
      if (result.success) {
        console.log('  ' + chalk.dim('⎿  ') + chalk.dim(`fetched ${result.output.length.toLocaleString()} chars`));
        console.log();
        console.log(result.output.slice(0, 8000));
        if (result.output.length > 8000) {
          console.log(chalk.dim('  … (truncated)'));
        }
      } else {
        console.log('  ' + chalk.dim('⎿  ') + chalk.red(result.error || 'Failed'));
      }
    } catch (e) {
      spinner.stop();
      console.log('  ' + chalk.dim('⎿  ') + chalk.red((e as Error).message));
    }
    console.log();
  }

  // === Todos ===

  private showTodos(): void {
    console.log();
    if (this.todos.length === 0) {
      console.log(SAFFRON('⏺ ') + chalk.bold('Todos') + chalk.dim(' (0 items)'));
      console.log('  ' + chalk.dim('⎿  ') + chalk.dim('No todos. Add one with /todo <text>'));
      console.log();
      return;
    }
    const done = this.todos.filter((t) => t.done).length;
    console.log(SAFFRON('⏺ ') + chalk.bold('Todos') + chalk.dim(` (${done}/${this.todos.length} done)`));
    console.log('  ' + chalk.dim('⎿'));
    this.todos.forEach((t, i) => {
      const box = t.done ? INDIA_GREEN('☒') : chalk.dim('☐');
      const text = t.done ? chalk.dim.strikethrough(t.text) : t.text;
      console.log(`     ${chalk.dim(String(i + 1).padStart(2))} ${box} ${text}`);
    });
    console.log();
  }

  private handleTodo(args: string): void {
    const text = (args || '').trim();
    if (!text) {
      console.log(chalk.yellow('  Usage:'));
      console.log(chalk.dim('    /todo <text>          add a todo'));
      console.log(chalk.dim('    /todo done <n>        mark todo n as done'));
      console.log(chalk.dim('    /todo undo <n>        unmark todo n'));
      console.log(chalk.dim('    /todo rm <n>          remove todo n'));
      console.log(chalk.dim('    /todo clear           remove all done todos'));
      return;
    }

    // Subcommands
    const m = text.match(/^(done|undo|rm|delete)\s+(\d+)$/i);
    if (m) {
      const sub = m[1].toLowerCase();
      const idx = parseInt(m[2], 10) - 1;
      if (idx < 0 || idx >= this.todos.length) {
        console.log(chalk.red(`  No todo at index ${idx + 1}`));
        return;
      }
      if (sub === 'done') {
        this.todos[idx].done = true;
        console.log(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(` Marked done: ${this.todos[idx].text}`));
      } else if (sub === 'undo') {
        this.todos[idx].done = false;
        console.log(chalk.dim(`  ↺ Unmarked: ${this.todos[idx].text}`));
      } else {
        const removed = this.todos.splice(idx, 1)[0];
        console.log(chalk.dim(`  Removed: ${removed.text}`));
      }
      return;
    }

    if (text.toLowerCase() === 'clear') {
      const before = this.todos.length;
      this.todos = this.todos.filter((t) => !t.done);
      console.log(chalk.dim(`  Cleared ${before - this.todos.length} done todo(s)`));
      return;
    }

    // Default: add a new todo
    this.todos.push({ text, done: false });
    console.log(chalk.dim('  ') + INDIA_GREEN('+') + chalk.dim(` ${text}`));
  }

  // === Vim mode ===

  private toggleVimMode(): void {
    this.vimMode = !this.vimMode;
    if (process.stdin.isTTY) {
      // Best-effort: switch readline keymap
      try {
        // Node readline doesn't have a public vim mode API, but the
        // 'readline' line editing keymap is the only mode it supports.
        // We track the flag for our own keypress handlers — actual
        // editing keys are handled by readline's emacs-style binding.
      } catch {
        // ignore
      }
    }
    console.log();
    console.log('  ' + chalk.bold(`Vim mode ${this.vimMode ? chalk.green('on') : chalk.dim('off')}`));
    if (this.vimMode) {
      console.log(chalk.dim('  Note: input editing uses emacs-style keys (readline default).'));
      console.log(chalk.dim('  Vim mode is a placeholder — file an issue if you need full vim bindings.'));
    }
    console.log();
  }

  // === Terminal setup ===

  private showTerminalSetup(): void {
    console.log();
    console.log(chalk.bold('  Terminal setup'));
    console.log(chalk.dim('  ─────────────────'));
    console.log();
    console.log(chalk.bold('  Recommended shell aliases'));
    console.log(chalk.dim('  Add to ~/.bashrc or ~/.zshrc:'));
    console.log();
    console.log('    ' + chalk.cyan('alias g="grokclix"'));
    console.log('    ' + chalk.cyan('alias gr="grokclix --resume"'));
    console.log('    ' + chalk.cyan('alias gp="grokclix --print"   # one-shot non-interactive'));
    console.log();
    console.log(chalk.bold('  Environment variables'));
    console.log();
    console.log('    ' + chalk.cyan('export XAI_API_KEY="xai-..."'));
    console.log('    ' + chalk.cyan('export EDITOR="nvim"  # used by /memory edit'));
    console.log();
    console.log(chalk.bold('  Clipboard image paste'));
    console.log();
    if (process.platform === 'linux') {
      console.log('    ' + chalk.cyan('sudo apt install xclip       # X11'));
      console.log('    ' + chalk.cyan('sudo apt install wl-clipboard # Wayland'));
    } else if (process.platform === 'darwin') {
      console.log('    ' + chalk.cyan('brew install pngpaste'));
    } else {
      console.log('    ' + chalk.dim('(uses built-in PowerShell on Windows — no install needed)'));
    }
    console.log();
    console.log(chalk.bold('  Custom commands directory'));
    console.log();
    console.log('    ' + chalk.cyan('mkdir -p ~/.grok/commands       # personal commands'));
    console.log('    ' + chalk.cyan('mkdir -p .grok/commands         # project commands'));
    console.log();
  }

  // === Upgrade ===

  private showUpgrade(): void {
    console.log();
    console.log(chalk.bold('  Upgrade Grok Code'));
    console.log(chalk.dim('  ─────────────────'));
    console.log();
    console.log(chalk.dim('  Current version: ') + chalk.white(`v${VERSION}`));
    console.log();
    console.log(chalk.bold('  If installed from source (recommended):'));
    console.log();
    console.log('    ' + chalk.cyan('cd ~/src/grokcodeclix'));
    console.log('    ' + chalk.cyan('git pull'));
    console.log('    ' + chalk.cyan('npm install'));
    console.log('    ' + chalk.cyan('npm run build'));
    console.log();
    console.log(chalk.dim('  The symlink at ~/.local/bin/grokclix will pick up the new build.'));
    console.log();
    console.log(chalk.bold('  If installed via npm:'));
    console.log();
    console.log('    ' + chalk.cyan('npm install -g github:singhpratech/grokcodeclix'));
    console.log();
    console.log(chalk.bold('  Latest releases:'));
    console.log('    ' + chalk.cyan('https://github.com/singhpratech/grokcodeclix/releases'));
    console.log();
  }

  // === Feedback ===

  private showFeedback(): void {
    const url = 'https://github.com/singhpratech/grokcodeclix/discussions';
    console.log();
    console.log(chalk.bold('  Send feedback'));
    console.log(chalk.dim('  ─────────────'));
    console.log();
    console.log('  We love hearing how Grok Code is working for you.');
    console.log();
    console.log('  ' + chalk.bold('Discussions: ') + chalk.cyan(url));
    console.log('  ' + chalk.bold('Issues:      ') + chalk.cyan('https://github.com/singhpratech/grokcodeclix/issues/new'));
    console.log();
    console.log(chalk.dim('  Tip: /bug for a prefilled bug-report URL with your env info.'));
    console.log();
  }

  // === New Claude-Code-parity handlers ===

  private async handleMemory(args?: string): Promise<void> {
    const grokMdPath = path.join(process.cwd(), 'GROK.md');

    let exists = false;
    try {
      await fs.access(grokMdPath);
      exists = true;
    } catch {
      // not found
    }

    if (!exists) {
      console.log(chalk.yellow('  GROK.md not found in the current project.'));
      console.log(chalk.dim('  Run /init to create one.'));
      return;
    }

    const sub = (args || '').trim().toLowerCase();

    if (sub === '' || sub === 'show') {
      const content = await fs.readFile(grokMdPath, 'utf-8');
      console.log();
      console.log(chalk.bold('  GROK.md ') + chalk.dim(`(${grokMdPath})`));
      console.log(chalk.dim('  ─────'));
      console.log(content);
      console.log();
      return;
    }

    if (sub === 'edit' || sub === 'open') {
      const editor = process.env.EDITOR || process.env.VISUAL || 'nano';
      const { spawn } = await import('child_process');
      console.log(chalk.dim(`  Opening ${editor} on GROK.md…`));
      await new Promise<void>((resolve) => {
        const child = spawn(editor, [grokMdPath], { stdio: 'inherit' });
        child.on('close', () => resolve());
        child.on('error', () => {
          console.log(chalk.red(`  Could not launch ${editor}. Set $EDITOR and try again.`));
          resolve();
        });
      });
      // Reload into system prompt
      await this.loadProjectContext();
      this.messages[0] = {
        role: 'system',
        content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
      };
      console.log(chalk.dim('  ✓ GROK.md reloaded into system prompt.'));
      return;
    }

    console.log(chalk.yellow(`  Usage: /memory [show|edit]`));
  }

  private handleBack(): void {
    // Pop one snapshot off the undo stack to revert the last turn.
    if (this.undoStack.length === 0) {
      console.log(chalk.dim('  Nothing to undo.'));
      return;
    }
    const snapshot = this.undoStack.pop()!;
    this.messages = snapshot;
    console.log(chalk.dim(`  ⏴ Reverted to previous turn (${this.messages.length} messages).`));
  }

  private async handleBackup(name?: string): Promise<void> {
    if (!this.session) {
      console.log(chalk.red('  No active session.'));
      return;
    }
    const backupDir = path.join(os.homedir(), '.config', 'grokcodecli', 'backups');
    await fs.mkdir(backupDir, { recursive: true });

    const safeName = (name || '').trim().replace(/[^\w.-]+/g, '_');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = safeName
      ? `${safeName}-${stamp}.json`
      : `${this.session.id.slice(0, 8)}-${stamp}.json`;
    const filePath = path.join(backupDir, filename);

    const payload = {
      version: VERSION,
      savedAt: new Date().toISOString(),
      session: {
        ...this.session,
        messages: this.messages,
      },
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(` Backup saved: ${filePath}`));
  }

  private async handleOutputStyle(args?: string): Promise<void> {
    const choice = (args || '').trim().toLowerCase();
    const valid: Array<'default' | 'concise' | 'verbose'> = ['default', 'concise', 'verbose'];

    if (choice && (valid as string[]).includes(choice)) {
      this.outputStyle = choice as typeof this.outputStyle;
      this.reinjectStyle();
      console.log();
      console.log('  ' + chalk.bold('Output style ') + chalk.white(this.outputStyle));
      console.log();
      return;
    }

    const options: SelectorOption[] = [
      { label: 'default', value: 'default', description: 'balanced — code + brief explanations' },
      { label: 'concise', value: 'concise', description: 'terse — answers only, no fluff' },
      { label: 'verbose', value: 'verbose', description: 'explain reasoning and alternatives' },
    ];
    console.log();
    const selected = await interactiveSelect('Output style:', options, this.outputStyle);
    if (selected) {
      this.outputStyle = selected as typeof this.outputStyle;
      this.reinjectStyle();
      console.log();
      console.log('  ' + chalk.bold('Output style ') + chalk.white(this.outputStyle));
      console.log();
    }
  }

  private reinjectStyle(): void {
    // Append a style directive to the system prompt without rebuilding it.
    const styleLine = this.outputStyle === 'concise'
      ? '\n\n# Output style\nBe extremely terse. One-line answers when possible. No preamble, no explanations unless explicitly asked.'
      : this.outputStyle === 'verbose'
      ? '\n\n# Output style\nExplain your reasoning. When writing code, describe what each part does and mention alternatives considered. Longer is fine for teaching.'
      : '';
    const base = buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext);
    this.messages[0] = { role: 'system', content: base + styleLine };
  }

  private async handleTheme(args?: string): Promise<void> {
    const choice = (args || '').trim().toLowerCase();
    const valid = ['tiranga', 'claude', 'mono'] as const;

    if (choice && (valid as readonly string[]).includes(choice)) {
      this.theme = choice as typeof this.theme;
      console.log();
      console.log('  ' + chalk.bold('Theme ') + chalk.white(this.theme) + chalk.dim('  (restart for full effect)'));
      console.log();
      return;
    }

    const options: SelectorOption[] = [
      { label: 'tiranga', value: 'tiranga', description: 'saffron · white · green (default)' },
      { label: 'claude', value: 'claude', description: 'Claude Code amber' },
      { label: 'mono', value: 'mono', description: 'monochrome (no accent)' },
    ];
    console.log();
    const selected = await interactiveSelect('Theme:', options, this.theme);
    if (selected) {
      this.theme = selected as typeof this.theme;
      console.log();
      console.log('  ' + chalk.bold('Theme ') + chalk.white(this.theme) + chalk.dim('  (restart for full effect)'));
      console.log();
    }
  }

  private async handleReleaseNotes(): Promise<void> {
    // Prefer CHANGELOG.md if present, otherwise show the last few git commits.
    const changelogPath = path.join(process.cwd(), 'CHANGELOG.md');
    try {
      const content = await fs.readFile(changelogPath, 'utf-8');
      console.log();
      console.log(chalk.bold('  Release notes') + chalk.dim(' (CHANGELOG.md)'));
      console.log(chalk.dim('  ─────────────'));
      console.log(content.slice(0, 4000));
      if (content.length > 4000) console.log(chalk.dim('  … (truncated)'));
      console.log();
      return;
    } catch {
      // fall through to git log
    }

    try {
      const { execSync } = await import('child_process');
      const log = execSync('git log -10 --pretty=format:"%h  %s"', {
        cwd: process.cwd(),
        encoding: 'utf-8',
      });
      console.log();
      console.log(chalk.bold('  Recent commits') + chalk.dim(' (last 10)'));
      console.log(chalk.dim('  ──────────────'));
      for (const line of log.split('\n')) {
        const [hash, ...rest] = line.split('  ');
        console.log('  ' + SAFFRON(hash) + '  ' + rest.join('  '));
      }
      console.log();
    } catch {
      console.log(chalk.yellow('  No CHANGELOG.md and not a git repo.'));
    }
  }

  private handleBug(): void {
    const url = 'https://github.com/singhpratech/grokcodeclix/issues/new';
    const body = encodeURIComponent(
      `**What happened?**\n\n\n**Expected**\n\n\n**Environment**\n- Grok Code v${VERSION}\n- Node ${process.version}\n- Platform ${process.platform} ${os.arch()}\n- Model ${this.client.model}\n`
    );
    const fullUrl = `${url}?title=bug%3A+&body=${body}`;
    console.log();
    console.log(chalk.bold('  Report a bug'));
    console.log(chalk.dim('  ────────────'));
    console.log('  ' + chalk.cyan(fullUrl));
    console.log();
    console.log(chalk.dim('  Paste the URL into your browser, or run:'));
    console.log(chalk.dim(`    xdg-open "${fullUrl}"`));
    console.log();
  }

  private showHelp(): void {
    const c = chalk.cyan;
    const d = chalk.dim;
    const hr = d('  ────────────────────────────────────────────────────────────────');

    console.log();
    console.log('  ' + chalk.bold('Grok Code ') + d(`v${VERSION}`));
    console.log(hr);
    console.log();

    console.log(chalk.bold('  Session'));
    console.log(`  ${c('/clear')}               Clear the conversation`);
    console.log(`  ${c('/save')}                Save the current session`);
    console.log(`  ${c('/back')}                Undo the last turn ${d('(Ctrl+B)')}`);
    console.log(`  ${c('/backup')} ${d('[name]')}       Save a named backup snapshot ${d('(Ctrl+O)')}`);
    console.log(`  ${c('/history')}             Browse previous sessions`);
    console.log(`  ${c('/resume')} ${d('[id]')}          Resume a previous session`);
    console.log(`  ${c('/rename')} ${d('<name>')}        Rename the current session`);
    console.log(`  ${c('/export')} ${d('[file]')}        Export conversation`);
    console.log(`  ${c('/compact')} ${d('[focus]')}      Compact context`);
    console.log(`  ${c('/exit')}                Save and quit`);
    console.log();

    console.log(chalk.bold('  Config'));
    console.log(`  ${c('/model')} ${d('[name]')}         Show or change the model`);
    console.log(`  ${c('/plan')}                Toggle plan mode ${d('(Shift+Tab)')}`);
    console.log(`  ${c('/stream')}              Toggle streaming`);
    console.log(`  ${c('/output-style')}        Response style (default/concise/verbose)`);
    console.log(`  ${c('/theme')}               Color theme`);
    console.log(`  ${c('/permissions')}         Permission settings`);
    console.log(`  ${c('/config')}              Show configuration`);
    console.log(`  ${c('/login')}               Authenticate with xAI`);
    console.log(`  ${c('/logout')}              Clear credentials`);
    console.log();

    console.log(chalk.bold('  Info'));
    console.log(`  ${c('/status')}              Session status`);
    console.log(`  ${c('/context')}             Context window usage`);
    console.log(`  ${c('/cost')}                Token usage and cost`);
    console.log(`  ${c('/usage')}               Usage stats`);
    console.log(`  ${c('/doctor')}              Run diagnostics`);
    console.log(`  ${c('/version')}             Show version`);
    console.log(`  ${c('/release-notes')}       Recent changes`);
    console.log(`  ${c('/bug')}                 Report a bug on GitHub`);
    console.log();

    console.log(chalk.bold('  Project & memory'));
    console.log(`  ${c('/init')}                Initialize GROK.md + .grok/commands/`);
    console.log(`  ${c('/memory')} ${d('[show|edit]')}    View or edit GROK.md`);
    console.log(`  ${c('/review')} ${d('[focus]')}       Code review`);
    console.log(`  ${c('/security-review')}     Security review of uncommitted changes`);
    console.log(`  ${c('/pr-comments')} ${d('<ref>')}    GitHub PR comments (needs gh)`);
    console.log(`  ${c('/add-dir')} ${d('<path>')}       Add a working directory`);
    console.log(`  ${c('/pwd')}                 Show working directories`);
    console.log(d('  Memory is loaded from ') + c('~/.grok/GROK.md') + d(' (global) and ') + c('GROK.md') + d(' in cwd/parents.'));
    console.log();

    console.log(chalk.bold('  Images & custom commands'));
    console.log(`  ${c('/image')} ${d('<path>')}         Attach an image from file`);
    console.log(`  ${c('/paste')}               Paste image from clipboard`);
    console.log(`  ${c('/commands')}            List custom commands`);
    console.log(d('  Inline: drop ') + c('@screenshot.png') + d(' in any message.'));
    console.log(d('  Custom commands live in ') + c('.grok/commands/') + d(' or ') + c('~/.grok/commands/'));
    console.log();

    console.log(chalk.bold('  Tasks & utilities'));
    console.log(`  ${c('/todos')}               Show in-session todo list`);
    console.log(`  ${c('/todo')} ${d('<text>')}          Add a todo`);
    console.log(`  ${c('/todo done')} ${d('<n>')}       Mark todo n as done`);
    console.log(`  ${c('/vim')}                 Toggle vim editing mode`);
    console.log(`  ${c('/terminal-setup')}      Show terminal setup tips`);
    console.log(`  ${c('/upgrade')}             How to update Grok Code`);
    console.log(`  ${c('/feedback')}            Send feedback`);
    console.log();

    console.log(chalk.bold('  Prefixes (at start of message)'));
    console.log(`  ${c('!')}${d('<command>')}          Run shell command directly ${d('(bypasses Grok)')}`);
    console.log(`  ${c('#')}${d('<note>')}             Add a note to GROK.md memory`);
    console.log(`  ${c('/')}${d('<command>')}          Run a slash command`);
    console.log(`  ${c('?')}                   Show this help`);
    console.log();

    console.log(chalk.bold('  Keyboard shortcuts'));
    console.log(`  ${d('Tab')}          Autocomplete slash command`);
    console.log(`  ${d('Shift+Tab')}    Toggle plan mode`);
    console.log(`  ${d('Ctrl+B')}       Undo last turn (back)`);
    console.log(`  ${d('Ctrl+O')}       Save backup snapshot`);
    console.log(`  ${d('Ctrl+L')}       Clear screen`);
    console.log(`  ${d('Esc')}          Stop streaming response`);
    console.log(`  ${d('Ctrl+C')}       Abort current action / exit`);
    console.log(`  ${d('Ctrl+D')}       Exit`);
    console.log();

    console.log(chalk.bold('  Tools'));
    console.log(`  ${INDIA_GREEN('📖 Read')}   ${INDIA_GREEN('🔍 Glob')}   ${INDIA_GREEN('🔎 Grep')}   ${INDIA_GREEN('🌐 WebFetch')}   ${INDIA_GREEN('🔍 WebSearch')}`);
    console.log(`  ${chalk.yellow('✏️  Write')}   ${chalk.yellow('🔧 Edit')}`);
    console.log(`  ${chalk.red('⚡ Bash')}`);
    console.log();
  }

  // === Live slash command popup ===

  /**
   * Paint a popup of matching slash commands below the current input line.
   * Called on every keystroke (via setImmediate) while the input starts
   * with '/'. Uses ANSI save/restore cursor escapes to avoid disturbing
   * readline's internal cursor tracking.
   */
  /**
   * Render the slash-command popup. Behaves like Claude Code:
   *   - Pops open the moment the line starts with `/`
   *   - Shows up to 10 visible matches, with `… +N more` when truncated
   *   - The currently selected row is highlighted in saffron (▶ marker)
   *   - Up/Down keys (handled in the keypress listener) move the selection
   *   - Tab inserts the selected command into the input line
   *   - Continuing to type narrows the list and resets selection to top
   */
  private updateSlashPopup(opts: { resetSelection?: boolean } = {}): void {
    if (!process.stdout.isTTY) return;
    const line = this.rl.line ?? '';
    if (!line.startsWith('/')) {
      this.clearSlashPopup();
      return;
    }

    const all: Array<[string, string]> = [
      ...Object.entries(GrokChat.SLASH_COMMANDS),
      ...this.customCommands.map((c): [string, string] => [
        `/${c.name}`,
        `${c.source === 'project' ? '[project]' : '[user]'} ${c.description}`,
      ]),
    ];

    const query = line.toLowerCase();
    const matches = all.filter(([cmd]) => cmd.toLowerCase().startsWith(query));

    this.slashPopupMatches = matches;
    if (opts.resetSelection || this.slashPopupSelectedIndex >= matches.length) {
      this.slashPopupSelectedIndex = 0;
    }

    // Build the new popup contents into a buffer first, *then* clear the
    // previous one and paint the new one in a single operation. This
    // avoids the visible blink when typing fast, where the old popup
    // would briefly disappear before the new one rendered.
    const lines: string[] = [];
    if (matches.length === 0) {
      lines.push(chalk.dim('    no matching commands'));
    } else {
      const VISIBLE = 10;
      const sel = this.slashPopupSelectedIndex;
      const start = matches.length <= VISIBLE
        ? 0
        : Math.max(0, Math.min(matches.length - VISIBLE, sel - Math.floor(VISIBLE / 2)));
      const end = Math.min(matches.length, start + VISIBLE);
      const above = start;
      const below = matches.length - end;

      if (above > 0) lines.push(chalk.dim(`    ↑ ${above} more`));
      for (let i = start; i < end; i++) {
        const [cmd, desc] = matches[i];
        const isSel = i === sel;
        const pointer = isSel ? SAFFRON('  ▶ ') : '    ';
        const cmdRender = isSel ? SAFFRON.bold(cmd.padEnd(18)) : chalk.cyan(cmd.padEnd(18));
        const descRender = isSel ? chalk.white(desc) : chalk.dim(desc);
        lines.push(pointer + cmdRender + '  ' + descRender);
      }
      if (below > 0) lines.push(chalk.dim(`    ↓ ${below} more`));
      lines.push(chalk.dim('    ↑↓ navigate · Tab insert · Enter run · Esc cancel'));
    }

    this.repaintPopup(lines);
  }

  /**
   * Atomically replace whatever popup is currently below the prompt with
   * the provided lines.
   *
   * Three rules learned the hard way:
   *
   *   • Use relative cursor moves, not DECSC/DECRC (\x1B7/\x1B8). The
   *     save/restore pair silently breaks once the popup pushes the
   *     terminal buffer past the bottom — the saved position no longer
   *     points at the prompt row.
   *
   *   • DON'T call rl.prompt(true) afterwards. readline's _refreshLine
   *     does `\r\x1B[J<prompt><line>` — that `\x1B[J` clears every cell
   *     from the cursor to the end of the screen, which is exactly the
   *     popup we just painted. Calling prompt(true) was making the popup
   *     vanish a frame after we drew it, which is the "popup not running"
   *     bug the user reported.
   *
   *   • Manually park the cursor at the right column on the prompt line
   *     so the next keystroke types where the user expects it.
   *     Visible prompt is `│ > ` (4 cells); cursor column = 4 + rl.cursor
   *     in 0-indexed terms, so 5 + rl.cursor in ANSI's 1-indexed scheme.
   */
  private repaintPopup(lines: string[]): void {
    const out = process.stdout;
    const prev = this.slashPopupLines;
    const next = lines.length;
    const totalLines = Math.max(prev, next);

    let descended = 0;
    for (let i = 0; i < totalLines; i++) {
      out.write('\n\x1B[2K'); // newline → next row col 0, then clear that row
      descended++;
      if (i < next) {
        out.write(lines[i]);
      }
    }

    // Climb back to the prompt row.
    if (descended > 0) {
      out.write(`\x1B[${descended}A`);
    }
    // Move cursor to the column readline expects (visible prompt length +
    // current cursor offset within the line). 1-indexed, so add 1.
    const promptVisibleLen = 4; // `│ > `
    const rlCursor = (this.rl as unknown as { cursor: number }).cursor ?? 0;
    out.write(`\x1B[${promptVisibleLen + rlCursor + 1}G`);

    this.slashPopupLines = next;
    this.slashPopupActive = next > 0;
  }

  /** Clear the slash popup lines below the prompt. */
  private clearSlashPopup(): void {
    if (!this.slashPopupActive || !process.stdout.isTTY) {
      this.slashPopupActive = false;
      this.slashPopupLines = 0;
      return;
    }
    this.repaintPopup([]);
  }

  // === Stream → rendered markdown re-render ===

  /**
   * After streaming raw tokens to the terminal, rewind the cursor over
   * the raw region and repaint it using the proper markdown renderer.
   * This gives users the best of both worlds: live streaming feel + a
   * nicely formatted final result (headers, code blocks, lists, etc).
   *
   * No-op on non-TTY terminals (tests, pipes) — those just get plain text.
   */
  private rewindAndRerender(content: string): void {
    if (!content) return;

    if (!process.stdout.isTTY) {
      // Non-TTY: we suppressed raw output during streaming (see the
      // `if (process.stdout.isTTY)` gate in the stream loop), so now
      // we print the rendered version once for piped/logged output.
      process.stdout.write(renderMarkdown(content));
      process.stdout.write('\n');
      return;
    }

    // FAST PATH: if content has no markdown markers, the raw stream we
    // already painted is identical to what the renderer would produce.
    // Skip the cursor-up + clear + repaint dance — that's what made the
    // end of every reply visibly flicker.
    if (!hasMarkdownMarkers(content)) {
      // Make sure we end on a clean newline so the next prompt sits on
      // its own row.
      if (!content.endsWith('\n')) process.stdout.write('\n');
      return;
    }

    const cols = process.stdout.columns || 80;
    const endsWithNewline = content.endsWith('\n');

    // Count the visual rows the raw stream occupied, accounting for
    // line wrapping when a logical line is wider than the terminal.
    const logical = content.split('\n');
    const linesToCount = endsWithNewline ? logical.slice(0, -1) : logical;

    let visualRows = 0;
    for (const line of linesToCount) {
      // Strip any accidental ANSI codes before measuring
      const visible = line.replace(/\x1B\[[0-9;]*m/g, '');
      // Empty lines still take 1 visual row
      const rowsForLine = visible.length === 0 ? 1 : Math.ceil(visible.length / cols);
      visualRows += rowsForLine;
    }

    if (visualRows === 0) {
      process.stdout.write('\n');
      return;
    }

    // Figure out how many rows to move the cursor up:
    //   - if content ends with a newline, cursor is 1 row BELOW the last
    //     content row, so move up by `visualRows` to reach the start
    //   - otherwise cursor is ON the last content row, so move up by
    //     `visualRows - 1`
    const rowsBack = endsWithNewline ? visualRows : Math.max(0, visualRows - 1);

    const out = process.stdout;
    out.write('\r'); // column 0
    if (rowsBack > 0) {
      out.write(`\x1B[${rowsBack}A`); // up N rows
    }
    out.write('\x1B[J'); // clear from cursor to end of screen

    // Paint the rendered markdown, followed by a trailing newline for
    // spacing before the next prompt or tool call.
    out.write(renderMarkdown(content));
    out.write('\n');
  }

  // === Shell escape and memory add ===

  /** Run a shell command immediately via Bash tool, bypassing Grok. */
  private async runShellEscape(command: string): Promise<void> {
    console.log(SAFFRON('⏺ ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white(command) + chalk.dim(')'));
    const spinner = startSpinner('Running…');
    try {
      const result = await executeTool('Bash', { command });
      spinner.stop();
      if (result.success) {
        const lines = result.output.split('\n').slice(0, 20);
        console.log('  ' + chalk.dim('⎿  ') + chalk.dim(`${result.output.split('\n').length} line(s) of output`));
        for (const l of lines) {
          console.log('  ' + chalk.dim('│ ') + l.slice(0, 200));
        }
        if (result.output.split('\n').length > 20) {
          console.log('  ' + chalk.dim('│ ') + chalk.dim('… (output truncated)'));
        }
      } else {
        console.log('  ' + chalk.dim('⎿  ') + chalk.red(result.error || 'Failed'));
      }
    } catch (e) {
      spinner.stop();
      console.log('  ' + chalk.dim('⎿  ') + chalk.red((e as Error).message));
    }
    console.log();
  }

  /** Quick-add a line to GROK.md memory. Prompts for scope (project/global). */
  private async handleMemoryAdd(text: string): Promise<void> {
    const options: SelectorOption[] = [
      { label: 'Project memory', value: 'project', description: './GROK.md' },
      { label: 'Global memory', value: 'global', description: '~/.grok/GROK.md' },
    ];
    const scope = await interactiveSelect('Add to which memory?', options);
    if (!scope) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
    await this.addToMemory(text, scope as 'project' | 'global');
    console.log(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(` Saved to ${scope === 'global' ? '~/.grok/GROK.md' : 'GROK.md'}`));
  }

  // === Image attachment ===

  private async attachImageFromPath(filePath: string): Promise<void> {
    try {
      const img = await loadImageFromFile(filePath);
      this.pending.images.push(img);
      console.log(chalk.dim(`  📎 Attached: ${filePath} (${formatSize(img.size)})`));
    } catch (error) {
      console.log(chalk.red(`  ✗ ${(error as Error).message}`));
    }
  }

  private async attachImageFromClipboard(): Promise<void> {
    process.stdout.write(chalk.dim('  Reading clipboard…'));
    const img = await loadImageFromClipboard();
    process.stdout.write('\r\x1B[K');
    if (!img) {
      console.log(
        chalk.yellow('  No image in clipboard.') +
        chalk.dim(' (Linux: install xclip or wl-paste. macOS: brew install pngpaste.)')
      );
      return;
    }
    this.pending.images.push(img);
    console.log(chalk.dim(`  📎 Pasted image from clipboard (${formatSize(img.size)})`));
  }

  /**
   * /imagine <prompt> — generate an image directly. Calls the GenerateImage
   * tool through the registry so all the saving / display logic stays in
   * one place. Skips the LLM round-trip.
   */
  private async handleImagine(prompt?: string): Promise<void> {
    if (!prompt || !prompt.trim()) {
      console.log(chalk.yellow('  Usage: /imagine <prompt>'));
      console.log(chalk.dim('  Generates an image and saves it under ./grok-images/'));
      return;
    }
    const spinner = startSpinner('Generating image…');
    let result;
    try {
      result = await executeTool('GenerateImage', { prompt: prompt.trim() });
    } finally {
      spinner.stop();
    }
    if (!result.success) {
      console.log(chalk.red(`  ✗ ${result.error || 'Image generation failed'}`));
      return;
    }
    console.log(SAFFRON('⏺ ') + chalk.bold('Image generated'));
    console.log('  ' + chalk.dim('⎿  ') + (result.display?.summary || result.output));
    console.log();
  }

  /**
   * /voice <path> — transcribe an audio file. Tries xAI native first,
   * falls back to OpenRouter Whisper.
   */
  private async handleVoice(audioPath?: string): Promise<void> {
    if (!audioPath || !audioPath.trim()) {
      console.log(chalk.yellow('  Usage: /voice <path-to-audio>'));
      console.log(chalk.dim('  Transcribes an audio file (mp3, m4a, wav, webm, flac, ogg).'));
      console.log(chalk.dim('  Tries xAI native, falls back to OpenRouter Whisper.'));
      return;
    }
    const spinner = startSpinner('Transcribing…');
    let result;
    try {
      result = await executeTool('TranscribeAudio', { audio_path: audioPath.trim() });
    } finally {
      spinner.stop();
    }
    if (!result.success) {
      console.log(chalk.red(`  ✗ ${result.error || 'Transcription failed'}`));
      return;
    }
    console.log(SAFFRON('⏺ ') + chalk.bold('Transcript'));
    console.log();
    console.log(renderMarkdown(result.output));
    console.log();
  }

  /**
   * /speak <text> — synthesize speech from text. Saves the file under
   * ./grok-audio/ and prints the path.
   */
  private async handleSpeak(text?: string): Promise<void> {
    if (!text || !text.trim()) {
      console.log(chalk.yellow('  Usage: /speak <text>'));
      console.log(chalk.dim('  Generates an mp3 from text and saves it under ./grok-audio/.'));
      return;
    }
    const spinner = startSpinner('Synthesizing speech…');
    let result;
    try {
      result = await executeTool('SpeakText', { text: text.trim() });
    } finally {
      spinner.stop();
    }
    if (!result.success) {
      console.log(chalk.red(`  ✗ ${result.error || 'Speech generation failed'}`));
      return;
    }
    console.log(SAFFRON('⏺ ') + chalk.bold('Speech generated'));
    console.log('  ' + chalk.dim('⎿  ') + (result.display?.summary || result.output));
    console.log();
  }

  // === Core processing ===

  private async processMessage(input: string, opts: { quietPrompt?: boolean } = {}): Promise<void> {
    // Snapshot the current message array for /back undo. Cap the stack at
    // 20 to avoid unbounded memory use in long sessions.
    this.undoStack.push(this.messages.map((m) => ({ ...m })));
    if (this.undoStack.length > 20) this.undoStack.shift();

    // Extract @image.png references and load them as attachments
    const { text, paths } = extractImageReferences(input);
    let finalText = text || input;

    for (const p of paths) {
      try {
        const img = await loadImageFromFile(p);
        this.pending.images.push(img);
        console.log(chalk.dim(`  📎 Attached ${p} (${formatSize(img.size)})`));
      } catch {
        // Not a valid image — leave the reference in text
        finalText = input;
      }
    }

    // Build the user message (multimodal if we have images)
    let message: GrokMessage;
    if (this.pending.images.length > 0) {
      const parts: GrokContentPart[] = [];
      if (finalText) parts.push({ type: 'text', text: finalText });
      for (const img of this.pending.images) {
        parts.push({ type: 'image_url', image_url: { url: img.dataUrl, detail: 'high' } });
      }
      message = { role: 'user', content: parts };
      this.pending.images = [];
    } else {
      message = { role: 'user', content: finalText };
    }

    this.messages.push(message);

    try {
      if (this.useStreaming) {
        await this.getStreamingResponse();
      } else {
        await this.getResponse();
      }
      await this.saveSession();
    } catch (error) {
      const err = error as Error;
      console.log(chalk.red(`\n  Error: ${err.message}\n`));
    }
  }

  /**
   * Wrap a fetch-driven API call with retry on transient failures.
   *
   * Retries on:
   *   - 429 Too Many Requests (with retry-after if provided)
   *   - 502 / 503 / 504 (transient server errors)
   *   - network errors (ECONNRESET, ETIMEDOUT)
   * Up to 3 attempts with exponential backoff.
   */
  private async withRetry<T>(fn: () => Promise<T>, label: string = 'request'): Promise<T> {
    const maxAttempts = 3;
    let attempt = 0;
    let lastError: Error | null = null;
    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        return await fn();
      } catch (error) {
        const err = error as Error;
        lastError = err;
        const msg = err.message || '';
        const transient =
          /\b(429|502|503|504)\b/.test(msg) ||
          /(ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|UND_ERR_SOCKET)/i.test(msg) ||
          /rate limit/i.test(msg);
        if (err.name === 'AbortError') throw err;
        if (!transient || attempt >= maxAttempts) throw err;
        // Honour retry-after if shown in message, otherwise exponential
        const retryMatch = msg.match(/retry after (\d+)s/);
        const waitMs = retryMatch ? Number(retryMatch[1]) * 1000 : 600 * Math.pow(2, attempt - 1);
        console.log(chalk.dim(`  ↻ ${label} hit transient error, retrying in ${Math.round(waitMs / 100) / 10}s (${attempt}/${maxAttempts - 1})`));
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    throw lastError || new Error(`${label} failed`);
  }

  private async getResponse(): Promise<void> {
    const spinner = startSpinner('Thinking…');

    try {
      const response = await this.withRetry(() => this.client.chat(this.messages, allTools), 'chat');
      spinner.stop();
      const choice = response.choices[0];
      const message = choice.message;

      if (response.usage) {
        this.tokenUsage.promptTokens += response.usage.prompt_tokens;
        this.tokenUsage.completionTokens += response.usage.completion_tokens;
        this.tokenUsage.totalTokens += response.usage.total_tokens;
        this.tokenUsage.reasoningTokens += response.usage.completion_tokens_details?.reasoning_tokens || response.usage.reasoning_tokens || 0;
      }

      this.messages.push(message);

      if (message.tool_calls && message.tool_calls.length > 0) {
        if (typeof message.content === 'string' && message.content) {
          console.log(renderMarkdown(message.content));
          console.log();
        }

        await this.executeToolCalls(message.tool_calls);

        await this.getResponse();
      } else {
        if (typeof message.content === 'string' && message.content) {
          console.log();
          console.log(renderMarkdown(message.content));
          console.log();
        }
      }
    } catch (e) {
      spinner.stop();
      throw e;
    }
  }

  private async getStreamingResponse(): Promise<void> {
    const isReasoning = this.client.model.includes('reasoning') && !this.client.model.includes('non-reasoning');

    this.abortController = new AbortController();
    let aborted = false;

    // Esc-to-stop listener while streaming
    const onKeypress = (key: Buffer) => {
      if (key[0] === 27 && key.length === 1) {
        aborted = true;
        this.abortController?.abort();
      }
    };

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onKeypress);
    }

    const spinner = startSpinner(isReasoning ? 'Thinking…' : 'Working…');

    let fullContent = '';
    let reasoningContent = '';
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;
    let firstContentChunk = true;

    try {
      const grokOptions: GrokChatOptions = { signal: this.abortController.signal };

      for await (const chunk of this.client.chatStream(this.messages, allTools, grokOptions)) {
        if (aborted) break;

        const delta = chunk.choices[0]?.delta;

        // Handle reasoning content (Grok-specific)
        const anyDelta = delta as { reasoning_content?: string } | undefined;
        if (anyDelta?.reasoning_content) {
          if (reasoningContent.length === 0) {
            spinner.stop();
            process.stdout.write(chalk.dim('  💭 '));
          }
          reasoningContent += anyDelta.reasoning_content;
          // Stream reasoning dimmed
          process.stdout.write(chalk.dim(anyDelta.reasoning_content));
        }

        if (typeof delta?.content === 'string' && delta.content) {
          if (firstContentChunk) {
            spinner.stop();
            if (reasoningContent) {
              console.log();
              console.log();
            }
            firstContentChunk = false;
          }
          // In a TTY we stream raw tokens live and re-paint with
          // rendered markdown after the stream ends (see
          // rewindAndRerender). In non-TTY (pipes, logs) we collect
          // silently and render once at the end so the output is
          // clean markdown instead of raw text.
          if (process.stdout.isTTY) {
            process.stdout.write(delta.content);
          }
          fullContent += delta.content;
        }

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls as Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>) {
            if (tc.id) {
              if (currentToolCall && currentToolCall.id) {
                toolCalls.push(currentToolCall as ToolCall);
              }
              currentToolCall = {
                id: tc.id,
                type: 'function',
                function: {
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
              };
            } else if (currentToolCall && tc.function?.arguments) {
              currentToolCall.function!.arguments += tc.function.arguments;
            }
          }
        }

        // Usage info at end of stream
        if (chunk.usage) {
          this.tokenUsage.promptTokens += chunk.usage.prompt_tokens || 0;
          this.tokenUsage.completionTokens += chunk.usage.completion_tokens || 0;
          this.tokenUsage.totalTokens += chunk.usage.total_tokens || 0;
          this.tokenUsage.reasoningTokens += chunk.usage.completion_tokens_details?.reasoning_tokens || chunk.usage.reasoning_tokens || 0;
        }
      }

      if (currentToolCall && currentToolCall.id) {
        toolCalls.push(currentToolCall as ToolCall);
      }

      spinner.stop();

      // Rewind over the raw streamed text and repaint it as rendered
      // markdown (headers, code blocks with syntax highlight, lists, etc).
      // Skipped when aborted so the user can still see what was written
      // up to the interruption.
      if (fullContent && !aborted) {
        this.rewindAndRerender(fullContent);
      }

      const message: GrokMessage = {
        role: 'assistant',
        content: fullContent,
      };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
      this.messages.push(message);

      if (toolCalls.length > 0 && !aborted) {
        if (fullContent) console.log();
        // Stop the keypress listener BEFORE running tool calls so that
        // permission prompts can read keyboard input cleanly.
        if (process.stdin.isTTY) {
          try {
            process.stdin.setRawMode(false);
            process.stdin.removeListener('data', onKeypress);
          } catch {
            /* ignore */
          }
        }
        await this.executeToolCalls(toolCalls);
        this.abortController = null;
        await this.getStreamingResponse();
        return;
      }

      if (aborted) {
        console.log(chalk.dim('\n  Stopped.'));
      }
    } catch (error) {
      spinner.stop();
      const err = error as Error;
      if (err.name === 'AbortError' || aborted) {
        console.log(chalk.dim('\n  Stopped.'));
      } else {
        console.log();
        throw err;
      }
    } finally {
      if (process.stdin.isTTY) {
        try {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onKeypress);
        } catch {
          // ignore
        }
      }
      this.abortController = null;
    }
  }

  /**
   * Execute a batch of tool calls from one assistant turn.
   *
   * Strategy:
   *   - In yolo mode (no permission prompts), run them concurrently. This
   *     gives a real speed boost when the model batches independent reads
   *     or searches.
   *   - In interactive mode, run them sequentially so the user sees one
   *     permission prompt at a time. Sequencing also avoids races where
   *     two Edits could conflict on the same file.
   */
  private async executeToolCalls(toolCalls: ToolCall[]): Promise<void> {
    const yolo = (this.permissions as unknown as { yolo?: boolean }).yolo === true;
    if (yolo && toolCalls.length > 1) {
      await Promise.all(toolCalls.map((tc) => this.executeToolCall(tc)));
    } else {
      for (const toolCall of toolCalls) {
        await this.executeToolCall(toolCall);
      }
    }

    // After the batch runs, check whether the model called ExitPlanMode.
    // If so, prompt the user to approve before exiting plan mode.
    if (planExitState.requested) {
      planExitState.requested = false;
      const plan = planExitState.plan;
      planExitState.plan = '';

      console.log();
      console.log(SAFFRON('⏺ ') + chalk.bold('Proposed plan'));
      console.log();
      console.log(renderMarkdown(plan));
      console.log();

      const approved = await this.permissions.requestPermission({
        tool: 'ExitPlanMode',
        description: 'Approve the proposed plan and exit plan mode',
        riskLevel: 'write',
        details: { plan },
      });

      if (approved) {
        this.planMode = false;
        console.log(chalk.dim('  Plan approved — plan mode off, executing.'));
        this.messages.push({
          role: 'user',
          content: '[system] Plan approved. Plan mode is now OFF — proceed with the plan using all tools.',
        });
      } else {
        console.log(chalk.yellow('  Plan rejected — staying in plan mode.'));
        this.messages.push({
          role: 'user',
          content: '[system] Plan rejected. Stay in plan mode and revise the plan based on the user\'s feedback.',
        });
      }
    }

    // The ☒/☐ checkbox list now renders inline under the TodoWrite tool's
    // ⎿ result via display.preview — same nested layout as Claude Code,
    // no separate "── todos ──" header.
  }

  private async executeToolCall(toolCall: ToolCall): Promise<void> {
    const { name, arguments: argsJson } = toolCall.function;

    let params: Record<string, unknown>;
    try {
      params = JSON.parse(argsJson);
    } catch {
      console.log(chalk.red(`\n  ✗ Invalid JSON arguments for ${name}`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'Error: Invalid JSON arguments',
      });
      return;
    }

    // Plan mode: block side-effecting tools and steer the model toward
    // ExitPlanMode. Only Read, Glob, Grep, WebFetch, WebSearch, TodoWrite,
    // BashOutput, and ExitPlanMode are allowed in plan mode.
    const PLAN_BLOCKED = new Set(['Write', 'Edit', 'MultiEdit', 'Bash', 'KillBash']);
    if (this.planMode && PLAN_BLOCKED.has(name)) {
      const reason = `Plan mode is on — ${name} is blocked. Finish planning, then call ExitPlanMode with your plan; the user will approve before any changes are made.`;
      console.log(chalk.yellow(`  ⚠ ${reason}`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${reason}`,
      });
      return;
    }

    // Format the tool invocation for display
    const invocation = formatToolInvocation(name, params);
    const riskLevel = this.permissions.getToolRiskLevel(name);
    const description = this.permissions.formatToolDetails(name, params);

    const approved = await this.permissions.requestPermission({
      tool: name,
      description,
      riskLevel,
      details: params,
    });

    if (!approved) {
      console.log(chalk.dim('  ') + chalk.red('⏺ ') + chalk.dim(`${name}(${invocation}) — denied`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'Error: Permission denied by user',
      });
      return;
    }

    console.log(SAFFRON('⏺ ') + chalk.bold(name) + chalk.dim('(') + invocation + chalk.dim(')'));


    // Execute with a spinner for slow tools
    const useSpinner = name === 'Bash' || name === 'WebFetch' || name === 'WebSearch';
    const spinner = useSpinner ? startSpinner('Running…', '  ') : null;

    let result: ToolResult;
    try {
      result = await executeTool(name, params);
    } catch (error) {
      spinner?.stop();
      const err = error as Error;
      console.log(chalk.red(`    ⎿ ${err.message}`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: `Error: ${err.message}`,
      });
      return;
    }
    spinner?.stop();

    // Display the result — Claude Code style: ⎿  summary (ctrl+r to expand)
    if (result.success) {
      const summary = result.display?.summary || defaultToolSummary(name, result.output);
      console.log('  ' + chalk.dim('⎿  ') + summary);
      if (result.display?.preview) {
        console.log(result.display.preview);
      } else if (shouldShowPreview(name)) {
        const preview = buildPreview(result.output);
        if (preview) console.log(preview);
      }
    } else {
      console.log('  ' + chalk.dim('⎿  ') + chalk.red(result.error || 'Failed'));
    }
    console.log();

    // Truncate huge outputs going back to the model so we don't blow context.
    // We keep the head and tail and replace the middle with a marker so the
    // model can see both ends of large logs / files / search dumps.
    const MODEL_TOOL_OUTPUT_CAP = 80_000; // ~20k tokens
    let modelContent: string;
    if (result.success) {
      const out = result.output || '';
      if (out.length > MODEL_TOOL_OUTPUT_CAP) {
        const half = Math.floor((MODEL_TOOL_OUTPUT_CAP - 200) / 2);
        const head = out.slice(0, half);
        const tail = out.slice(-half);
        modelContent =
          head +
          `\n\n... [truncated ${out.length - 2 * half} characters of tool output — call the tool with offset/limit or a narrower query if you need the full content] ...\n\n` +
          tail;
      } else {
        modelContent = out;
      }
    } else {
      modelContent = `Error: ${result.error}`;
    }

    this.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: modelContent,
    });
  }

  private async saveSession(): Promise<void> {
    if (this.session) {
      this.session.messages = this.messages;
      if (this.session.title === 'New Conversation') {
        // Try to derive a title from the first user message
        const firstUser = this.messages.find((m) => m.role === 'user');
        if (firstUser) {
          const text = typeof firstUser.content === 'string' ? firstUser.content : '[multimodal]';
          const cleaned = stripMarkdown(text).slice(0, 60);
          this.session.title = cleaned + (text.length > 60 ? '…' : '');
        }
      }
      await this.history.saveSession(this.session);
    }
  }
}

// === Helpers ===

function formatToolInvocation(name: string, params: Record<string, unknown>): string {
  const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const style = chalk.white;

  switch (name) {
    case 'Read':
    case 'Write':
    case 'Edit':
      return style(truncate(relOrAbs(String(params.file_path || '')), 60));
    case 'MultiEdit': {
      const n = (params.edits as unknown[] | undefined)?.length ?? 0;
      return style(truncate(relOrAbs(String(params.file_path || '')), 50)) + chalk.dim(` · ${n} edit${n === 1 ? '' : 's'}`);
    }
    case 'Bash': {
      const bg = params.run_in_background ? chalk.dim(' (background)') : '';
      return style(truncate(String(params.command || ''), 60)) + bg;
    }
    case 'BashOutput':
    case 'KillBash':
      return style(truncate(String(params.bash_id || ''), 60));
    case 'Glob':
      return style(truncate(String(params.pattern || ''), 60));
    case 'Grep': {
      const inc = params.include ? ` --include ${params.include}` : '';
      return style(truncate(String(params.pattern || '') + inc, 60));
    }
    case 'WebFetch':
      return style(truncate(String(params.url || ''), 60));
    case 'WebSearch':
      return style(truncate(String(params.query || ''), 60));
    case 'TodoWrite': {
      const todos = (params.todos as Array<{ status: string }> | undefined) ?? [];
      // Empty inline arg — Claude Code's "Update Todos" header has no
      // parens; we keep the parens for consistency with other tools but
      // make the inner text unobtrusive.
      return chalk.dim(`${todos.length} item${todos.length === 1 ? '' : 's'}`);
    }
    default:
      return style(truncate(JSON.stringify(params), 60));
  }
}

function relOrAbs(p: string): string {
  if (!p) return '';
  const rel = path.relative(process.cwd(), p);
  if (rel && !rel.startsWith('..')) return rel;
  return p;
}

function defaultToolSummary(name: string, output: string): string {
  const lines = output.split('\n').length;
  const chars = output.length;
  if (chars === 0) return chalk.dim('(no output)');
  switch (name) {
    case 'Bash':
      return chalk.dim(`${lines} line${lines === 1 ? '' : 's'} of output`);
    case 'Glob': {
      const fileMatch = output.match(/Found (\d+) file/);
      return chalk.dim(fileMatch ? `${fileMatch[1]} file(s) matched` : `${lines} line(s)`);
    }
    case 'Grep': {
      const matchCount = output.match(/Found (\d+) match/);
      return chalk.dim(matchCount ? `${matchCount[1]} match(es)` : `${lines} line(s)`);
    }
    case 'WebFetch':
      return chalk.dim(`fetched ${chars.toLocaleString()} chars`);
    case 'WebSearch':
      return chalk.dim('results returned');
    default:
      return chalk.dim(`${lines} line(s)`);
  }
}

function shouldShowPreview(name: string): boolean {
  // Only show previews for tools where a preview adds value.
  return name === 'Bash';
}

function buildPreview(output: string): string {
  const lines = output.split('\n');
  const maxLines = 8;
  const shown = lines.slice(0, maxLines);
  let preview = shown.map((l) => chalk.dim('    │ ') + l.slice(0, 200)).join('\n');
  if (lines.length > maxLines) {
    preview += '\n' + chalk.dim(`    │ … (+${lines.length - maxLines} more lines)`);
  }
  return preview;
}

// Claude Code-style pulsing ✻ spinner.
function startSpinner(label: string, indent: string = ''): { stop: () => void } {
  if (!process.stdout.isTTY) {
    return { stop: () => {} };
  }
  // Pulse between dim and bright orange to match Claude Code's ✻ animation.
  const frames = ['✻', '✻', '✻', '✺', '✹', '✸', '✷', '✶', '✶', '✶', '✷', '✸', '✹', '✺'];
  let i = 0;
  let stopped = false;
  const write = (frame: string) => {
    process.stdout.write(`\r${indent}${SAFFRON(frame)} ${chalk.dim(label)}`);
  };
  write(frames[0]);
  const timer = setInterval(() => {
    if (stopped) return;
    i = (i + 1) % frames.length;
    write(frames[i]);
  }, 100);
  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      process.stdout.write('\r\x1B[K');
    },
  };
}
