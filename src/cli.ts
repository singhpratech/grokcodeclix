#!/usr/bin/env node

import { Command } from 'commander';
import { GrokChat } from './conversation/chat.js';
import { ConfigManager } from './config/manager.js';
import chalk from 'chalk';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get version from package.json
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageJson = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));

const program = new Command();

program
  .name('grok')
  .description('CLI coding assistant powered by Grok AI')
  .version(packageJson.version);

program
  .command('chat', { isDefault: true })
  .description('Start an interactive chat session')
  .option('-m, --model <model>', 'Grok model to use', 'grok-4-1-fast-reasoning')
  .option('-r, --resume [sessionId]', 'Resume a previous conversation')
  .action(async (options) => {
    const config = new ConfigManager();
    let apiKey = await config.getApiKey();

    // If no API key, run auth flow automatically (don't exit!)
    if (!apiKey) {
      console.log(chalk.yellow('\n  No API key found. Let\'s set one up!\n'));
      const success = await config.setupAuth();

      if (!success) {
        console.log(chalk.red('\n  Authentication failed. Please try again with `grok`.\n'));
        process.exit(1);
      }

      // Get the newly set API key
      apiKey = await config.getApiKey();

      if (!apiKey) {
        console.log(chalk.red('\n  Could not retrieve API key. Please try again.\n'));
        process.exit(1);
      }
    }

    // Start chat automatically after auth or if already authenticated
    const chat = new GrokChat({
      apiKey,
      model: options.model,
    });

    if (options.resume !== undefined) {
      const sessionId = typeof options.resume === 'string' ? options.resume : undefined;
      await chat.resume(sessionId);
    } else {
      await chat.start();
    }
  });

program
  .command('auth')
  .description('Authenticate with xAI API')
  .action(async () => {
    const config = new ConfigManager();
    const success = await config.setupAuth();

    if (success) {
      // After successful auth, ask if they want to start chatting
      const readline = await import('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.bold.green('❯ ') + 'Start chatting now? [Y/n]: ', resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== 'n') {
        const apiKey = await config.getApiKey();
        if (apiKey) {
          const chat = new GrokChat({ apiKey });
          await chat.start();
        }
      }
    }
  });

program
  .command('config')
  .description('Manage configuration')
  .option('--show', 'Show current configuration')
  .option('--reset', 'Reset configuration to defaults')
  .action(async (options) => {
    const config = new ConfigManager();

    if (options.show) {
      await config.show();
    } else if (options.reset) {
      await config.reset();
      console.log(chalk.green('Configuration reset to defaults.'));
    } else {
      await config.interactive();
    }
  });

program.parse();
