import Conf from 'conf';
import chalk from 'chalk';
import * as readline from 'readline';
import { exec } from 'child_process';
import { platform } from 'os';

interface GrokConfig {
  apiKey?: string;
  model: string;
  temperature: number;
  maxTokens: number;
  autoApprove: string[];
}

const defaults: Omit<GrokConfig, 'apiKey'> = {
  model: 'grok-4-0709',
  temperature: 0.7,
  maxTokens: 16384,
  autoApprove: [],
};

// Open URL in default browser
function openBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const os = platform();
    let cmd: string;

    switch (os) {
      case 'darwin':
        cmd = `open "${url}"`;
        break;
      case 'win32':
        cmd = `start "" "${url}"`;
        break;
      default:
        cmd = `xdg-open "${url}"`;
    }

    exec(cmd, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

export class ConfigManager {
  private config: Conf<GrokConfig>;

  constructor() {
    this.config = new Conf<GrokConfig>({
      projectName: 'grokcodecli',
      defaults: defaults as GrokConfig,
    });
  }

  async getApiKey(): Promise<string | undefined> {
    // Check environment variable first
    const envKey = process.env.XAI_API_KEY || process.env.GROK_API_KEY;
    if (envKey) return envKey;

    // Fall back to stored config
    return this.config.get('apiKey');
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.config.set('apiKey', apiKey);
  }

  get(key: keyof GrokConfig): GrokConfig[keyof GrokConfig] {
    return this.config.get(key);
  }

  set<K extends keyof GrokConfig>(key: K, value: GrokConfig[K]): void {
    this.config.set(key, value);
  }

  async setupAuth(): Promise<void> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const question = (prompt: string): Promise<string> => {
      return new Promise((resolve) => {
        rl.question(prompt, (answer) => {
          resolve(answer);
        });
      });
    };

    // Beautiful auth header
    console.log();
    console.log(chalk.cyan('╭──────────────────────────────────────────────────────────────────────╮'));
    console.log(chalk.cyan('│') + chalk.bold.cyan('  🔐 Grok Code CLI - Authentication                                    ') + chalk.cyan('│'));
    console.log(chalk.cyan('╰──────────────────────────────────────────────────────────────────────╯'));
    console.log();

    console.log(chalk.bold('  Welcome to Grok Code!'));
    console.log();
    console.log(chalk.gray('  To use Grok Code, you need an API key from xAI.'));
    console.log(chalk.gray('  We\'ll open your browser to the xAI console where you can:'));
    console.log();
    console.log(chalk.cyan('    1.') + ' Sign in or create an account');
    console.log(chalk.cyan('    2.') + ' Go to API Keys section');
    console.log(chalk.cyan('    3.') + ' Create a new API key');
    console.log(chalk.cyan('    4.') + ' Copy the key and paste it here');
    console.log();

    const xaiUrl = 'https://console.x.ai/';

    // Ask to open browser
    const openChoice = await question(chalk.bold.green('❯ ') + 'Open xAI Console in browser? [Y/n]: ');

    if (openChoice.toLowerCase() !== 'n') {
      console.log();
      console.log(chalk.cyan('  ⏳ Opening browser...'));

      try {
        await openBrowser(xaiUrl);
        console.log(chalk.green('  ✓ Browser opened!'));
        console.log();
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log(chalk.gray('  Follow these steps in the browser:'));
        console.log(chalk.gray('  1. Sign in to your xAI account'));
        console.log(chalk.gray('  2. Click on "API Keys" in the sidebar'));
        console.log(chalk.gray('  3. Click "Create API Key"'));
        console.log(chalk.gray('  4. Copy the key (starts with "xai-")'));
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log();
      } catch {
        console.log(chalk.yellow('  ⚠ Could not open browser automatically.'));
        console.log(chalk.gray(`  Please visit: ${chalk.cyan(xaiUrl)}`));
        console.log();
      }
    } else {
      console.log();
      console.log(chalk.gray(`  Visit: ${chalk.cyan(xaiUrl)}`));
      console.log();
    }

    // Get API key with masked input visual
    console.log(chalk.gray('  Paste your API key below (it will be hidden):'));
    console.log();
    const apiKey = await question(chalk.bold.green('❯ ') + 'API Key: ');

    if (!apiKey.trim()) {
      console.log();
      console.log(chalk.red('  ✗ API key cannot be empty.'));
      console.log(chalk.gray('  Run `grok auth` to try again.\n'));
      rl.close();
      return;
    }

    // Validate the key with spinner
    console.log();
    process.stdout.write(chalk.cyan('  ⠋ Validating API key...'));

    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let frameIndex = 0;
    const spinner = setInterval(() => {
      process.stdout.write(`\r${chalk.cyan('  ' + frames[frameIndex] + ' Validating API key...')}`);
      frameIndex = (frameIndex + 1) % frames.length;
    }, 80);

    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
      });

      clearInterval(spinner);

      if (!response.ok) {
        console.log(`\r${chalk.red('  ✗ Invalid API key. Please check and try again.')}          `);
        console.log();
        console.log(chalk.gray('  Make sure you copied the complete key starting with "xai-"'));
        console.log(chalk.gray('  Run `grok auth` to try again.\n'));
        rl.close();
        return;
      }

      // Get available models to show
      const data = await response.json() as { data: { id: string }[] };
      const modelCount = data.data?.length || 0;

      await this.setApiKey(apiKey.trim());

      // Success animation
      console.log(`\r${chalk.green('  ✓ API key validated!')}                                 `);
      console.log();
      console.log(chalk.cyan('╭──────────────────────────────────────────────────────────────────────╮'));
      console.log(chalk.cyan('│') + chalk.bold.green('  🎉 Authentication Successful!                                        ') + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `                                                                      ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.gray('API Key:')}    ${chalk.green('✓ Saved securely')}                                      ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.gray('Models:')}     ${chalk.cyan(modelCount + ' available')}                                          ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.gray('Config:')}     ${chalk.blue(this.config.path.slice(0, 45))}...` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `                                                                      ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.bold('Get started:')} ${chalk.cyan('grok')}                                               ` + chalk.cyan('│'));
      console.log(chalk.cyan('╰──────────────────────────────────────────────────────────────────────╯'));
      console.log();
    } catch (error) {
      clearInterval(spinner);
      console.log(`\r${chalk.red('  ✗ Error validating key: ' + (error as Error).message)}          `);
      console.log();
      console.log(chalk.gray('  Check your internet connection and try again.\n'));
    }

    rl.close();
  }

  async show(): Promise<void> {
    console.log(chalk.cyan('\n📋 Current Configuration\n'));

    const apiKey = await this.getApiKey();
    console.log(`  API Key: ${apiKey ? chalk.green('✓ Set') : chalk.red('✗ Not set')}`);
    console.log(`  Model: ${this.get('model')}`);
    console.log(`  Temperature: ${this.get('temperature')}`);
    console.log(`  Max Tokens: ${this.get('maxTokens')}`);
    console.log(`  Auto-approve: ${(this.get('autoApprove') as string[]).join(', ') || 'none'}`);
    console.log(`\n  Config file: ${this.config.path}\n`);
  }

  async reset(): Promise<void> {
    this.config.clear();
    Object.entries(defaults).forEach(([key, value]) => {
      this.config.set(key as keyof GrokConfig, value);
    });
  }

  async interactive(): Promise<void> {
    await this.show();
    console.log(chalk.gray('Use `grok config --reset` to reset to defaults.'));
    console.log(chalk.gray('Use `grok auth` to update your API key.\n'));
  }
}
