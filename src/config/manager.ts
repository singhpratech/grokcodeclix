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
  model: 'grok-4-1-fast-non-reasoning',
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

  delete(key: keyof GrokConfig): void {
    this.config.delete(key);
  }

  /**
   * Run the interactive auth flow.
   *
   * If `existingRl` is provided, reuse it instead of creating a second
   * readline interface (avoids conflicts when called from inside an
   * active chat session). Pass the chat's own rl to keep input routing
   * consistent.
   */
  async setupAuth(existingRl?: readline.Interface): Promise<boolean> {
    const ownRl = !existingRl;
    const rl: readline.Interface =
      existingRl ||
      readline.createInterface({
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
    console.log(chalk.gray('  Choose how you want to authenticate. All three work with Grok models'));
    console.log(chalk.gray('  including SuperGrok / Grok Premium subscription credits.'));
    console.log();
    console.log('    ' + chalk.bold.cyan('[1]') + ' Sign in to xAI Console ' + chalk.gray('(opens browser → console.x.ai, supports SuperGrok)'));
    console.log('    ' + chalk.bold.cyan('[2]') + ' Use OpenRouter ' + chalk.gray('(opens browser → openrouter.ai, one key for many providers)'));
    console.log('    ' + chalk.bold.cyan('[3]') + ' Paste an existing API key ' + chalk.gray('(xai-… or sk-or-…)'));
    console.log();

    const choice = await question(chalk.bold.green('❯ ') + 'Choose [1/2/3]: ');
    const trimmedChoice = choice.trim();

    const xaiUrl = 'https://console.x.ai/';
    const orUrl = 'https://openrouter.ai/keys';

    if (trimmedChoice === '1' || trimmedChoice === '') {
      console.log();
      console.log(chalk.cyan('  ⏳ Opening xAI Console...'));
      try {
        await openBrowser(xaiUrl);
        console.log(chalk.white('  ✓ Browser opened!'));
        console.log();
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log(chalk.gray('  1. Sign in to your xAI account (your SuperGrok plan applies here)'));
        console.log(chalk.gray('  2. Click "API Keys" in the sidebar'));
        console.log(chalk.gray('  3. Click "Create API Key", copy the key (starts with "xai-")'));
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log();
      } catch {
        console.log(chalk.yellow('  ⚠ Could not open browser automatically.'));
        console.log(chalk.gray(`  Please visit: ${chalk.cyan(xaiUrl)}`));
        console.log();
      }
    } else if (trimmedChoice === '2') {
      console.log();
      console.log(chalk.cyan('  ⏳ Opening OpenRouter...'));
      try {
        await openBrowser(orUrl);
        console.log(chalk.white('  ✓ Browser opened!'));
        console.log();
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log(chalk.gray('  1. Sign in / sign up at openrouter.ai'));
        console.log(chalk.gray('  2. Visit Keys → Create Key'));
        console.log(chalk.gray('  3. Copy the key (starts with "sk-or-")'));
        console.log(chalk.gray('  4. (Optional) Adjust privacy/data-policy at openrouter.ai/settings/privacy'));
        console.log(chalk.gray('  ─────────────────────────────────────────────────────────────────'));
        console.log();
      } catch {
        console.log(chalk.yellow('  ⚠ Could not open browser automatically.'));
        console.log(chalk.gray(`  Please visit: ${chalk.cyan(orUrl)}`));
        console.log();
      }
    } else {
      console.log();
      console.log(chalk.gray(`  xAI:        ${chalk.cyan(xaiUrl)}`));
      console.log(chalk.gray(`  OpenRouter: ${chalk.cyan(orUrl)}`));
      console.log();
    }

    // Get API key
    console.log(chalk.gray('  Paste your API key below:'));
    console.log();
    const apiKey = await question(chalk.bold.green('❯ ') + 'API Key: ');

    if (!apiKey.trim()) {
      console.log();
      console.log(chalk.red('  ✗ API key cannot be empty.'));
      rl.close();
      return false;
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

    const trimmedKey = apiKey.trim();
    const isOpenRouter = trimmedKey.startsWith('sk-or-');
    const validateUrl = isOpenRouter
      ? 'https://openrouter.ai/api/v1/models'
      : 'https://api.x.ai/v1/models';
    const validateHeaders: Record<string, string> = { 'Authorization': `Bearer ${trimmedKey}` };
    if (isOpenRouter) {
      validateHeaders['HTTP-Referer'] = 'https://github.com/singhpratech/grokcodeclix';
      validateHeaders['X-Title'] = 'Grok Code CLI';
    }

    try {
      const response = await fetch(validateUrl, { headers: validateHeaders });

      clearInterval(spinner);

      if (!response.ok) {
        console.log(`\r${chalk.red('  ✗ Invalid API key. Please check and try again.')}          `);
        console.log();
        console.log(chalk.gray(`  Make sure you copied the complete key starting with "${isOpenRouter ? 'sk-or-' : 'xai-'}"`));
        rl.close();
        return false;
      }

      // Get available models to show
      const data = await response.json() as { data: { id: string }[] };
      const all = data.data || [];
      const modelCount = isOpenRouter
        ? all.filter((m) => m.id.startsWith('x-ai/')).length
        : all.length;

      await this.setApiKey(trimmedKey);
      const provider = isOpenRouter ? 'openrouter' : 'xai';
      console.log(); // spacing for next message
      console.log(chalk.dim(`  Provider: ${provider}`));

      // Success animation
      console.log(`\r${chalk.white('  ✓ API key validated!')}                                 `);
      console.log();
      console.log(chalk.cyan('╭──────────────────────────────────────────────────────────────────────╮'));
      console.log(chalk.cyan('│') + chalk.bold.green('  🎉 Authentication Successful!                                        ') + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `                                                                      ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.gray('API Key:')}    ${chalk.white('✓ Saved securely')}                                      ` + chalk.cyan('│'));
      console.log(chalk.cyan('│') + `  ${chalk.gray('Models:')}     ${chalk.cyan(modelCount + ' available')}                                          ` + chalk.cyan('│'));
      console.log(chalk.cyan('╰──────────────────────────────────────────────────────────────────────╯'));
      console.log();

      rl.close();
      return true;
    } catch (error) {
      clearInterval(spinner);
      console.log(`\r${chalk.red('  ✗ Error validating key: ' + (error as Error).message)}          `);
      console.log();
      console.log(chalk.gray('  Check your internet connection and try again.'));
      rl.close();
      return false;
    }
  }

  async show(): Promise<void> {
    console.log(chalk.cyan('\n📋 Current Configuration\n'));

    const apiKey = await this.getApiKey();
    console.log(`  API Key: ${apiKey ? chalk.white('✓ Set') : chalk.red('✗ Not set')}`);
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
    console.log(chalk.gray('Use `grokclix config --reset` to reset to defaults.'));
    console.log(chalk.gray('Use `grokclix auth` to update your API key.\n'));
  }
}
