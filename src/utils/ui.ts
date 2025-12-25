/**
 * UI Utilities
 *
 * Beautiful terminal output, syntax highlighting, progress indicators,
 * and user experience enhancements.
 */

import chalk from 'chalk';

// ============================================================================
// Box Drawing & Borders
// ============================================================================

export const BOX = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
  teeRight: '├',
  teeLeft: '┤',
  teeDown: '┬',
  teeUp: '┴',
  cross: '┼',
};

export function drawBox(content: string[], options: {
  title?: string;
  width?: number;
  padding?: number;
  borderColor?: typeof chalk;
} = {}): string {
  const {
    title = '',
    width = Math.max(...content.map(l => stripAnsi(l).length), title.length) + 4,
    padding = 1,
    borderColor = chalk.cyan,
  } = options;

  const innerWidth = width - 2;
  const lines: string[] = [];

  // Top border
  if (title) {
    const titlePadded = ` ${title} `;
    const leftPad = Math.floor((innerWidth - titlePadded.length) / 2);
    const rightPad = innerWidth - leftPad - titlePadded.length;
    lines.push(
      borderColor(BOX.topLeft) +
      borderColor(BOX.horizontal.repeat(leftPad)) +
      chalk.bold(titlePadded) +
      borderColor(BOX.horizontal.repeat(rightPad)) +
      borderColor(BOX.topRight)
    );
  } else {
    lines.push(
      borderColor(BOX.topLeft + BOX.horizontal.repeat(innerWidth) + BOX.topRight)
    );
  }

  // Padding top
  for (let i = 0; i < padding; i++) {
    lines.push(borderColor(BOX.vertical) + ' '.repeat(innerWidth) + borderColor(BOX.vertical));
  }

  // Content
  for (const line of content) {
    const stripped = stripAnsi(line);
    const pad = innerWidth - stripped.length - 2;
    lines.push(
      borderColor(BOX.vertical) +
      ' ' + line + ' '.repeat(Math.max(0, pad + 1)) +
      borderColor(BOX.vertical)
    );
  }

  // Padding bottom
  for (let i = 0; i < padding; i++) {
    lines.push(borderColor(BOX.vertical) + ' '.repeat(innerWidth) + borderColor(BOX.vertical));
  }

  // Bottom border
  lines.push(
    borderColor(BOX.bottomLeft + BOX.horizontal.repeat(innerWidth) + BOX.bottomRight)
  );

  return lines.join('\n');
}

// ============================================================================
// Syntax Highlighting
// ============================================================================

const LANGUAGE_KEYWORDS: Record<string, string[]> = {
  typescript: ['const', 'let', 'var', 'function', 'class', 'interface', 'type', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'this', 'extends', 'implements', 'private', 'public', 'protected', 'static', 'readonly'],
  javascript: ['const', 'let', 'var', 'function', 'class', 'import', 'export', 'from', 'return', 'if', 'else', 'for', 'while', 'async', 'await', 'new', 'this', 'extends'],
  python: ['def', 'class', 'import', 'from', 'return', 'if', 'elif', 'else', 'for', 'while', 'try', 'except', 'finally', 'with', 'as', 'yield', 'lambda', 'None', 'True', 'False', 'and', 'or', 'not', 'in', 'is', 'async', 'await'],
  rust: ['fn', 'let', 'mut', 'const', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'match', 'if', 'else', 'for', 'while', 'loop', 'return', 'async', 'await', 'self', 'Self'],
  go: ['func', 'var', 'const', 'type', 'struct', 'interface', 'package', 'import', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'defer', 'go', 'chan', 'map', 'make', 'new'],
  bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac', 'function', 'return', 'exit', 'export', 'local', 'readonly'],
};

const LANG_ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
};

