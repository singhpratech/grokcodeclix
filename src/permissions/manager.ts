import * as readline from 'readline';
import chalk from 'chalk';
import { interactiveSelect, SelectorOption } from '../utils/selector.js';

// Tiranga saffron accent color (matches chat.ts SAFFRON).
const SAFFRON = chalk.hex('#FF9933');

export type ToolRiskLevel = 'read' | 'write' | 'execute';

export interface PermissionRequest {
  tool: string;
  description: string;
  riskLevel: ToolRiskLevel;
  details?: Record<string, unknown>;
}

export interface PermissionConfig {
  autoApprove: string[];  // Tools to auto-approve
  alwaysDeny: string[];   // Tools to always deny
  sessionApproved: Set<string>;  // Approved for this session
}

const TOOL_RISK_LEVELS: Record<string, ToolRiskLevel> = {
  Read: 'read',
  Glob: 'read',
  Grep: 'read',
  WebFetch: 'read',
  WebSearch: 'read',
  BashOutput: 'read',
  TodoWrite: 'read',
  Write: 'write',
  Edit: 'write',
  MultiEdit: 'write',
  Bash: 'execute',
  KillBash: 'execute',
  GenerateImage: 'write',
  TranscribeAudio: 'read',
  SpeakText: 'write',
};

const RISK_COLORS = {
  read: chalk.white,
  write: chalk.yellow,
  execute: chalk.red,
};

const RISK_ICONS = {
  read: '📖',
  write: '✏️',
  execute: '⚡',
};

export class PermissionManager {
  private config: PermissionConfig;
  private rl: readline.Interface | null = null;
  private yolo: boolean = false;

  constructor(autoApprove: string[] = []) {
    this.config = {
      autoApprove,
      alwaysDeny: [],
      sessionApproved: new Set(),
    };
  }

  setReadlineInterface(rl: readline.Interface): void {
    this.rl = rl;
  }

  /** Bypass all permission prompts. Used for non-interactive runs (-y flag). */
  setYolo(on: boolean): void {
    this.yolo = on;
  }

  async requestPermission(request: PermissionRequest): Promise<boolean> {
    const { tool, description, riskLevel, details } = request;

    // Yolo mode: bypass everything (non-interactive runs)
    if (this.yolo) {
      return true;
    }

    // Check if always denied
    if (this.config.alwaysDeny.includes(tool)) {
      console.log(chalk.red(`\n⛔ Tool "${tool}" is blocked by configuration.\n`));
      return false;
    }

    // Check if auto-approved
    if (this.config.autoApprove.includes(tool) || this.config.autoApprove.includes('*')) {
      return true;
    }

    // Check if approved for this session
    const sessionKey = this.getSessionKey(tool, details);
    if (this.config.sessionApproved.has(sessionKey)) {
      return true;
    }

    // Read-only operations can be auto-approved with lower risk
    if (riskLevel === 'read' && this.config.autoApprove.includes('read')) {
      return true;
    }

    // Prompt user for permission
    return this.promptUser(request);
  }

  private async promptUser(request: PermissionRequest): Promise<boolean> {
    const { tool, details } = request;

    // Claude Code-style permission block:
    //
    //   ● Tool(args)
    //
    //   Do you want to proceed?
    //   ❯ 1. Yes
    //     2. Yes, and don't ask again for this tool
    //     3. No, and tell me what to do differently (esc)
    //
    const invocation = this.formatInvocationForPrompt(tool, details || {});
    const question = this.questionForTool(tool);

    console.log();
    console.log(SAFFRON('⏺ ') + chalk.bold(tool) + chalk.dim('(') + chalk.white(invocation) + chalk.dim(')'));
    console.log();
    console.log('  ' + chalk.bold(question));

    const options: SelectorOption[] = [
      { label: '1. Yes', value: 'once' },
      { label: `2. Yes, and don't ask again this session`, value: 'session' },
      { label: '3. No, and tell Grok what to do differently', value: 'deny', description: 'esc' },
    ];

    const choice = await interactiveSelect('', options);

    switch (choice) {
      case 'once':
        return true;
      case 'session':
        this.config.sessionApproved.add(this.getSessionKey(tool, details));
        return true;
      case 'deny':
      case null:
        return false;
      default:
        return false;
    }
  }

