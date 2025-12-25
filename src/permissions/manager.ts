import * as readline from 'readline';
import chalk from 'chalk';

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

    console.log(chalk.cyan('\n┌─────────────────────────────────────────────────────┐'));
    console.log(chalk.cyan('│') + ` ${icon} ${color(`Permission Request: ${tool}`)}`.padEnd(60) + chalk.cyan('│'));
    console.log(chalk.cyan('├─────────────────────────────────────────────────────┤'));
    console.log(chalk.cyan('│') + ` ${description}`.padEnd(52) + chalk.cyan('│'));

    // Show details
    if (details) {
      console.log(chalk.cyan('├─────────────────────────────────────────────────────┤'));
      for (const [key, value] of Object.entries(details)) {
        const valueStr = typeof value === 'string'
          ? value.length > 45 ? value.slice(0, 42) + '...' : value
          : String(value);
        console.log(chalk.cyan('│') + chalk.gray(` ${key}: `) + valueStr.padEnd(42 - key.length) + chalk.cyan('│'));
      }
    }

    console.log(chalk.cyan('└─────────────────────────────────────────────────────┘'));
    console.log();
    console.log(`  ${chalk.white('[y]')} Yes, allow once`);
    console.log(`  ${chalk.white('[a]')} Allow for this session`);
    console.log(`  ${chalk.red('[n]')} No, deny`);
    console.log(`  ${chalk.red('[!]')} Deny and block for session`);
    console.log();

    const answer = await this.question(chalk.cyan('Choice [y/a/n/!]: '));
    const choice = answer.toLowerCase().trim();

    switch (choice) {
      case 'y':
      case 'yes':
        return true;

      case 'a':
      case 'always':
        this.config.sessionApproved.add(this.getSessionKey(tool, details));
        console.log(chalk.white(`✓ "${tool}" approved for this session.\n`));
        return true;

      case 'n':
      case 'no':
      case '':
        console.log(chalk.yellow('⊘ Denied.\n'));
        return false;

      case '!':
      case 'block':
        this.config.alwaysDeny.push(tool);
        console.log(chalk.red(`⛔ "${tool}" blocked for this session.\n`));
        return false;

      default:
        console.log(chalk.gray('Invalid choice, defaulting to deny.\n'));
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