export function highlightCode(code: string, language?: string): string {
  const lang = language ? (LANG_ALIASES[language] || language).toLowerCase() : '';
  const keywords = LANGUAGE_KEYWORDS[lang] || [];

  let result = code;

  // Highlight strings
  result = result.replace(/(["'`])(?:(?!\1)[^\\]|\\.)*\1/g, chalk.green('$&'));

  // Highlight numbers
  result = result.replace(/\b(\d+\.?\d*)\b/g, chalk.yellow('$1'));

  // Highlight comments
  result = result.replace(/(\/\/.*$|#.*$)/gm, chalk.gray('$1'));
  result = result.replace(/(\/\*[\s\S]*?\*\/)/g, chalk.gray('$1'));

  // Highlight keywords
  for (const keyword of keywords) {
    const regex = new RegExp(`\\b(${keyword})\\b`, 'g');
    result = result.replace(regex, chalk.magenta('$1'));
  }

  // Highlight function calls
  result = result.replace(/\b([a-zA-Z_]\w*)\s*\(/g, chalk.blue('$1') + '(');

  return result;
}

export function formatCodeBlock(code: string, language?: string, showLineNumbers = true): string {
  const highlighted = highlightCode(code, language);
  const lines = highlighted.split('\n');

  const header = chalk.gray(`─── ${language || 'code'} ${'─'.repeat(Math.max(0, 40 - (language?.length || 4)))}`);
  const footer = chalk.gray('─'.repeat(45));

  if (showLineNumbers) {
    const padding = String(lines.length).length;
    const numberedLines = lines.map((line, i) =>
      chalk.gray(String(i + 1).padStart(padding) + ' │ ') + line
    );
    return `${header}\n${numberedLines.join('\n')}\n${footer}`;
  }

  return `${header}\n${highlighted}\n${footer}`;
}

// ============================================================================
// Progress & Status Indicators
// ============================================================================

export function progressBar(current: number, total: number, width = 30): string {
  const percent = Math.min(100, Math.round((current / total) * 100));
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;

  const bar = chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
  return `[${bar}] ${percent}%`;
}

export function spinner(): { start: () => void; stop: (success?: boolean) => void; update: (text: string) => void } {
  const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let i = 0;
  let interval: NodeJS.Timeout | null = null;
  let text = '';

  return {
    start() {
      interval = setInterval(() => {
        process.stdout.write(`\r${chalk.cyan(frames[i])} ${text}`);
        i = (i + 1) % frames.length;
      }, 80);
    },
    stop(success = true) {
      if (interval) {
        clearInterval(interval);
        const icon = success ? chalk.green('✓') : chalk.red('✗');
        process.stdout.write(`\r${icon} ${text}\n`);
      }
    },
    update(newText: string) {
      text = newText;
    },
  };
}

// ============================================================================
// Badges & Tags
// ============================================================================

export function badge(text: string, type: 'info' | 'success' | 'warning' | 'error' = 'info'): string {
  const colors = {
    info: chalk.bgCyan.black,
    success: chalk.bgGreen.black,
    warning: chalk.bgYellow.black,
    error: chalk.bgRed.white,
  };
  return colors[type](` ${text} `);
}

export function tag(text: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'magenta' = 'cyan'): string {
  const colors = {
    cyan: chalk.cyan,
    green: chalk.green,
    yellow: chalk.yellow,
    red: chalk.red,
    blue: chalk.blue,
    magenta: chalk.magenta,
  };
  return colors[color](`[${text}]`);
}

// ============================================================================
// Welcome Screen & Branding
// ============================================================================

export function welcomeScreen(version: string, model: string, cwd: string): string {
  const logo = `
   ██████╗ ██████╗  ██████╗ ██╗  ██╗     ██████╗ ██████╗ ██████╗ ███████╗
  ██╔════╝ ██╔══██╗██╔═══██╗██║ ██╔╝    ██╔════╝██╔═══██╗██╔══██╗██╔════╝
  ██║  ███╗██████╔╝██║   ██║█████╔╝     ██║     ██║   ██║██║  ██║█████╗
  ██║   ██║██╔══██╗██║   ██║██╔═██╗     ██║     ██║   ██║██║  ██║██╔══╝
  ╚██████╔╝██║  ██║╚██████╔╝██║  ██╗    ╚██████╗╚██████╔╝██████╔╝███████╗
   ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝     ╚═════╝ ╚═════╝ ╚═════╝ ╚══════╝`;

  const info = [
    '',
    `  ${chalk.gray('Version:')}  ${chalk.cyan(version)}`,
    `  ${chalk.gray('Model:')}    ${chalk.green(model)}`,
    `  ${chalk.gray('CWD:')}      ${chalk.blue(cwd)}`,
    '',
    `  ${chalk.gray('Type')} ${chalk.cyan('/help')} ${chalk.gray('for commands,')} ${chalk.yellow('exit')} ${chalk.gray('to quit')}`,
    '',
  ];

  return chalk.cyan(logo) + info.join('\n');
}

export function compactWelcome(version: string, model: string): string {
  return `
${chalk.cyan('╭─────────────────────────────────────────────╮')}
${chalk.cyan('│')}  ${chalk.bold.cyan('🚀 Grok Code CLI')} ${chalk.gray(`v${version}`)}                    ${chalk.cyan('│')}
${chalk.cyan('│')}  ${chalk.gray('Model:')} ${chalk.green(model.padEnd(32))}  ${chalk.cyan('│')}
${chalk.cyan('│')}  ${chalk.gray('Type /help for commands, exit to quit')}    ${chalk.cyan('│')}
${chalk.cyan('╰─────────────────────────────────────────────╯')}
`;
}

// ============================================================================
// Tips & Hints
// ============================================================================

const TIPS = [
  'Use /compact to reduce context when conversations get long',
  'Press Ctrl+C to cancel a running command',
  'Use /export conversation.md to save your chat',
  'The /doctor command checks your setup for issues',
  'You can resume previous sessions with /resume',
  'Use /model to switch between Grok 4, Grok 3 and specialized models',
  'The /context command shows how much context you\'re using',
  'Session are auto-saved - you can always pick up where you left off',
  'Use /history to see your recent conversations',
  'The Read, Write, and Edit tools work on any file type',
];

export function randomTip(): string {
  const tip = TIPS[Math.floor(Math.random() * TIPS.length)];
  return chalk.gray(`💡 Tip: ${tip}`);
}

// ============================================================================
// Tables
// ============================================================================

export function table(headers: string[], rows: string[][], options: {
  padding?: number;
  headerColor?: typeof chalk;
} = {}): string {
  const { padding = 1, headerColor = chalk.bold.cyan } = options;

  // Calculate column widths
  const colWidths = headers.map((h, i) => {
    const maxContent = Math.max(h.length, ...rows.map(r => stripAnsi(r[i] || '').length));
    return maxContent + padding * 2;
  });

  // Build separator
  const separator = BOX.horizontal;
  const topBorder = BOX.topLeft + colWidths.map(w => separator.repeat(w)).join(BOX.teeDown) + BOX.topRight;
  const midBorder = BOX.teeRight + colWidths.map(w => separator.repeat(w)).join(BOX.cross) + BOX.teeLeft;
  const bottomBorder = BOX.bottomLeft + colWidths.map(w => separator.repeat(w)).join(BOX.teeUp) + BOX.bottomRight;

  // Build header row
  const headerRow = BOX.vertical + headers.map((h, i) => {
    const padded = h.padStart(Math.floor((colWidths[i] + h.length) / 2)).padEnd(colWidths[i]);
    return headerColor(padded);
  }).join(BOX.vertical) + BOX.vertical;

  // Build content rows
  const contentRows = rows.map(row =>
    BOX.vertical + row.map((cell, i) => {
      const stripped = stripAnsi(cell || '');
      const padded = ' '.repeat(padding) + cell + ' '.repeat(colWidths[i] - stripped.length - padding);
      return padded;
    }).join(BOX.vertical) + BOX.vertical
  );

  return [topBorder, headerRow, midBorder, ...contentRows, bottomBorder].join('\n');
}

// ============================================================================
// Diff Display
// ============================================================================

export function formatDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  const lines: string[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx >= oldLines.length) {
      lines.push(chalk.green(`+ ${newLines[newIdx]}`));
      newIdx++;
    } else if (newIdx >= newLines.length) {
      lines.push(chalk.red(`- ${oldLines[oldIdx]}`));
      oldIdx++;
    } else if (oldLines[oldIdx] === newLines[newIdx]) {
      lines.push(chalk.gray(`  ${oldLines[oldIdx]}`));
      oldIdx++;
      newIdx++;
    } else {
      lines.push(chalk.red(`- ${oldLines[oldIdx]}`));
      lines.push(chalk.green(`+ ${newLines[newIdx]}`));
      oldIdx++;
      newIdx++;
    }
  }

  return lines.join('\n');
}

// ============================================================================
// Helpers
// ============================================================================

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

export function truncate(str: string, maxLength: number, suffix = '...'): string {
  if (str.length <= maxLength) return str;
  return str.slice(0, maxLength - suffix.length) + suffix;
}

export function indent(text: string, spaces = 2): string {
  const pad = ' '.repeat(spaces);
  return text.split('\n').map(line => pad + line).join('\n');
}

export function divider(char = '─', length = 50): string {
  return chalk.gray(char.repeat(length));
}

export function timestamp(): string {
  return chalk.gray(new Date().toLocaleTimeString());
}