  private formatInvocationForPrompt(tool: string, params: Record<string, unknown>): string {
    const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
    switch (tool) {
      case 'Read':
      case 'Write':
      case 'Edit':
      case 'MultiEdit':
        return truncate(String(params.file_path || ''), 70);
      case 'Bash':
        return truncate(String(params.command || ''), 70);
      case 'BashOutput':
      case 'KillBash':
        return truncate(String(params.bash_id || ''), 70);
      case 'TodoWrite':
        return `${(params.todos as unknown[] | undefined)?.length ?? 0} item(s)`;
      case 'GenerateImage':
        return truncate(String(params.prompt || ''), 70);
      case 'TranscribeAudio':
        return truncate(String(params.audio_path || ''), 70);
      case 'SpeakText':
        return truncate(String(params.text || ''), 70);
      case 'Glob':
        return truncate(String(params.pattern || ''), 70);
      case 'Grep':
        return truncate(String(params.pattern || ''), 70);
      case 'WebFetch':
        return truncate(String(params.url || ''), 70);
      case 'WebSearch':
        return truncate(String(params.query || ''), 70);
      default:
        return truncate(JSON.stringify(params), 70);
    }
  }

  private questionForTool(tool: string): string {
    switch (tool) {
      case 'Read':
      case 'Glob':
      case 'Grep':
      case 'WebFetch':
      case 'WebSearch':
      case 'BashOutput':
      case 'TodoWrite':
        return 'Do you want to proceed?';
      case 'Write':
        return 'Do you want to create/overwrite this file?';
      case 'Edit':
      case 'MultiEdit':
        return 'Do you want to make this edit?';
      case 'Bash':
        return 'Do you want to run this command?';
      case 'KillBash':
        return 'Do you want to kill this background process?';
      default:
        return 'Do you want to proceed?';
    }
  }

  private getSessionKey(tool: string, details?: Record<string, unknown>): string {
    // For some tools, scope approval to specific paths/commands
    if (tool === 'Bash' && details?.command) {
      // Approve specific command patterns
      const cmd = String(details.command);
      if (cmd.startsWith('git ')) return `${tool}:git`;
      if (cmd.startsWith('npm ')) return `${tool}:npm`;
      if (cmd.startsWith('ls ') || cmd === 'ls') return `${tool}:ls`;
      return tool;
    }

    if ((tool === 'Read' || tool === 'Write' || tool === 'Edit') && details?.file_path) {
      // Could scope to directory
      return tool;
    }

    return tool;
  }

  private question(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      if (this.rl) {
        this.rl.question(prompt, resolve);
      } else {
        // Fallback if no readline interface
        const tempRl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        tempRl.question(prompt, (answer) => {
          tempRl.close();
          resolve(answer);
        });
      }
    });
  }

  getToolRiskLevel(tool: string): ToolRiskLevel {
    return TOOL_RISK_LEVELS[tool] || 'execute';
  }

  formatToolDetails(tool: string, params: Record<string, unknown>): string {
    switch (tool) {
      case 'Read':
        return `Read file: ${params.file_path}`;
      case 'Write':
        return `Write to file: ${params.file_path}`;
      case 'Edit':
        return `Edit file: ${params.file_path}`;
      case 'Bash':
        return `Execute command: ${params.command}`;
      case 'Glob':
        return `Search for files: ${params.pattern}`;
      case 'Grep':
        return `Search in files: ${params.pattern}`;
      case 'WebFetch':
        return `Fetch URL: ${params.url}`;
      case 'WebSearch':
        return `Search web: ${params.query}`;
      default:
        return `Execute ${tool}`;
    }
  }
}
