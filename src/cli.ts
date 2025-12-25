#!/usr/bin/env node

import { Command } from 'commander';
import { GrokChat } from './conversation/chat.js';
import { ConfigManager } from './config/manager.js';
import chalk from 'chalk';

const program = new Command();

program
  .name('grok')
  .description('CLI coding assistant powered by Grok AI')
  .version('0.1.0');

program
  .command('chat', { isDefault: true })
  .description('Start an interactive chat session')
  .option('-m, --model <model>', 'Grok model to use', 'grok-4-0709')
  .option('-r, --resume [sessionId]', 'Resume a previous conversation')
  .action(async (options) => {
    const config = new ConfigManager();
    const apiKey = await config.getApiKey();

    if (!apiKey) {
      console.log(chalk.yellow('No API key found. Run `grok auth` to set up your xAI API key.'));
      process.exit(1);
    }

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
    await config.setupAuth();
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
