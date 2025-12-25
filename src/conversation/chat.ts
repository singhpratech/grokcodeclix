import * as readline from 'readline';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';
import { GrokClient, GrokMessage, ToolCall } from '../grok/client.js';
import { allTools, executeTool } from '../tools/registry.js';
import { PermissionManager } from '../permissions/manager.js';
import { HistoryManager, ConversationSession } from './history.js';
import { ConfigManager } from '../config/manager.js';

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

const VERSION = '0.1.0';

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

  constructor(options: ChatOptions) {
    this.apiKey = options.apiKey;
    this.client = new GrokClient(options.apiKey, options.model || 'grok-3');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.permissions = new PermissionManager();
    this.permissions.setReadlineInterface(this.rl);
    this.history = new HistoryManager();
    this.config = new ConfigManager();
  }

  async start(): Promise<void> {
    console.log(chalk.cyan('\n🚀 Grok Code CLI'));
    console.log(chalk.gray(`Model: ${this.client.model}`));
    console.log(chalk.gray(`Working directory: ${process.cwd()}`));
    console.log(chalk.gray('Type /help for commands, "exit" to quit.\n'));

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
          console.log(chalk.green('You: ') + chalk.gray(msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')));
        } else if (msg.role === 'assistant' && msg.content) {
          console.log(chalk.blue('Grok: ') + chalk.gray(msg.content.slice(0, 100) + (msg.content.length > 100 ? '...' : '')));
        }
      }
      console.log(chalk.gray('──────────────────────\n'));
    }

    await this.loop();
  }

  private async loop(): Promise<void> {
    const prompt = chalk.green('You: ');

    const question = (): Promise<string> => {
      return new Promise((resolve) => {
        this.rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    };

    while (true) {
      const input = await question();
      const trimmed = input.trim();

      if (!trimmed) continue;

      // Handle commands
      if (trimmed.toLowerCase() === 'exit' || trimmed.toLowerCase() === 'quit') {
        await this.saveSession();
        console.log(chalk.gray('\nSession saved. Goodbye!\n'));
        this.rl.close();
        break;
      }

      if (trimmed.startsWith('/')) {
        const shouldExit = await this.handleCommand(trimmed);
        if (shouldExit) {
          this.rl.close();
          break;
        }
        continue;
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
        console.log(chalk.green('Session saved.\n'));
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
          console.log(`  ${i === 0 ? chalk.green('→') : ' '} ${dir}`);
        });
        console.log();
        break;

      // Help
      case 'help':
        this.showHelp();
        break;

      case 'version':
        console.log(chalk.cyan(`\nGrok Code CLI v${VERSION}\n`));
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
        console.log(chalk.green('Session saved.\n'));
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
    if (!sessionId) {
      const sessions = await this.history.listSessions(5);
      if (sessions.length === 0) {
        console.log(chalk.yellow('No sessions to resume.\n'));
        return;
      }

      console.log(chalk.cyan('\nRecent sessions:\n'));
      sessions.forEach((s) => {
        console.log(`  ${chalk.gray(s.id.slice(0, 8))}  ${s.title}`);
      });
      console.log(chalk.gray('\nUse /resume <session-id> to resume.\n'));
      return;
    }

    const session = await this.history.loadSession(sessionId);
    if (!session) {
      // Try partial match
      const sessions = await this.history.listSessions(50);
      const match = sessions.find(s => s.id.startsWith(sessionId));
      if (match) {
        this.session = match;
        this.messages = match.messages;
        console.log(chalk.green(`Resumed session: ${match.title}\n`));
        return;
      }
      console.log(chalk.red(`Session not found: ${sessionId}\n`));
      return;
    }

    this.session = session;
    this.messages = session.messages;
    console.log(chalk.green(`Resumed session: ${session.title}\n`));
  }

  private async handleRename(name: string): Promise<void> {
    if (!name) {
      console.log(chalk.yellow('Usage: /rename <new-name>\n'));
      return;
    }

    if (this.session) {
      this.session.title = name;
      await this.saveSession();
      console.log(chalk.green(`Session renamed to: ${name}\n`));
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
      console.log(chalk.green(`Conversation exported to: ${filePath}\n`));
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
    console.log(`  API Key:     ${apiKey ? chalk.green('✓ Set') : chalk.red('✗ Not set')}`);
    console.log(`  Model:       ${this.client.model}`);
    console.log(`  Streaming:   ${this.useStreaming ? chalk.green('enabled') : chalk.gray('disabled')}`);
    console.log(`  Temperature: ${this.config.get('temperature')}`);
    console.log(`  Max Tokens:  ${this.config.get('maxTokens')}`);
    console.log(`  Auto-approve: ${(this.config.get('autoApprove') as string[]).join(', ') || 'none'}`);
    console.log();
    console.log(chalk.gray(`  Config file: ~/.config/grokcodecli/config.json`));
    console.log(chalk.gray('  Run `grok config` in terminal to modify.\n'));
  }

  private async handleModel(modelName?: string): Promise<void> {
    const availableModels = ['grok-3', 'grok-2', 'grok-1'];

    if (!modelName) {
      console.log(chalk.cyan('\n🤖 Model Selection\n'));
      console.log(`  Current: ${chalk.green(this.client.model)}\n`);
      console.log('  Available models:');
      availableModels.forEach(m => {
        const current = m === this.client.model ? chalk.green(' (current)') : '';
        const recommended = m === 'grok-3' ? chalk.gray(' - recommended') : '';
        console.log(`    • ${m}${current}${recommended}`);
      });
      console.log(chalk.gray('\n  Use /model <name> to switch.\n'));
      return;
    }

    if (!availableModels.includes(modelName)) {
      console.log(chalk.red(`Unknown model: ${modelName}`));
      console.log(chalk.gray(`Available: ${availableModels.join(', ')}\n`));
      return;
    }

    this.client = new GrokClient(this.apiKey, modelName);
    console.log(chalk.green(`Switched to model: ${modelName}\n`));
  }

  private handlePermissions(): void {
    console.log(chalk.cyan('\n🔐 Permission Settings\n'));
    console.log('  Tool Risk Levels:');
    console.log(`    ${chalk.green('📖 Read')}    - Read, Glob, Grep, WebFetch`);
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
    const bar = chalk.green('█'.repeat(filledWidth)) + chalk.gray('░'.repeat(emptyWidth));

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
      const icon = check.status === 'ok' ? chalk.green('✓') :
                   check.status === 'warn' ? chalk.yellow('⚠') : chalk.red('✗');
      const name = check.status === 'ok' ? chalk.green(check.name) :
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
      console.log(chalk.green('  All checks passed! Grok Code is ready.\n'));
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
    console.log(chalk.green(`Added working directory: ${resolved}\n`));
  }

  private async showHistory(): Promise<void> {
    const sessions = await this.history.listSessions(10);

    if (sessions.length === 0) {
      console.log(chalk.gray('No saved conversations.\n'));
      return;
    }

    console.log(chalk.cyan('\n📚 Recent Conversations\n'));
    for (const session of sessions) {
      const date = new Date(session.updatedAt).toLocaleDateString();
      const time = new Date(session.updatedAt).toLocaleTimeString();
      const isCurrent = session.id === this.session?.id;
      const marker = isCurrent ? chalk.green(' ← current') : '';
      console.log(`  ${chalk.gray(session.id.slice(0, 8))}  ${session.title}${marker}`);
      console.log(`           ${chalk.gray(`${date} ${time} • ${session.messages.length} messages`)}`);
    }
    console.log(chalk.gray('\nUse /resume <id> to switch sessions.\n'));
  }

  private showHelp(): void {
    console.log(chalk.cyan('\n📚 Grok Code CLI - Command Reference\n'));

    console.log(chalk.bold('Session Management:'));
    console.log('  /clear              Clear conversation and start fresh');
    console.log('  /save, /s           Save current conversation');
    console.log('  /history            Show saved conversations');
    console.log('  /resume [id]        Resume a previous conversation');
    console.log('  /rename <name>      Rename current session');
    console.log('  /export [file]      Export conversation to file');
    console.log('  /compact [focus]    Reduce context size (keep last 20 messages)');
    console.log('  /exit, /q           Save and quit');
    console.log();

    console.log(chalk.bold('Configuration:'));
    console.log('  /config             Show current configuration');
    console.log('  /model [name]       Show or change the AI model');
    console.log('  /stream             Toggle streaming mode');
    console.log('  /permissions        View permission settings');
    console.log();

    console.log(chalk.bold('Status & Info:'));
    console.log('  /status             Show session status and info');
    console.log('  /context            Visualize context usage');
    console.log('  /cost               Show token usage and estimated cost');
    console.log('  /usage              Show usage statistics');
    console.log('  /doctor             Run diagnostics check');
    console.log('  /version            Show version');
    console.log();

    console.log(chalk.bold('Working Directory:'));
    console.log('  /add-dir <path>     Add a working directory');
    console.log('  /pwd                Show working directories');
    console.log();

    console.log(chalk.bold('Quick Aliases:'));
    console.log('  /h                  Show this help');
    console.log('  /c                  Clear conversation');
    console.log('  /s                  Save session');
    console.log('  /q                  Quit');
    console.log('  exit, quit          Quit (same as /exit)');
    console.log();

    console.log(chalk.bold('Available Tools:'));
    console.log('  Read      Read file contents with line numbers');
    console.log('  Write     Create or overwrite files');
    console.log('  Edit      Edit files by string replacement');
    console.log('  Bash      Execute shell commands');
    console.log('  Glob      Find files by pattern');
    console.log('  Grep      Search file contents with regex');
    console.log('  WebFetch  Fetch and parse web content');
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
    process.stdout.write(chalk.blue('\nGrok: '));

    let fullContent = '';
    let toolCalls: ToolCall[] = [];
    let currentToolCall: Partial<ToolCall> | null = null;

    try {
      for await (const chunk of this.client.chatStream(this.messages, allTools)) {
        const delta = chunk.choices[0]?.delta;

        if (delta?.content) {
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

      console.log(); // New line after streaming

      // Build the message for history
      const message: GrokMessage = {
        role: 'assistant',
        content: fullContent,
      };

      if (toolCalls.length > 0) {
        message.tool_calls = toolCalls;
      }

      this.messages.push(message);

      // Execute tool calls
      if (toolCalls.length > 0) {
        for (const toolCall of toolCalls) {
          await this.executeToolCall(toolCall);
        }
        await this.getStreamingResponse();
      }
    } catch (error) {
      console.log();
      throw error;
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

    // Show execution
    console.log(chalk.yellow(`\n📦 ${name}`));
    if (name === 'Bash') {
      console.log(chalk.gray(`$ ${params.command}`));
    } else if (name === 'Read' || name === 'Write' || name === 'Edit') {
      console.log(chalk.gray(`→ ${params.file_path}`));
    } else if (name === 'Glob' || name === 'Grep') {
      console.log(chalk.gray(`→ ${params.pattern}`));
    } else if (name === 'WebFetch') {
      console.log(chalk.gray(`→ ${params.url}`));
    }

    // Execute
    const result = await executeTool(name, params);

    if (result.success) {
      console.log(chalk.green('✓ Success'));
      if (result.output && result.output.length < 500) {
        console.log(chalk.gray(result.output));
      } else if (result.output) {
        console.log(chalk.gray(result.output.slice(0, 500) + '... (truncated)'));
      }
    } else {
      console.log(chalk.red('✗ Failed'));
      console.log(chalk.red(result.error || 'Unknown error'));
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
