import * as readline from 'readline';
import chalk from 'chalk';
import { GrokClient, GrokMessage, ToolCall } from '../grok/client.js';
import { allTools, executeTool } from '../tools/registry.js';
import { PermissionManager } from '../permissions/manager.js';
import { HistoryManager, ConversationSession } from './history.js';

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

export interface ChatOptions {
  apiKey: string;
  model?: string;
  resume?: boolean;
  sessionId?: string;
}

export class GrokChat {
  private client: GrokClient;
  private messages: GrokMessage[] = [];
  private rl: readline.Interface;
  private permissions: PermissionManager;
  private history: HistoryManager;
  private session: ConversationSession | null = null;
  private useStreaming: boolean = true;

  constructor(options: ChatOptions) {
    this.client = new GrokClient(options.apiKey, options.model || 'grok-3');
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    this.permissions = new PermissionManager();
    this.permissions.setReadlineInterface(this.rl);
    this.history = new HistoryManager();
  }

  async start(): Promise<void> {
    console.log(chalk.cyan('\n🚀 Grok Code CLI'));
    console.log(chalk.gray(`Model: ${this.client.model}`));
    console.log(chalk.gray(`Working directory: ${process.cwd()}`));
    console.log(chalk.gray('Type /help for commands, "exit" to quit.\n'));

    // Create new session
    this.session = await this.history.createSession(process.cwd());

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
        await this.handleCommand(trimmed);
        continue;
      }

      await this.processMessage(trimmed);
    }
  }

  private async handleCommand(command: string): Promise<void> {
    const [cmd, ...args] = command.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'clear':
        this.messages = [this.messages[0]]; // Keep system prompt
        this.session = await this.history.createSession(process.cwd());
        console.log(chalk.gray('Conversation cleared.\n'));
        break;

      case 'help':
        this.showHelp();
        break;

      case 'history':
        await this.showHistory();
        break;

      case 'save':
        await this.saveSession();
        console.log(chalk.green('Session saved.\n'));
        break;

      case 'compact':
        this.compactHistory();
        console.log(chalk.gray('Conversation compacted.\n'));
        break;

      case 'stream':
        this.useStreaming = !this.useStreaming;
        console.log(chalk.gray(`Streaming ${this.useStreaming ? 'enabled' : 'disabled'}.\n`));
        break;

      default:
        console.log(chalk.yellow(`Unknown command: /${cmd}\n`));
    }
  }

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

  private compactHistory(): void {
    // Keep system prompt and last N messages
    const keepCount = 20;
    if (this.messages.length > keepCount + 1) {
      const systemPrompt = this.messages[0];
      const recentMessages = this.messages.slice(-keepCount);
      this.messages = [systemPrompt, ...recentMessages];
    }
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
      console.log(`  ${chalk.gray(session.id.slice(0, 8))}  ${session.title}`);
      console.log(`           ${chalk.gray(`${date} ${time} • ${session.messages.length} messages`)}`);
    }
    console.log(chalk.gray('\nUse `grok --resume <id>` to continue a conversation.\n'));
  }

  private printMarkdown(content: string): void {
    const formatted = content
      .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
        return chalk.gray(`─── ${lang || 'code'} ───\n`) + chalk.cyan(code.trim()) + chalk.gray('\n───────────');
      })
      .replace(/`([^`]+)`/g, chalk.cyan('$1'));
    console.log(formatted);
  }

  private showHelp(): void {
    console.log(chalk.cyan('\n📚 Grok Code Help\n'));
    console.log(chalk.bold('Commands:'));
    console.log('  /clear    Clear conversation and start fresh');
    console.log('  /history  Show saved conversations');
    console.log('  /save     Save current conversation');
    console.log('  /compact  Reduce conversation size (keeps last 20 messages)');
    console.log('  /stream   Toggle streaming mode');
    console.log('  /help     Show this help');
    console.log('  exit      Quit (conversation is auto-saved)');
    console.log();
    console.log(chalk.bold('Tools:'));
    console.log('  Read      Read file contents');
    console.log('  Write     Write to files');
    console.log('  Edit      Edit files (string replacement)');
    console.log('  Bash      Run shell commands');
    console.log('  Glob      Find files by pattern');
    console.log('  Grep      Search in files');
    console.log('  WebFetch  Fetch web content');
    console.log();
    console.log(chalk.bold('Permission Prompts:'));
    console.log('  [y] Allow once');
    console.log('  [a] Allow for session');
    console.log('  [n] Deny');
    console.log('  [!] Block for session');
    console.log();
  }
}
