#!/usr/bin/env node
// Visual preview of Grok Code's UI output — no API key needed.
import chalk from 'chalk';
import { renderMarkdown } from './dist/utils/markdown.js';
import { computeDiff, renderDiff, formatDiffSummary } from './dist/utils/diff.js';

console.log();
console.log(chalk.bold.cyan('━━━ Welcome banner ━━━'));
console.log();

const width = 72;
const top = '╭' + '─'.repeat(width - 2) + '╮';
const bot = '╰' + '─'.repeat(width - 2) + '╯';
const mid = (text) => {
  const visible = text.replace(/\x1B\[[0-9;]*m/g, '');
  const pad = Math.max(0, width - 2 - visible.length);
  return chalk.cyan('│') + text + ' '.repeat(pad) + chalk.cyan('│');
};

console.log(chalk.cyan(top));
console.log(mid(chalk.bold.white('  ✦ Grok Code ') + chalk.dim('v0.1.21')));
console.log(mid(''));
console.log(mid(chalk.dim('  Model:  ') + chalk.white('grok-4-1-fast-reasoning') + chalk.dim(' 🧠 Thinking')));
console.log(mid(chalk.dim('  CWD:    ') + chalk.white('~/Documents/grokcodeclix')));
console.log(mid(chalk.dim('  Tools:  ') + chalk.white('8 available') + chalk.dim(' — Read, Write, Edit, Bash, Glob, Grep, WebFetch, WebSearch')));
console.log(mid(chalk.dim('  Context: ') + chalk.white('GROK.md loaded')));
console.log(mid(''));
console.log(mid(chalk.dim('  /help for commands · Tab: toggle mode · Esc: stop · Ctrl+C: exit')));
console.log(chalk.cyan(bot));
console.log();

console.log();
console.log(chalk.bold.cyan('━━━ Markdown rendering sample ━━━'));
console.log();

const sample = `# Building a REST API with Express

Here's a quick guide to wire up a basic Express server.

## Install dependencies

First, add the required packages:

\`\`\`bash
npm install express
npm install -D @types/express typescript
\`\`\`

## Create the server

Add this to \`src/server.ts\`:

\`\`\`ts
import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

app.listen(3000, () => {
  console.log('Server running on :3000');
});
\`\`\`

## Key points

- Always validate **user input** before using it
- Use *middleware* for cross-cutting concerns
- Add \`helmet\` and \`cors\` for production
- Check out [Express docs](https://expressjs.com) for more

> Remember: never trust data from the client.
`;

console.log(renderMarkdown(sample));

console.log();
console.log(chalk.bold.cyan('━━━ Tool execution display sample ━━━'));
console.log();

console.log(chalk.green('  ● ') + chalk.bold('Read') + chalk.dim('(') + chalk.white('src/server.ts') + chalk.dim(')'));
console.log(chalk.dim('    ⎿ ') + chalk.dim('Read 12 lines from src/server.ts'));
console.log();

console.log(chalk.green('  ● ') + chalk.bold('Edit') + chalk.dim('(') + chalk.white('src/server.ts') + chalk.dim(')'));

const before = `import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

app.listen(3000, () => {
  console.log('Server running on :3000');
});`;

const after = `import express from 'express';
import helmet from 'helmet';

const app = express();
app.use(express.json());
app.use(helmet());

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});

app.listen(3000, () => {
  console.log('Server running on :3000');
});`;

const diff = computeDiff(before, after);
console.log(chalk.dim('    ⎿ ') + `Updated src/server.ts with ${formatDiffSummary(diff)}`);
console.log(renderDiff(diff, 30, 1));
console.log();

console.log(chalk.green('  ● ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white('npm install express') + chalk.dim(')'));
console.log(chalk.dim('    ⎿ ') + chalk.dim('5 lines of output'));
console.log(chalk.dim('    │ ') + 'added 64 packages in 2s');
console.log(chalk.dim('    │ '));
console.log(chalk.dim('    │ ') + '12 packages are looking for funding');
console.log(chalk.dim('    │ ') + '  run `npm fund` for details');
console.log(chalk.dim('    │ '));
console.log();

console.log(chalk.green('  ● ') + chalk.bold('Grep') + chalk.dim('(') + chalk.white('TODO') + chalk.dim(')'));
console.log(chalk.dim('    ⎿ ') + chalk.dim('3 match(es)'));
console.log();

console.log(chalk.green('  ● ') + chalk.bold('WebSearch') + chalk.dim('(') + chalk.white('express middleware best practices') + chalk.dim(')'));
console.log(chalk.dim('    ⎿ ') + chalk.dim('results returned'));
console.log();

console.log();
console.log(chalk.bold.cyan('━━━ Permission prompt sample ━━━'));
console.log();
console.log('  ⚡ ' + chalk.red('Bash') + chalk.dim(' — Execute command: npm install express'));
console.log(chalk.dim('     command: npm install express'));
console.log();
console.log(chalk.bold('Permission:'));
console.log(chalk.dim('↑↓/Tab to navigate, Enter to select, Esc to cancel'));
console.log(chalk.cyan('❯ ') + chalk.cyan.bold('Allow once') + chalk.dim(' - permit this action'));
console.log('  Allow session' + chalk.dim(' - permit for session'));
console.log('  Deny' + chalk.dim(' - reject this action'));
console.log('  Block' + chalk.dim(' - block tool for session'));
console.log();

console.log();
console.log(chalk.bold.cyan('━━━ Prompt bar sample ━━━'));
console.log();
console.log(chalk.dim('─'.repeat(60)));
console.log(chalk.bold.cyan('🧠 ❯ ') + chalk.dim('(type your message, /help for commands)'));
console.log();
