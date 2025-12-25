import Conf from 'conf';
import chalk from 'chalk';
import * as readline from 'readline';

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

    console.log(chalk.cyan('\n🔐 Grok CLI Authentication Setup\n'));
    console.log('Get your API key from: https://console.x.ai/\n');

    const apiKey = await question('Enter your xAI API key: ');

    if (!apiKey.trim()) {
      console.log(chalk.red('API key cannot be empty.'));
      rl.close();
      return;
    }

    // Validate the key by making a test request
    console.log(chalk.gray('\nValidating API key...'));

    try {
      const response = await fetch('https://api.x.ai/v1/models', {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`,
        },
      });

      if (!response.ok) {
        console.log(chalk.red('Invalid API key. Please check and try again.'));
        rl.close();
        return;
      }

      await this.setApiKey(apiKey.trim());
      console.log(chalk.green('\n✓ API key saved successfully!'));
      console.log(chalk.gray('You can now use `grok` to start chatting.\n'));
    } catch (error) {
      console.log(chalk.red(`Error validating key: ${error}`));
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
