#!/usr/bin/env node
// Visual preview of Grok Code's UI output — no API key needed.
// Run: FORCE_COLOR=1 node preview.mjs
import chalk from 'chalk';
import { renderMarkdown } from './dist/utils/markdown.js';
import { computeDiff, renderDiff, formatDiffSummary } from './dist/utils/diff.js';

const SAFFRON = chalk.hex('#FF9933');
const INDIA_GREEN = chalk.hex('#138808');

console.log();
console.log(chalk.bold('━━━ Welcome banner (Claude Code style) ━━━'));
console.log();

const width = 62;
const innerWidth = width - 4;
const top = chalk.dim('╭' + '─'.repeat(width - 2) + '╮');
const bot = chalk.dim('╰' + '─'.repeat(width - 2) + '╯');
const line = (text) => {
  const visible = text.replace(/\x1B\[[0-9;]*m/g, '');
  const pad = Math.max(0, innerWidth - visible.length);
  return chalk.dim('│ ') + text + ' '.repeat(pad) + chalk.dim(' │');
};
const blank = line('');

const tricolor = SAFFRON('✻') + ' ' + chalk.white('✻') + ' ' + INDIA_GREEN('✻');

console.log(top);
console.log(line(tricolor + '  ' + chalk.bold('Welcome to Grok Code!')));
console.log(blank);
console.log(line(chalk.dim('  /help for help, /status for your current setup')));
console.log(blank);
console.log(line(chalk.dim('  cwd: ') + '~/Documents/grokcodeclix'));
console.log(line(chalk.dim('  ') + INDIA_GREEN('✓') + chalk.dim(' GROK.md loaded')));
console.log(bot);
console.log();

console.log();
console.log(chalk.bold('━━━ Input prompt ━━━'));
console.log();
console.log(chalk.dim('  ? for shortcuts'));
console.log(chalk.dim('> ') + 'help me refactor this file');
console.log();

console.log();
console.log(chalk.bold('━━━ Thinking indicator ━━━'));
console.log();
console.log(SAFFRON('✻') + ' ' + chalk.dim('Thinking…'));
console.log();

console.log();
console.log(chalk.bold('━━━ Tool call display ━━━'));
console.log();

console.log(SAFFRON('● ') + chalk.bold('Read') + chalk.dim('(') + chalk.white('src/server.ts') + chalk.dim(')'));
console.log('  ' + chalk.dim('⎿  ') + chalk.dim('Read 12 lines from src/server.ts'));
console.log();

console.log(SAFFRON('● ') + chalk.bold('Edit') + chalk.dim('(') + chalk.white('src/server.ts') + chalk.dim(')'));

const before = `import express from 'express';

const app = express();
app.use(express.json());

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});`;

const after = `import express from 'express';
import helmet from 'helmet';

const app = express();
app.use(express.json());
app.use(helmet());

app.get('/api/users', (req, res) => {
  res.json({ users: [] });
});`;

const diff = computeDiff(before, after);
console.log('  ' + chalk.dim('⎿  ') + `Updated src/server.ts with ${formatDiffSummary(diff)}`);
console.log(renderDiff(diff, 30, 1));
console.log();

console.log(SAFFRON('● ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white('npm install express') + chalk.dim(')'));
console.log('  ' + chalk.dim('⎿  ') + chalk.dim('5 lines of output'));
console.log('  ' + chalk.dim('│ ') + 'added 64 packages in 2s');
console.log('  ' + chalk.dim('│ '));
console.log('  ' + chalk.dim('│ ') + '12 packages are looking for funding');
console.log('  ' + chalk.dim('│ ') + '  run `npm fund` for details');
console.log();

console.log(SAFFRON('● ') + chalk.bold('Grep') + chalk.dim('(') + chalk.white('TODO|FIXME') + chalk.dim(')'));
console.log('  ' + chalk.dim('⎿  ') + chalk.dim('3 match(es)'));
console.log();

console.log();
console.log(chalk.bold('━━━ Permission prompt ━━━'));
console.log();
console.log(SAFFRON('● ') + chalk.bold('Bash') + chalk.dim('(') + chalk.white('npm install express') + chalk.dim(')'));
console.log();
console.log('  ' + chalk.bold('Do you want to run this command?'));
console.log(chalk.cyan('❯ ') + chalk.cyan.bold('1. Yes'));
console.log('  ' + "2. Yes, and don't ask again this session");
console.log('  ' + '3. No, and tell Grok what to do differently ' + chalk.dim('(esc)'));
console.log();

console.log();
console.log(chalk.bold('━━━ Markdown response ━━━'));
console.log();

const sample = `# Express REST API

Here's a quick Express server with a users endpoint.

## Install

\`\`\`bash
npm install express
\`\`\`

## Code

Create \`src/server.ts\`:

\`\`\`ts
import express from 'express';

const app = express();
app.get('/users', (req, res) => {
  res.json({ users: [] });
});

app.listen(3000);
\`\`\`

## Notes

- Always validate **user input**
- Use *middleware* like \`helmet\` for security
- See [Express docs](https://expressjs.com) for more
`;

console.log(renderMarkdown(sample));
console.log();
