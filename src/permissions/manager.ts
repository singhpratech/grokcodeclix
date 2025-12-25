import * as readline from 'readline';
import chalk from 'chalk';
import { interactiveSelect, SelectorOption } from '../utils/selector.js';

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
  Write: 'write',
  Edit: 'write',
  Bash: 'execute',
  WebFetch: 'read',
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

  async requestPermission(request: PermissionRequest): Promise<boolean> {
    const { tool, description, riskLevel, details } = request;

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
    const { tool, description, riskLevel, details } = request;
    const color = RISK_COLORS[riskLevel];
    const icon = RISK_ICONS[riskLevel];

    // Show what's being requested
    console.log();
    console.log(`  ${icon} ${color(tool)} ${chalk.dim('-')} ${description}`);
    if (details) {
      for (const [key, value] of Object.entries(details)) {
        const valueStr = typeof value === 'string'
          ? value.length > 50 ? value.slice(0, 47) + '...' : value
          : String(value);
        console.log(chalk.dim(`     ${key}: ${valueStr}`));
      }
    }
    console.log();

    const options: SelectorOption[] = [
      { label: 'Allow once', value: 'once', description: 'permit this action' },
      { label: 'Allow session', value: 'session', description: 'permit for session' },
      { label: 'Deny', value: 'deny', description: 'reject this action' },
      { label: 'Block', value: 'block', description: 'block tool for session' },
    ];

    const choice = await interactiveSelect('Permission:', options);

    switch (choice) {
      case 'once':
        return true;

      case 'session':
        this.config.sessionApproved.add(this.getSessionKey(tool, details));
        console.log(chalk.dim(`  ✓ ${tool} approved for session`));
        return true;

      case 'deny':
      case null:
        return false;

      case 'block':
        this.config.alwaysDeny.push(tool);
        console.log(chalk.dim(`  ⛔ ${tool} blocked for session`));
        return false;

      default:
        return false;
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
      default:
        return `Execute ${tool}`;
    }
  }
}
