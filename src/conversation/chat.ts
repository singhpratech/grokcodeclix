import * as readline from 'readline';
import * as fs from 'fs/promises';
import { readFileSync } from 'fs';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { fileURLToPath } from 'url';
import { GrokClient, GrokMessage, ToolCall } from '../grok/client.js';
import { allTools, executeTool } from '../tools/registry.js';
import { PermissionManager } from '../permissions/manager.js';
import { HistoryManager, ConversationSession } from './history.js';
import { ConfigManager } from '../config/manager.js';
import { drawBox, randomTip, divider, formatCodeBlock, progressBar } from '../utils/ui.js';
import { interactiveSelect, SelectorOption } from '../utils/selector.js';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'));

const SYSTEM_PROMPT = `You are Grok Code, a powerful CLI coding assistant powered by xAI's Grok.
You help users with software engineering tasks including writing code, debugging, explaining code, and managing files.

## Available Tools
- **Read**: Read file contents with line numbers
- **Write**: Write content to files (creates directories if needed)
- **Edit**: Edit files by replacing exact strings
- **Bash**: Execute shell commands (git, npm, etc.)
- **Glob**: Find files by pattern (e.g., "**/*.ts")
- **Grep**: Search file contents with regex
- **WebFetch**: Fetch content from URLs

## Guidelines
1. **Always read before editing**: Never modify a file you haven't read first
2. **Be precise with edits**: The Edit tool requires exact string matches
3. **Explain your actions**: Tell the user what you're doing and why
4. **Security first**: Never introduce vulnerabilities (XSS, SQL injection, command injection)
5. **Stay focused**: Only make changes that are directly requested
6. **Use appropriate tools**: Prefer Read/Write/Edit over Bash for file operations

## Git Operations
- Use Bash for git commands
- Never force push to main/master without explicit permission
- Write clear, descriptive commit messages

## Current Context
- Working directory: ${process.cwd()}
- Platform: ${process.platform}
- Date: ${new Date().toLocaleDateString()}`;

const VERSION = packageJson.version;

export interface ChatOptions {
  apiKey: string;
  model?: string;
  resume?: boolean;
  sessionId?: string;
}

interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
  private tokenUsage: TokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
  private sessionStartTime: Date = new Date();
  private apiKey: string;
  private abortController: AbortController | null = null;
  private thinkingMode: boolean = true; // true = reasoning model, false = fast model
  private baseModel: string = 'grok-4-1'; // base model without mode suffix

  // Slash commands with descriptions
  private static SLASH_COMMANDS: Record<string, string> = {
    '/help': 'Show help',
    '/clear': 'Clear conversation',
    '/save': 'Save session',
    '/exit': 'Exit',
    '/history': 'Show history',
    '/resume': 'Resume session',
    '/rename': 'Rename session',
    '/export': 'Export chat',
    '/compact': 'Reduce context',
    '/config': 'Show config',
    '/model': 'Change model',
    '/stream': 'Toggle streaming',
    '/permissions': 'View permissions',
    '/status': 'Show status',
    '/context': 'Context usage',
    '/cost': 'Token costs',
    '/usage': 'Usage stats',
    '/doctor': 'Run diagnostics',
    '/version': 'Show version',
    '/init': 'Create GROK.md',
    '/review': 'Code review',
    '/add-dir': 'Add directory',
    '/pwd': 'Show directories',
    '/login': 'Login to xAI',
    '/logout': 'Logout',
  };

  constructor(options: ChatOptions) {
    this.apiKey = options.apiKey;

    // Parse initial model to determine base and mode
    const initialModel = options.model || 'grok-4-1-fast-reasoning';
    this.parseModelMode(initialModel);
    this.client = new GrokClient(options.apiKey, this.getCurrentModel());

    const commandEntries = Object.entries(GrokChat.SLASH_COMMANDS);

    // Track current line for Tab handling
    let currentLine = '';

    // Autocomplete function for slash commands - shows command with description
    // Also handles Tab on empty line to toggle mode
    const completer = (line: string): [string[], string] => {
      currentLine = line;

      // Tab on empty line - toggle mode (return special marker)
      if (line === '') {
        this.toggleThinkingMode();
        return [[], ''];
      }

      if (line.startsWith('/')) {
        const matches = commandEntries.filter(([cmd]) => cmd.startsWith(line));
        if (matches.length > 0) {
          // Format: "/cmd - description"
          const formatted = matches.map(([cmd, desc]) => `${cmd.padEnd(14)} ${desc}`);
          // Return just the command names for actual completion
          const cmds = matches.map(([cmd]) => cmd);
          // Show formatted list, complete with just command
          if (matches.length === 1) {
            return [[matches[0][0]], line];
          }
          return [formatted, line];
        }
        // Show all if just "/"
        const all = commandEntries.map(([cmd, desc]) => `${cmd.padEnd(14)} ${desc}`);
        return [all, line];
      }
      return [[], line];
    };

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      completer,
    });
    this.permissions = new PermissionManager();
    this.permissions.setReadlineInterface(this.rl);
    this.history = new HistoryManager();
    this.config = new ConfigManager();

    // Handle Ctrl+C for clean exit
    this.rl.on('SIGINT', async () => {
      if (this.abortController) {
        // If streaming, abort it
        this.abortController.abort();
        console.log(chalk.dim('\n  Stopped.'));
      } else {
        // Otherwise exit
        await this.saveSession();
        console.log(chalk.gray('\n\nSession saved. Goodbye!\n'));
        process.exit(0);
      }
    });
  }

  // Parse model string to determine base model and thinking mode
  private parseModelMode(model: string): void {
    if (model.includes('fast-reasoning') || model.includes('reasoning')) {
      this.thinkingMode = !model.includes('non-reasoning');
      // Extract base model (e.g., grok-4-1 from grok-4-1-fast-reasoning)
      this.baseModel = model.replace(/-fast-reasoning$/, '').replace(/-reasoning$/, '').replace(/-non-reasoning$/, '');
    } else {
      // Non-reasoning model or old format
      this.thinkingMode = false;
      this.baseModel = model;
    }
  }

  // Get current model name based on thinking mode
  private getCurrentModel(): string {
    if (this.baseModel.startsWith('grok-4')) {
      return this.thinkingMode ? `${this.baseModel}-fast-reasoning` : `${this.baseModel}-non-reasoning`;
    }
    return this.baseModel;
  }

  // Toggle between thinking and fast mode
  private toggleThinkingMode(): void {
    this.thinkingMode = !this.thinkingMode;
    const newModel = this.getCurrentModel();
    this.client = new GrokClient(this.apiKey, newModel);
    const modeLabel = this.thinkingMode ? '🧠 Thinking' : '⚡ Fast';
    console.log(chalk.dim(`  Switched to ${modeLabel} mode (${newModel})`));
  }

  async start(): Promise<void> {
    // Clean welcome like Claude Code
    const modeIcon = this.thinkingMode ? '🧠' : '⚡';
    const modeLabel = this.thinkingMode ? 'Thinking' : 'Fast';
    console.log();
    console.log(chalk.bold.white(' Grok Code') + chalk.dim(` v${VERSION}`));
    console.log(chalk.dim(` ${this.client.model} ${modeIcon} • ${process.cwd()}`));
    console.log(chalk.dim(' Tab: toggle mode • Esc: stop • Ctrl+C: exit • /help'));
    console.log();

    // Create new session
    this.session = await this.history.createSession(process.cwd());
    this.sessionStartTime = new Date();

    // Initialize with system prompt
    this.messages.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });

    await this.loop();
  }

  // Non-interactive single prompt mode (for piped input or CLI args)
  async sendSingle(prompt: string): Promise<void> {
    this.messages.push({
      role: 'system',
      content: SYSTEM_PROMPT,
    });

    this.messages.push({
      role: 'user',
      content: prompt,
    });

    try {
      await this.getStreamingResponse();
    } catch (error) {
      const err = error as Error;
      console.error(chalk.red(`Error: ${err.message}`));
      process.exit(1);
    }

    process.exit(0);
  }

  async resume(sessionId?: string): Promise<void> {
    let session: ConversationSession | null = null;

    if (sessionId) {
      session = await this.history.loadSession(sessionId);
    } else {
      session = await this.history.getLastSession();
    }

    if (!session) {
      console.log(chalk.yellow('No previous session found. Starting new conversation.\n'));
      await this.start();
      return;
    }

    this.session = session;
    this.messages = session.messages;
    this.sessionStartTime = new Date();

    console.log(chalk.cyan('\n🚀 Grok Code CLI (Resumed)'));
    console.log(chalk.gray(`Session: ${session.title}`));
    console.log(chalk.gray(`Model: ${this.client.model}`));
    console.log(chalk.gray(`Working directory: ${process.cwd()}`));
    console.log(chalk.gray('Type /help for commands, "exit" to quit.\n'));

    // Show recent context
    const recentMessages = this.messages.filter(m => m.role !== 'system').slice(-4);
    if (recentMessages.length > 0) {
      console.log(chalk.gray('─── Recent context ───'));
      for (const msg of recentMessages) {
        if (msg.role === 'user') {
          console.log(chalk.white('You: ') + chalk.gray(msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')));
        } else if (msg.role === 'assistant' && msg.content) {
          console.log(chalk.blue('Grok: ') + chalk.gray(msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')));
        }
      }
      console.log(chalk.gray('──────────────────────\n'));
    }

    await this.loop();
  }

  private async loop(): Promise<void> {
    const showPrompt = (): Promise<string> => {
      return new Promise((resolve) => {
        // Show mode indicator and separator like Claude Code
        const modeIcon = this.thinkingMode ? '🧠' : '⚡';
        console.log(chalk.dim('─'.repeat(50)));
        this.rl.question(chalk.bold.yellow(`${modeIcon} ❯ `), (answer) => {
          resolve(answer);
        });
      });
    };

    while (true) {
      const input = await showPrompt();
      const trimmed = input.trim();

      // Empty input - just continue (Tab toggle already handled in completer)
      if (!trimmed) continue;

      // Handle commands
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        this.rl.close();
        break;
      }

      if (trimmed === '/') {
        // Interactive slash command menu
        const options: SelectorOption[] = Object.entries(GrokChat.SLASH_COMMANDS).map(([cmd, desc]) => ({
          label: cmd,
          value: cmd,
          description: desc,
        }));

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

      // Auto-compact at 80% context (estimate ~4 chars per token, 2M token limit)
      const totalChars = this.messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
      const estimatedTokens = totalChars / 4;
      const maxTokens = 2_000_000;
      if (estimatedTokens > maxTokens * 0.8) {
        console.log(chalk.dim('  Auto-compacting context...'));
        await this.handleCompact();
      }

      await this.processMessage(trimmed);
    }
  }

  private async handleCommand(command: string): Promise<boolean> {
    const parts = command.slice(1).split(' ');
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1).join(' ');

    switch (cmd) {
      // Session Management
      case 'clear':
        this.messages = [this.messages[0]]; // Keep system prompt
        this.session = await this.history.createSession(process.cwd());
        this.tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
        console.log(chalk.gray('Conversation cleared.\n'));
        break;

      case 'exit':
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        return true;

      case 'save':
        await this.saveSession();
        console.log(chalk.white('Session saved.\n'));
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

      // Configuration
      case 'config':
        await this.handleConfig();
        break;

      case 'model':
        await this.handleModel(args);
        break;

      case 'stream':
        this.useStreaming = !this.useStreaming;
        console.log(chalk.gray(`Streaming ${this.useStreaming ? 'enabled' : 'disabled'}.\n`));
        break;

      case 'permissions':
        this.handlePermissions();
        break;

      // Status & Info
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

      // Working Directory
      case 'add-dir':
        this.handleAddDir(args);
        break;

      case 'pwd':
        console.log(chalk.cyan(`\nWorking directories:\n`));
        this.workingDirs.forEach((dir, i) => {
          console.log(`  ${i === 0 ? chalk.white('→') : ' '} ${dir}`);
        });
        console.log();
        break;

      case 'login':
        const loginSuccess = await this.config.setupAuth();
        if (loginSuccess) {
          const newKey = await this.config.getApiKey();
          if (newKey) {
            this.apiKey = newKey;
            this.client = new GrokClient(newKey, this.client.model);
            console.log(chalk.dim('  ✓ Logged in\n'));
          }
        }
        break;

      case 'logout':
        await this.config.set('apiKey', undefined as unknown as string);
        console.log(chalk.dim('  ✓ Logged out. Run /login to authenticate again.\n'));
        break;

      // Help
      case 'help':
        this.showHelp();
        break;

      case 'version':
        console.log(chalk.cyan(`\nGrok Code CLI v${VERSION}\n`));
        break;

      // Project Setup
      case 'init':
        await this.handleInit();
        break;

      case 'review':
        await this.handleReview(args);
        break;

      case 'terminal-setup':
        this.showTerminalSetup();
        break;

      // Convenience aliases
      case 'h':
        this.showHelp();
        break;

      case 'q':
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        return true;

      case 's':
        await this.saveSession();
        console.log(chalk.white('Session saved.\n'));
        break;

      case 'c':
        this.messages = [this.messages[0]];
        this.session = await this.history.createSession(process.cwd());
        console.log(chalk.gray('Conversation cleared.\n'));
        break;

      default:
        console.log(chalk.yellow(`Unknown command: /${cmd}`));
        console.log(chalk.gray('Type /help to see available commands.\n'));
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
    console.log(chalk.gray(`Conversation compacted. Removed ${removedCount} messages, kept ${this.messages.length}.\n`));

    if (instructions) {
      console.log(chalk.gray(`Focus instructions: ${instructions}\n`));
    }
  }

  private async handleResume(sessionId: string): Promise<void> {
    const sessions = await this.history.listSessions(10);

    if (sessions.length === 0) {
      console.log(chalk.dim('  No saved sessions.\n'));
      return;
    }

    // If no session ID provided, show interactive picker
    if (!sessionId) {
      const options: SelectorOption[] = sessions.map(s => {
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

    // Load the session
    let session = await this.history.loadSession(sessionId);
    if (!session) {
      // Try partial match
      const match = sessions.find(s => s.id.startsWith(sessionId));
      if (match) {
        session = match;
      } else {
        console.log(chalk.red(`  Session not found: ${sessionId}\n`));
        return;
      }
    }

    this.session = session;
    this.messages = session.messages;
    console.log(chalk.dim(`  ✓ Resumed: ${session.title}\n`));
  }

  private async handleRename(name: string): Promise<void> {
    if (!name) {
      console.log(chalk.yellow('Usage: /rename <new-name>\n'));
      return;
    }

    if (this.session) {
      this.session.title = name;
      await this.saveSession();
      console.log(chalk.white(`Session renamed to: ${name}\n`));
    } else {
      console.log(chalk.red('No active session to rename.\n'));
    }
  }

  private async handleExport(filename?: string): Promise<void> {
    const content = this.messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const role = m.role === 'user' ? 'You' : m.role === 'assistant' ? 'Grok' : 'Tool';
        return `## ${role}\n\n${m.content}\n`;
      })
      .join('\n---\n\n');

    if (filename) {
      const filePath = path.resolve(filename);
      await fs.writeFile(filePath, content, 'utf-8');
      console.log(chalk.white(`Conversation exported to: ${filePath}\n`));
    } else {
      // Copy to clipboard concept - just show it
      console.log(chalk.cyan('\n─── Exported Conversation ───\n'));
      console.log(content.slice(0, 2000));
      if (content.length > 2000) {
        console.log(chalk.gray('\n... (truncated, use /export <filename> to save full conversation)'));
      }
      console.log(chalk.cyan('\n─────────────────────────────\n'));
    }
  }

  private async handleConfig(): Promise<void> {
    console.log(chalk.cyan('\n⚙️  Configuration\n'));

    const apiKey = await this.config.getApiKey();
    console.log(`  API Key:     ${apiKey ? chalk.white('✓ Set') : chalk.red('✗ Not set')}`);
    console.log(`  Model:       ${this.client.model}`);
    console.log(`  Streaming:   ${this.useStreaming ? chalk.white('enabled') : chalk.gray('disabled')}`);
    console.log(`  Temperature: ${this.config.get('temperature')}`);
    console.log(`  Max Tokens:  ${this.config.get('maxTokens')}`);
    console.log(`  Auto-approve: ${(this.config.get('autoApprove') as string[]).join(', ') || 'none'}`);
    console.log();
    console.log(chalk.gray(`  Config file: ~/.config/grokcodecli/config.json`));
    console.log(chalk.gray('  Run `grok config` in terminal to modify.\n'));
  }

  private async handleModel(modelName?: string): Promise<void> {
    // Fetch latest models from xAI API
    process.stdout.write(chalk.dim('  Fetching models...'));

    let availableModels: string[] = [];
    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });

      if (response.ok) {
        const data = await response.json() as { data: { id: string }[] };
        availableModels = data.data.map(m => m.id).sort();
      } else {
        availableModels = [
          'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
          'grok-4-0709', 'grok-4-fast-reasoning', 'grok-4-fast-non-reasoning',
          'grok-3', 'grok-3-mini',
        ];
      }
    } catch {
      availableModels = [
        'grok-4-1-fast-reasoning', 'grok-4-1-fast-non-reasoning',
        'grok-4-0709', 'grok-3', 'grok-3-mini',
      ];
    }

    process.stdout.write('\r\x1B[K'); // Clear the "Fetching" line

    // If model name provided directly, switch to it
    if (modelName) {
      let matchedModel = modelName;
      if (!availableModels.includes(modelName)) {
        // Normalize: "grok41" → "grok-4-1", "4.1" → "4-1"
        const normalized = modelName.toLowerCase()
          .replace(/grok\s*(\d)(\d)?/g, (_, d1, d2) => d2 ? `grok-${d1}-${d2}` : `grok-${d1}`)
          .replace(/(\d+)\.(\d+)/g, '$1-$2')
          .replace(/\s+/g, '-');

        const partialMatch = availableModels.find(m => m.toLowerCase().includes(normalized)) ||
          availableModels.find(m => m.toLowerCase().includes(modelName.toLowerCase()));

        if (partialMatch) {
          matchedModel = partialMatch;
        } else {
          console.log(chalk.red(`  Unknown model: ${modelName}`));
          return;
        }
      }

      this.client = new GrokClient(this.apiKey, matchedModel);
      console.log(chalk.white(`  ✓ Switched to ${matchedModel}`));
      return;
    }

    // Build options for interactive selector - prioritize Grok 4.1
    const options: SelectorOption[] = [];

    // Categorize models
    const grok41 = availableModels.filter(m => m.startsWith('grok-4-1'));
    const grok4 = availableModels.filter(m => m.startsWith('grok-4') && !m.startsWith('grok-4-1'));
    const grok3 = availableModels.filter(m => m.startsWith('grok-3'));
    const others = availableModels.filter(m => !m.startsWith('grok-4') && !m.startsWith('grok-3'));

    // Add Grok 4.1 first (latest)
    for (const model of grok41) {
      const desc = model.includes('non-reasoning') ? 'fast' : model.includes('reasoning') ? 'reasoning' : '';
      options.push({ label: model, value: model, description: desc });
    }

    // Add Grok 4
    for (const model of grok4) {
      const desc = model.includes('non-reasoning') ? 'fast' : model.includes('reasoning') ? 'reasoning' : '';
      options.push({ label: model, value: model, description: desc });
    }

    // Add Grok 3
    for (const model of grok3) {
      options.push({ label: model, value: model });
    }

    // Add others
    for (const model of others) {
      options.push({ label: model, value: model });
    }

    console.log();
    const selected = await interactiveSelect('Select model:', options, this.client.model);

    if (selected && selected !== this.client.model) {
      this.client = new GrokClient(this.apiKey, selected);
      console.log(chalk.white(`  ✓ Switched to ${selected}`));
    } else if (!selected) {
      console.log(chalk.dim('  Cancelled'));
    }
  }

  private handlePermissions(): void {
    console.log(chalk.cyan('\n🔐 Permission Settings\n'));
    console.log('  Tool Risk Levels:');
    console.log(`    ${chalk.white('📖 Read')}    - Read, Glob, Grep, WebFetch`);
    console.log(`    ${chalk.yellow('✏️  Write')}   - Write, Edit`);
    console.log(`    ${chalk.red('⚡ Execute')} - Bash`);
    console.log();
    console.log('  Permission Responses:');
    console.log('    [y] Allow once');
    console.log('    [a] Allow for session');
    console.log('    [n] Deny');
    console.log('    [!] Block for session');
    console.log();
    console.log(chalk.gray('  Auto-approved tools: ' + ((this.config.get('autoApprove') as string[]).join(', ') || 'none')));
    console.log(chalk.gray('  Edit config to add auto-approve rules.\n'));
  }

  private showStatus(): void {
    const uptime = Math.floor((Date.now() - this.sessionStartTime.getTime()) / 1000);
    const minutes = Math.floor(uptime / 60);
    const seconds = uptime % 60;

    console.log(chalk.cyan('\n📊 Status\n'));
    console.log(`  Version:     ${VERSION}`);
    console.log(`  Model:       ${this.client.model}`);
    console.log(`  Session:     ${this.session?.title || 'Untitled'}`);
    console.log(`  Session ID:  ${this.session?.id.slice(0, 8) || 'N/A'}`);
    console.log(`  Messages:    ${this.messages.length}`);
    console.log(`  Uptime:      ${minutes}m ${seconds}s`);
    console.log(`  Streaming:   ${this.useStreaming ? 'on' : 'off'}`);
    console.log(`  Working Dir: ${process.cwd()}`);
    console.log(`  Platform:    ${process.platform} ${process.arch}`);
    console.log(`  Node:        ${process.version}`);
    console.log();
  }

  private showContext(): void {
    const messageCount = this.messages.length;
    const userMessages = this.messages.filter(m => m.role === 'user').length;
    const assistantMessages = this.messages.filter(m => m.role === 'assistant').length;
    const toolMessages = this.messages.filter(m => m.role === 'tool').length;

    // Estimate tokens (rough: 4 chars = 1 token)
    const totalChars = this.messages.reduce((acc, m) => acc + (m.content?.length || 0), 0);
    const estimatedTokens = Math.ceil(totalChars / 4);
    const maxTokens = 128000; // Approximate context window
    const usagePercent = Math.min(100, Math.round((estimatedTokens / maxTokens) * 100));

    console.log(chalk.cyan('\n📈 Context Usage\n'));

    // Visual bar
    const barWidth = 40;
    const filledWidth = Math.round((usagePercent / 100) * barWidth);
    const emptyWidth = barWidth - filledWidth;
    const bar = chalk.white('█'.repeat(filledWidth)) + chalk.gray('░'.repeat(emptyWidth));

    console.log(`  [${bar}] ${usagePercent}%`);
    console.log();
    console.log(`  Estimated tokens: ~${estimatedTokens.toLocaleString()} / ${maxTokens.toLocaleString()}`);
    console.log(`  Total messages:   ${messageCount}`);
    console.log(`    User:           ${userMessages}`);
    console.log(`    Assistant:      ${assistantMessages}`);
    console.log(`    Tool results:   ${toolMessages}`);
    console.log();

    if (usagePercent > 80) {
      console.log(chalk.yellow('  ⚠️  Context is getting full. Consider using /compact.\n'));
    }
  }

  private showCost(): void {
    // Rough cost estimation based on token usage
    const inputCostPer1M = 3.00;  // $3 per 1M input tokens (estimated)
    const outputCostPer1M = 15.00; // $15 per 1M output tokens (estimated)

    const inputCost = (this.tokenUsage.promptTokens / 1000000) * inputCostPer1M;
    const outputCost = (this.tokenUsage.completionTokens / 1000000) * outputCostPer1M;
    const totalCost = inputCost + outputCost;

    console.log(chalk.cyan('\n💰 Token Usage & Cost (Estimated)\n'));
    console.log(`  Input tokens:    ${this.tokenUsage.promptTokens.toLocaleString()}`);
    console.log(`  Output tokens:   ${this.tokenUsage.completionTokens.toLocaleString()}`);
    console.log(`  Total tokens:    ${this.tokenUsage.totalTokens.toLocaleString()}`);
    console.log();
    console.log(`  Estimated cost:  $${totalCost.toFixed(4)}`);
    console.log(chalk.gray('\n  Note: Actual costs may vary. Check xAI pricing.\n'));
  }

  private showUsage(): void {
    console.log(chalk.cyan('\n📊 Usage Statistics\n'));
    console.log(`  Session tokens:  ${this.tokenUsage.totalTokens.toLocaleString()}`);
    console.log(`  Messages sent:   ${this.messages.filter(m => m.role === 'user').length}`);
    console.log(`  Tool calls:      ${this.messages.filter(m => m.role === 'tool').length}`);
    console.log();
    console.log(chalk.gray('  For billing info, visit: https://console.x.ai/\n'));
  }

  private async runDoctor(): Promise<void> {
    console.log(chalk.cyan('\n🩺 Running diagnostics...\n'));

    const checks: { name: string; status: 'ok' | 'warn' | 'fail'; message: string }[] = [];

    // Check API key
    const apiKey = await this.config.getApiKey();
    if (apiKey) {
      checks.push({ name: 'API Key', status: 'ok', message: 'API key is configured' });
    } else {
      checks.push({ name: 'API Key', status: 'fail', message: 'No API key found. Run `grok auth`' });
    }

    // Check Node version
    const nodeVersion = process.version;
    const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0]);
    if (majorVersion >= 18) {
      checks.push({ name: 'Node.js', status: 'ok', message: `${nodeVersion} (>=18 required)` });
    } else {
      checks.push({ name: 'Node.js', status: 'fail', message: `${nodeVersion} - upgrade to >=18` });
    }

    // Check working directory
    try {
      await fs.access(process.cwd(), fs.constants.R_OK | fs.constants.W_OK);
      checks.push({ name: 'Working Dir', status: 'ok', message: 'Read/write access confirmed' });
    } catch {
      checks.push({ name: 'Working Dir', status: 'warn', message: 'Limited access to working directory' });
    }

    // Check config directory
    const configDir = path.join(os.homedir(), '.config', 'grokcodecli');
    try {
      await fs.access(configDir);
      checks.push({ name: 'Config Dir', status: 'ok', message: configDir });
    } catch {
      checks.push({ name: 'Config Dir', status: 'warn', message: 'Will be created on first use' });
    }

    // Check git
    try {
      const { execSync } = await import('child_process');
      execSync('git --version', { stdio: 'pipe' });
      checks.push({ name: 'Git', status: 'ok', message: 'Git is available' });
    } catch {
      checks.push({ name: 'Git', status: 'warn', message: 'Git not found (optional)' });
    }

    // Test API connection
    if (apiKey) {
      try {
        const response = await fetch('https://api.x.ai/v1/models', {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        if (response.ok) {
          checks.push({ name: 'API Connection', status: 'ok', message: 'Connected to xAI API' });
        } else {
          checks.push({ name: 'API Connection', status: 'fail', message: `API error: ${response.status}` });
        }
      } catch (error) {
        checks.push({ name: 'API Connection', status: 'fail', message: 'Cannot reach xAI API' });
      }
    }

    // Display results
    for (const check of checks) {
      const icon = check.status === 'ok' ? chalk.white('✓') :
                   check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
      const name = check.status === 'ok' ? chalk.white(check.name) :
                   check.status === 'warn' ? chalk.yellow(check.name) : chalk.red(check.name);
      console.log(`  ${icon} ${name.padEnd(20)} ${chalk.gray(check.message)}`);
    }

    const failures = checks.filter(c => c.status === 'fail').length;
    const warnings = checks.filter(c => c.status === 'warn').length;

    console.log();
    if (failures > 0) {
      console.log(chalk.red(`  ${failures} issue(s) found. Please fix before using.\n`));
    } else if (warnings > 0) {
      console.log(chalk.yellow(`  ${warnings} warning(s). Grok Code should work fine.\n`));
    } else {
      console.log(chalk.white('  All checks passed! Grok Code is ready.\n'));
    }
  }

  private handleAddDir(dirPath: string): void {
    if (!dirPath) {
      console.log(chalk.yellow('Usage: /add-dir <path>\n'));
      return;
    }

    const resolved = path.resolve(dirPath);

    if (this.workingDirs.includes(resolved)) {
      console.log(chalk.yellow(`Directory already added: ${resolved}\n`));
      return;
    }

    this.workingDirs.push(resolved);
    console.log(chalk.white(`Added working directory: ${resolved}\n`));
  }

  private async showHistory(): Promise<void> {
    const sessions = await this.history.listSessions(10);

    if (sessions.length === 0) {
      console.log(chalk.dim('  No saved sessions.\n'));
      return;
    }

    const options: SelectorOption[] = sessions.map(s => {
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
      const session = sessions.find(s => s.id === selected);
      if (session) {
        this.session = session;
        this.messages = session.messages;
        console.log(chalk.dim(`  ✓ Switched to: ${session.title}\n`));
      }
    }
  }

  private async handleInit(): Promise<void> {
    const grokMdPath = path.join(process.cwd(), 'GROK.md');

    try {
      await fs.access(grokMdPath);
      console.log(chalk.yellow('GROK.md already exists in this project.\n'));
      console.log(chalk.gray('Edit it directly or delete it to re-initialize.\n'));
      return;
    } catch {
      // File doesn't exist, create it
    }

    const template = `# Project Guide for Grok

## Project Overview
<!-- Describe what this project does -->

## Tech Stack
<!-- List the main technologies used -->

## Project Structure
<!-- Describe the key directories and files -->

## Development Guidelines
<!-- Any coding standards or practices to follow -->

## Common Commands
\`\`\`bash
# Build the project
npm run build

# Run tests
npm test

# Start development server
npm run dev
\`\`\`

## Notes for Grok
<!-- Any specific instructions for the AI assistant -->
- Always read files before editing
- Run tests after making changes
- Follow existing code patterns
`;

    await fs.writeFile(grokMdPath, template, 'utf-8');
    console.log(chalk.white('✓ Created GROK.md\n'));
    console.log(chalk.gray('Edit this file to help Grok understand your project better.\n'));
    console.log(chalk.cyan('Contents will be automatically included in conversations.\n'));
  }

  private async handleReview(focus?: string): Promise<void> {
    console.log(chalk.cyan('\n🔍 Starting Code Review\n'));

    const reviewPrompt = focus
      ? `Please review the code changes in this project, focusing on: ${focus}

Check for:
1. Code quality and best practices
2. Potential bugs or issues
3. Security vulnerabilities
4. Performance concerns
5. Test coverage gaps

Provide specific, actionable feedback.`
      : `Please review the recent code changes in this project.

Check for:
1. Code quality and best practices
2. Potential bugs or issues
3. Security vulnerabilities
4. Performance concerns
5. Test coverage gaps

Start by checking git status and recent changes, then provide specific, actionable feedback.`;

    // Send as a message to Grok
    await this.processMessage(reviewPrompt);
  }

  private showTerminalSetup(): void {
    console.log(chalk.cyan('\n⌨️  Terminal Setup\n'));

    console.log(chalk.bold('Recommended Key Bindings:\n'));

    console.log('  ' + chalk.white('Shift+Enter') + ' - Insert newline without sending');
    console.log('  ' + chalk.white('Ctrl+C') + '      - Cancel current operation');
    console.log('  ' + chalk.white('Ctrl+D') + '      - Exit (same as typing "exit")');
    console.log('  ' + chalk.white('Up/Down') + '     - Navigate command history');
    console.log();

    console.log(chalk.bold('For Bash/Zsh (add to ~/.bashrc or ~/.zshrc):\n'));
    console.log(chalk.gray('  # Grok Code CLI alias'));
    console.log(chalk.cyan('  alias g="grok"'));
    console.log(chalk.cyan('  alias gr="grok --resume"'));
    console.log();

    console.log(chalk.bold('For Fish (add to ~/.config/fish/config.fish):\n'));
    console.log(chalk.gray('  # Grok Code CLI alias'));
    console.log(chalk.cyan('  alias g "grok"'));
    console.log(chalk.cyan('  alias gr "grok --resume"'));
    console.log();

    console.log(chalk.bold('VS Code Integration:\n'));
    console.log('  Add to settings.json:');
    console.log(chalk.gray('  "terminal.integrated.env.linux": {'));
    console.log(chalk.gray('    "XAI_API_KEY": "your-api-key"'));
    console.log(chalk.gray('  }'));
    console.log();

    console.log(chalk.gray('Tip: Run `grok auth` to save your API key permanently.\n'));
  }

  private showHelp(): void {
    console.log();
    console.log(chalk.cyan('╭──────────────────────────────────────────────────────────────────────╮'));
    console.log(chalk.cyan('│') + chalk.bold.cyan('  📚 Grok Code CLI - Command Reference                                 ') + chalk.cyan('│'));
    console.log(chalk.cyan('╰──────────────────────────────────────────────────────────────────────╯'));
    console.log();

    console.log(chalk.bold.cyan('  Session Management'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
    console.log(`  ${chalk.cyan('/clear')}              Clear conversation and start fresh`);
    console.log(`  ${chalk.cyan('/save')}, ${chalk.cyan('/s')}           Save current conversation`);
    console.log(`  ${chalk.cyan('/history')}            Show saved conversations`);
    console.log(`  ${chalk.cyan('/resume')} ${chalk.gray('[id]')}        Resume a previous conversation`);
    console.log(`  ${chalk.cyan('/rename')} ${chalk.gray('<name>')}      Rename current session`);
    console.log(`  ${chalk.cyan('/export')} ${chalk.gray('[file]')}      Export conversation to file`);
    console.log(`  ${chalk.cyan('/compact')} ${chalk.gray('[focus]')}    Reduce context size`);
    console.log(`  ${chalk.cyan('/exit')}, ${chalk.cyan('/q')}           Save and quit`);
    console.log();

    console.log(chalk.bold.cyan('  Configuration'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
    console.log(`  ${chalk.cyan('/config')}             Show current configuration`);
    console.log(`  ${chalk.cyan('/model')} ${chalk.gray('[name]')}       Show or change the AI model`);
    console.log(`  ${chalk.cyan('/stream')}             Toggle streaming mode`);
    console.log(`  ${chalk.cyan('/permissions')}        View permission settings`);
    console.log();

    console.log(chalk.bold.cyan('  Status & Diagnostics'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
    console.log(`  ${chalk.cyan('/status')}             Show session status and info`);
    console.log(`  ${chalk.cyan('/context')}            Visualize context usage`);
    console.log(`  ${chalk.cyan('/cost')}               Show token usage and estimated cost`);
    console.log(`  ${chalk.cyan('/doctor')}             Run diagnostics check`);
    console.log(`  ${chalk.cyan('/version')}            Show version`);
    console.log();

    console.log(chalk.bold.cyan('  Project Setup'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
    console.log(`  ${chalk.cyan('/init')}               Initialize project with GROK.md`);
    console.log(`  ${chalk.cyan('/review')} ${chalk.gray('[focus]')}     Request AI code review`);
    console.log(`  ${chalk.cyan('/terminal-setup')}     Show terminal tips`);
    console.log();

    console.log(chalk.bold.cyan('  Available Tools'));
    console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
    console.log(`  ${chalk.white('📖 Read')}       Read file contents with line numbers`);
    console.log(`  ${chalk.yellow('✏️  Write')}      Create or overwrite files`);
    console.log(`  ${chalk.yellow('🔧 Edit')}       Edit files by string replacement`);
    console.log(`  ${chalk.red('⚡ Bash')}       Execute shell commands`);
    console.log(`  ${chalk.white('🔍 Glob')}       Find files by pattern`);
    console.log(`  ${chalk.white('🔎 Grep')}       Search file contents with regex`);
    console.log(`  ${chalk.white('🌐 WebFetch')}   Fetch and parse web content`);
    console.log(`  ${chalk.white('🔍 WebSearch')}  Search the web for information`);
    console.log();

    console.log(chalk.bold('Permission Responses:'));
    console.log('  [y] Allow once       [a] Allow for session');
    console.log('  [n] Deny             [!] Block for session');
    console.log();
  }

  // === Core Processing ===

  private async processMessage(input: string): Promise<void> {
    this.messages.push({
      role: 'user',
      content: input,
    });

    try {
      if (this.useStreaming) {
        await this.getStreamingResponse();
      } else {
        await this.getResponse();
      }
      await this.saveSession();
    } catch (error) {
      const err = error as Error;
      console.log(chalk.red(`\nError: ${err.message}\n`));
    }
  }

  private async getResponse(): Promise<void> {
    console.log(chalk.blue('\nGrok: ') + chalk.gray('thinking...'));

    const response = await this.client.chat(this.messages, allTools);
    const choice = response.choices[0];
    const message = choice.message;

    // Update token usage
    if (response.usage) {
      this.tokenUsage.promptTokens += response.usage.prompt_tokens;
      this.tokenUsage.completionTokens += response.usage.completion_tokens;
      this.tokenUsage.totalTokens += response.usage.total_tokens;
    }

    this.messages.push(message);

    if (message.tool_calls && message.tool_calls.length > 0) {
      if (message.content) {
        this.printMarkdown(message.content);
      }

      for (const toolCall of message.tool_calls) {
        await this.executeToolCall(toolCall);
      }

      await this.getResponse();
    } else {
      if (message.content) {
        process.stdout.write('\x1b[1A\x1b[2K');
        console.log(chalk.blue('Grok: '));
        this.printMarkdown(message.content);
        console.log();
      }
    }
  }

  private async getStreamingResponse(): Promise<void> {
    const isReasoning = this.client.model.includes('reasoning') && !this.client.model.includes('non-reasoning');

    if (isReasoning) {
      process.stdout.write('\n' + chalk.dim('  Thinking...'));
    }

    // Set up abort controller for Esc key
    this.abortController = new AbortController();
    let aborted = false;

    // Listen for Esc key to stop streaming
    const onKeypress = (key: Buffer) => {
      // Esc key is \x1b (27)
      if (key[0] === 27 && key.length === 1) {
        aborted = true;
        this.abortController?.abort();
        process.stdout.write(chalk.dim('\n  Stopped.\n'));
      }
    };

    // Enable raw mode to capture keypress
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.on('data', onKeypress);
    }

    let fullContent = '';
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;
    let firstChunk = true;

    try {
      for await (const chunk of this.client.chatStream(this.messages, allTools, { signal: this.abortController.signal })) {
        if (aborted) break;

        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
          if (firstChunk) {
            if (isReasoning) {
              process.stdout.write('\r' + ' '.repeat(20) + '\r');
            }
            console.log();
            firstChunk = false;
          }
          process.stdout.write(delta.content);
          fullContent += delta.content;
        }

        // Handle streaming tool calls
        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            if (tc.id) {
              // New tool call
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
              // Append to current tool call arguments
              currentToolCall.function!.arguments += tc.function.arguments;
            }
          }
        }
      }

      // Push last tool call if exists
      if (currentToolCall && currentToolCall.id) {
        toolCalls.push(currentToolCall as ToolCall);
      }

      // End response
      if (fullContent && !aborted) {
        console.log('\n');
      } else if (toolCalls.length > 0 && firstChunk) {
        process.stdout.write('\r' + ' '.repeat(20) + '\r');
      }

      // Build the message for history
      const message: GrokMessage = {
        role: 'assistant',
        content: fullContent,
      };

      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      this.messages.push(message);

      // Execute tool calls (if not aborted)
      if (toolCalls.length > 0 && !aborted) {
        for (const toolCall of toolCalls) {
          await this.executeToolCall(toolCall);
        }
        await this.getStreamingResponse();
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Ignore abort errors
      } else {
        console.log();
        throw error;
      }
    } finally {
      // Clean up keypress listener
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
        process.stdin.removeListener('data', onKeypress);
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
      console.log(chalk.red(`\n⚠️ Invalid arguments for ${name}`));
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'Error: Invalid JSON arguments',
      });
      return;
    }

    // Request permission
    const riskLevel = this.permissions.getToolRiskLevel(name);
    const description = this.permissions.formatToolDetails(name, params);

    const approved = await this.permissions.requestPermission({
      tool: name,
      description,
      riskLevel,
      details: params,
    });

    if (!approved) {
      this.messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: 'Error: Permission denied by user',
      });
      return;
    }

    // Simple tool display like Claude Code
    let toolInfo = '';
    if (name === 'Bash') {
      toolInfo = chalk.dim('$ ') + (params.command as string).slice(0, 60);
    } else if (name === 'Read') {
      toolInfo = params.file_path as string;
    } else if (name === 'Write') {
      toolInfo = params.file_path as string;
    } else if (name === 'Edit') {
      toolInfo = params.file_path as string;
    } else if (name === 'Glob') {
      toolInfo = params.pattern as string;
    } else if (name === 'Grep') {
      toolInfo = params.pattern as string;
    } else if (name === 'WebFetch') {
      toolInfo = (params.url as string).slice(0, 50);
    } else if (name === 'WebSearch') {
      toolInfo = params.query as string;
    }

    console.log(chalk.dim('  ● ') + chalk.cyan(name) + chalk.dim(' ' + toolInfo));

    // Execute
    const result = await executeTool(name, params);

    if (!result.success) {
      console.log(chalk.red('    ✗ ') + chalk.red(result.error || 'Failed'));
    }

    this.messages.push({
      role: 'tool',
      tool_call_id: toolCall.id,
      content: result.success ? result.output : `Error: ${result.error}`,
    });
  }

  private async saveSession(): Promise<void> {
    if (this.session) {
      this.session.messages = this.messages;
      await this.history.saveSession(this.session);
    }
  }

  private printMarkdown(content: string): void {
    const formatted = content
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return chalk.gray(`─── ${lang || 'code'} ───\n`) + chalk.cyan(code.trim()) + chalk.gray('\n───────────');
      })
      .replace(/`([^`]+)`/g, chalk.cyan('$1'));
    console.log(formatted);
  }
}
