import * as readline from 'readline';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { GrokClient, GrokMessage, GrokContentPart, ToolCall, ChatOptions as GrokChatOptions } from '../grok/client.js';
import { allTools, executeTool, ToolResult } from '../tools/registry.js';
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

function buildSystemPrompt(cwd: string, workingDirs: string[], projectContext: string): string {
  const dirList = workingDirs.length > 1
    ? '\n' + workingDirs.map((d, i) => `  ${i === 0 ? '→' : ' '} ${d}`).join('\n')
    : ` ${cwd}`;

  return `You are Grok Code, an agentic CLI coding assistant powered by xAI's Grok models. You help users with software engineering tasks directly from the terminal.

# Tone and style
Be concise, direct, and to the point. Output will be rendered in a terminal, so keep it scannable. Answer in one or two short sentences when you can. Only go long when the user asks for explanation or the task genuinely needs it. Skip preamble ("I'll help you...", "Sure!", "Let me..."). Don't restate what the user said. Don't summarize what you just did unless asked. Don't emit filler.

You MAY use GitHub-flavored Markdown. Code blocks should use fenced syntax with a language tag so the terminal can highlight them.

# Proactiveness
You are allowed to be proactive when the user asks for something, but don't do extra work beyond what they asked. Don't refactor code you weren't asked to refactor. Don't "improve" code that works. Don't add comments or docstrings to code you didn't change. Don't add speculative error handling. Match the existing code style.

# Following conventions
Before editing a file, read it and understand the existing conventions. Mimic the style (naming, formatting, comments) of the code you're working with. Check imports and neighbouring files before introducing new patterns. If the repo uses a particular library, use that same library — don't introduce a new dependency unless necessary.

# Task management
For non-trivial tasks, break work into clear steps and execute them in order. Read relevant files before making edits. Verify your assumptions. When a task is done, stop — don't volunteer unrelated follow-ups.

# Tool use rules
- **Read before you Edit.** Never edit a file you haven't read in this session.
- **Edit requires exact matches.** The \`old_string\` parameter must match exactly, including whitespace and indentation. If \`old_string\` is not unique in the file, either include more surrounding context to disambiguate or pass \`replace_all: true\`.
- **Prefer Grep for searching code**, Glob for finding files. Don't use Bash's find/grep for that — the dedicated tools are faster and more precise.
- **Prefer Read over Bash \`cat\`**, Write over \`echo >\`, Edit over \`sed\`.
- **Batch independent tool calls in a single response** when possible to save round-trips.
- **Bash is for actions the dedicated tools can't do** — git, npm, running tests, etc. Don't use it for file reads or file searches.
- **WebSearch / WebFetch** are for looking up current information, library docs, error messages. Use when you need information that isn't in the workspace.

# Available tools
- **Read**: Read files with line numbers. Supports offset/limit.
- **Write**: Create a new file or overwrite an existing one.
- **Edit**: Replace an exact string in a file. Reads before editing is REQUIRED.
- **Glob**: Find files matching a glob pattern (e.g. \`**/*.ts\`).
- **Grep**: Regex search across files. Supports include filter.
- **Bash**: Execute shell commands (git, npm, tests). Has a timeout and captures stdout/stderr.
- **WebFetch**: Fetch a URL and return its content (HTML is converted to text, JSON is parsed).
- **WebSearch**: Search the web for current information.

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
    '/add-dir': 'Add a working directory',
    '/pwd': 'Show working directories',

    // Attachments & custom
    '/image': 'Attach an image from a file path',
    '/paste': 'Paste image from clipboard',
    '/commands': 'List custom commands',
  };

  constructor(options: ChatInitOptions) {
    this.apiKey = options.apiKey;

    // Parse initial model to determine base and mode
    const initialModel = options.model || 'grok-4-1-fast-reasoning';
    this.parseModelMode(initialModel);
    this.client = new GrokClient(options.apiKey, this.getCurrentModel());

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

        // Live slash-command popup: after each keystroke, if the line
        // starts with '/', show matching commands dimmed below the prompt.
        // We use a simple single-line footer that gets rewritten in place.
        if (this.rl.line.startsWith('/') && !key.ctrl) {
          this.updateSlashPopup();
        } else if (this.slashPopupActive) {
          this.clearSlashPopup();
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
    const modeLabel = this.thinkingMode ? chalk.cyan('🧠 Thinking') : chalk.yellow('⚡ Fast');
    console.log(chalk.dim('  Mode: ') + modeLabel + chalk.dim(` (${newModel})`));
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
      await this.processMessage(prompt, { quietPrompt: true });
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
    // Claude Code-style welcome: small bordered box with star icon,
    // a help hint line, and the working directory.
    const width = Math.min(process.stdout.columns || 62, 62);
    const innerWidth = width - 4; // account for "│ " and " │"
    const top = chalk.dim('╭' + '─'.repeat(width - 2) + '╮');
    const bot = chalk.dim('╰' + '─'.repeat(width - 2) + '╯');
    const line = (text: string): string => {
      const visible = text.replace(/\x1B\[[0-9;]*m/g, '');
      const pad = Math.max(0, innerWidth - visible.length);
      return chalk.dim('│ ') + text + ' '.repeat(pad) + chalk.dim(' │');
    };
    const blank = line('');

    const cwd = process.cwd().replace(os.homedir(), '~');
    // Tri-color star row: saffron, white, green — tiranga accent.
    const tricolor = SAFFRON('✻') + ' ' + chalk.white('✻') + ' ' + INDIA_GREEN('✻');

    console.log();
    console.log(top);
    console.log(line(tricolor + '  ' + chalk.bold('Welcome to Grok Code!')));
    console.log(blank);
    console.log(line(chalk.dim('  /help for help, /status for your current setup')));
    console.log(blank);
    console.log(line(chalk.dim('  cwd: ') + cwd));
    if (resumedTitle) {
      console.log(blank);
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
        const badges: string[] = [];
        if (this.planMode) badges.push(chalk.yellow('plan mode'));
        if (!this.thinkingMode) badges.push(chalk.dim('fast mode'));
        if (this.pending.images.length > 0) {
          const n = this.pending.images.length;
          badges.push(chalk.magenta(`${n} image${n === 1 ? '' : 's'} attached`));
        }
        const footer =
          badges.length > 0
            ? chalk.dim('  ') + badges.join(chalk.dim(' · ')) + chalk.dim(' · ? for shortcuts')
            : chalk.dim('  ? for shortcuts');

        console.log(footer);
        this.rl.question(chalk.dim('> '), (answer) => {
          this.clearSlashPopup();
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
        console.log(chalk.dim(`  Streaming ${this.useStreaming ? 'enabled' : 'disabled'}.`));
        break;

      case 'plan':
        this.planMode = !this.planMode;
        console.log(
          chalk.dim('  Plan mode ') + (this.planMode ? chalk.yellow('on') : chalk.dim('off')) +
          chalk.dim(' — Write/Edit/Bash will be denied while on.')
        );
        break;

      case 'permissions':
        this.handlePermissions();
        break;

      // Status & info
      case 'status':
        this.showStatus();
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
      console.log(chalk.dim(`  ✓ Switched to ${matchedModel}`));
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

    const describe = (model: string): string => {
      if (model.includes('non-reasoning')) return 'fast';
      if (model.includes('reasoning')) return 'reasoning';
      if (model.includes('mini')) return 'small/fast';
      if (model.includes('image')) return 'image gen';
      if (model.includes('vision')) return 'vision';
      return '';
    };

    for (const m of [...grok41, ...grok4, ...grok3, ...grok2, ...others]) {
      options.push({ label: m, value: m, description: describe(m) });
    }

    console.log();
    const selected = await interactiveSelect('Select model:', options, this.client.model);

    if (selected && selected !== this.client.model) {
      this.parseModelMode(selected);
      this.client = new GrokClient(this.apiKey, selected);
      console.log(chalk.dim(`  ✓ Switched to ${selected}`));
    } else if (!selected) {
      console.log(chalk.dim('  Cancelled.'));
    }
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
    console.log('  [Allow once] [Allow session] [Deny] [Block session]');
    console.log();
    const auto = (this.config.get('autoApprove') as string[]).join(', ') || 'none';
    console.log(chalk.dim(`  Auto-approved: ${auto}`));
    console.log();
  }

  private showStatus(): void {
    const uptime = Math.floor((Date.now() - this.sessionStartTime.getTime()) / 1000);
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;
    const estTokens = this.estimateTokens();
    const usagePct = Math.min(100, Math.round((estTokens / this.contextWindowTokens) * 100));

    console.log();
    console.log('  ' + SAFFRON('✻') + ' ' + chalk.bold('Grok Code Status'));
    console.log(chalk.dim('  ────────────────'));
    console.log();

    console.log(chalk.bold('  Version & model'));
    console.log(`    Version:   ${VERSION}`);
    console.log(`    Model:     ${this.client.model}`);
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
      checks.push({ name: 'API Key', status: 'fail', message: 'missing — run `grok auth`' });
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

    try {
      await fs.access(grokMdPath);
      console.log(chalk.yellow('  GROK.md already exists. Edit it directly or delete to re-init.'));
      return;
    } catch {
      // create
    }

    const template = `# ${path.basename(process.cwd())}

## What this project does
<!-- Short description of the project's purpose -->

## Tech stack
<!-- Main languages, frameworks, libraries -->

## Project structure
<!-- Key directories and what lives in them -->

## Coding conventions
<!-- Style rules: naming, formatting, file layout, imports -->

## Common commands
\`\`\`bash
# Install
# Build
# Test
# Run dev server
\`\`\`

## Notes for Grok
- Read files before editing
- Match existing code style
- Run tests after changes
- Use Bash for git and npm operations
`;

    await fs.writeFile(grokMdPath, template, 'utf-8');

    // Also scaffold .grok/commands/ dir
    await initCommandsDir();

    // Reload into current session
    await this.loadProjectContext();
    this.messages[0] = {
      role: 'system',
      content: buildSystemPrompt(process.cwd(), this.workingDirs, this.projectContext),
    };

    console.log(chalk.green('  ✓ Created GROK.md and .grok/commands/'));
    console.log(chalk.dim('  Contents are automatically included in the system prompt.'));
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
      console.log(chalk.dim(`  Output style: ${this.outputStyle}`));
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
      console.log(chalk.dim(`  ✓ Output style: ${this.outputStyle}`));
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
      console.log(chalk.dim(`  Theme: ${this.theme} ${chalk.yellow('(restart for full effect)')}`));
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
      console.log(chalk.dim(`  ✓ Theme: ${this.theme} ${chalk.yellow('(restart for full effect)')}`));
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
    console.log('  ' + SAFFRON('✻') + ' ' + chalk.bold('Grok Code ') + d(`v${VERSION}`));
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
   * Called on every keystroke while the input starts with '/'.
   */
  private updateSlashPopup(): void {
    if (!process.stdout.isTTY) return;
    const line = this.rl.line;
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

    const matches = all.filter(([cmd]) => cmd.toLowerCase().startsWith(line.toLowerCase()));
    const display = matches.slice(0, 7); // cap popup height

    // Always clear previous popup first
    this.clearSlashPopup();

    if (display.length === 0) return;

    // Save cursor position, draw popup below, restore cursor.
    const out = process.stdout;
    out.write('\x1B[s'); // save cursor

    for (const [cmd, desc] of display) {
      out.write('\n\x1B[2K'); // newline + clear line
      const pad = cmd.padEnd(16);
      out.write(chalk.dim('  ') + chalk.cyan(pad) + '  ' + chalk.dim(desc));
    }
    if (matches.length > display.length) {
      out.write('\n\x1B[2K');
      out.write(chalk.dim(`  … (+${matches.length - display.length} more — keep typing)`));
      this.slashPopupLines = display.length + 1;
    } else {
      this.slashPopupLines = display.length;
    }

    out.write('\x1B[u'); // restore cursor
    this.slashPopupActive = true;
  }

  /** Clear the slash popup lines below the prompt. */
  private clearSlashPopup(): void {
    if (!this.slashPopupActive || !process.stdout.isTTY) {
      this.slashPopupActive = false;
      this.slashPopupLines = 0;
      return;
    }
    const out = process.stdout;
    out.write('\x1B[s'); // save cursor
    for (let i = 0; i < this.slashPopupLines; i++) {
      out.write('\n\x1B[2K');
    }
    out.write('\x1B[u'); // restore cursor
    this.slashPopupActive = false;
    this.slashPopupLines = 0;
  }

  // === Shell escape and memory add ===

  /** Run a shell command immediately via Bash tool, bypassing Grok. */
  private async runShellEscape(command: string): Promise<void> {
    console.log(SAFFRON('● ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white(command) + chalk.dim(')'));
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

  private async getResponse(): Promise<void> {
    const spinner = startSpinner('Thinking…');

    try {
      const response = await this.client.chat(this.messages, allTools);
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

        for (const toolCall of message.tool_calls) {
          await this.executeToolCall(toolCall);
        }

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
          process.stdout.write(delta.content);
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

      if (fullContent && !aborted) {
        console.log();
      }

      const message: GrokMessage = {
        role: 'assistant',
        content: fullContent,
      };
      if (toolCalls.length > 0) message.tool_calls = toolCalls;
      this.messages.push(message);

      if (toolCalls.length > 0 && !aborted) {
        if (fullContent) console.log();
        for (const toolCall of toolCalls) {
          await this.executeToolCall(toolCall);
        }
        // Continue the agentic loop
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
          process.stdin.removeListener('data', onKeypress);
        }
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

    // Plan mode: block writes and execute
    if (this.planMode && (name === 'Write' || name === 'Edit' || name === 'Bash')) {
      const reason = `Plan mode is on — ${name} is blocked. Toggle with /plan.`;
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
      console.log(chalk.dim('  ') + chalk.red('● ') + chalk.dim(`${name}(${invocation}) — denied`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'Error: Permission denied by user',
      });
      return;
    }

    console.log(SAFFRON('● ') + chalk.bold(name) + chalk.dim('(') + invocation + chalk.dim(')'));


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

    this.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.success ? result.output : `Error: ${result.error}`,
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
    case 'Bash':
      return style(truncate(String(params.command || ''), 60));
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
