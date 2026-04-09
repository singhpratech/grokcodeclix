/**
 * Terminal Markdown Renderer
 *
 * Renders Markdown to ANSI-colored text for terminal display.
 * Designed to match Claude Code's output style — no external deps, just chalk.
 *
 * Supports:
 *   - headers (# ## ### ####)
 *   - **bold**, *italic*, ~~strikethrough~~
 *   - `inline code`
 *   - ```fenced code blocks``` with language-aware coloring
 *   - bullet and ordered lists (nested)
 *   - [link text](url)
 *   - > blockquotes
 *   - horizontal rules
 *   - basic tables
 */

import chalk from 'chalk';

// Syntax highlighters keyed by language — each takes code and returns colored code.
type Highlighter = (code: string) => string;

const KEYWORDS_JS = new Set([
  'const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while',
  'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new',
  'this', 'super', 'import', 'export', 'from', 'as', 'default', 'async',
  'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof',
  'true', 'false', 'null', 'undefined', 'void', 'delete', 'in', 'of', 'yield',
]);

const KEYWORDS_TS = new Set([
  ...KEYWORDS_JS,
  'interface', 'type', 'enum', 'namespace', 'declare', 'readonly', 'private',
  'protected', 'public', 'static', 'abstract', 'implements', 'keyof', 'infer',
  'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object',
]);

const KEYWORDS_PY = new Set([
  'def', 'class', 'import', 'from', 'as', 'return', 'if', 'elif', 'else',
  'for', 'while', 'break', 'continue', 'pass', 'try', 'except', 'finally',
  'raise', 'with', 'lambda', 'yield', 'global', 'nonlocal', 'is', 'not',
  'and', 'or', 'in', 'True', 'False', 'None', 'self', 'async', 'await',
]);

const KEYWORDS_GO = new Set([
  'package', 'import', 'func', 'var', 'const', 'type', 'struct', 'interface',
  'map', 'chan', 'return', 'if', 'else', 'for', 'range', 'switch', 'case',
  'default', 'break', 'continue', 'go', 'defer', 'select', 'fallthrough',
  'true', 'false', 'nil', 'iota',
]);

const KEYWORDS_RUST = new Set([
  'fn', 'let', 'mut', 'const', 'static', 'struct', 'enum', 'impl', 'trait',
  'pub', 'use', 'mod', 'crate', 'self', 'Self', 'super', 'as', 'return',
  'if', 'else', 'match', 'for', 'while', 'loop', 'break', 'continue',
  'true', 'false', 'async', 'await', 'move', 'dyn', 'ref', 'box', 'where',
]);

function highlightGeneric(keywords: Set<string>): Highlighter {
  return (code: string) => {
    const lines = code.split('\n');
    return lines.map((line) => {
      // Comments (// or #) — highlight whole-line comments
      const commentMatch = line.match(/^(\s*)(\/\/.*|#.*)$/);
      if (commentMatch) {
        return commentMatch[1] + chalk.gray(commentMatch[2]);
      }

      // Tokenize: split on word boundaries but preserve separators
      return line.replace(
        /(\/\/.*$|#.*$|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`|\b\d+\.?\d*\b|\b\w+\b|[{}()[\];,.])/g,
        (token) => {
          // Line comment tail
          if (token.startsWith('//') || token.startsWith('#')) return chalk.gray(token);
          // Strings
          if (
            (token.startsWith('"') && token.endsWith('"')) ||
            (token.startsWith("'") && token.endsWith("'")) ||
            (token.startsWith('`') && token.endsWith('`'))
          ) {
            return chalk.green(token);
          }
          // Numbers
          if (/^\d/.test(token)) return chalk.yellow(token);
          // Keywords
          if (keywords.has(token)) return chalk.magenta(token);
          // Booleans-ish
          if (token === 'true' || token === 'false' || token === 'null' || token === 'undefined') {
            return chalk.yellow(token);
          }
          return token;
        }
      );
    }).join('\n');
  };
}

const HIGHLIGHTERS: Record<string, Highlighter> = {
  js: highlightGeneric(KEYWORDS_JS),
  jsx: highlightGeneric(KEYWORDS_JS),
  ts: highlightGeneric(KEYWORDS_TS),
  tsx: highlightGeneric(KEYWORDS_TS),
  javascript: highlightGeneric(KEYWORDS_JS),
  typescript: highlightGeneric(KEYWORDS_TS),
  py: highlightGeneric(KEYWORDS_PY),
  python: highlightGeneric(KEYWORDS_PY),
  go: highlightGeneric(KEYWORDS_GO),
  rs: highlightGeneric(KEYWORDS_RUST),
  rust: highlightGeneric(KEYWORDS_RUST),
};

function highlightCode(lang: string, code: string): string {
  const key = (lang || '').toLowerCase();
  const hl = HIGHLIGHTERS[key];
  if (hl) return hl(code);
  // Fallback — just cyan the whole block
  return chalk.cyan(code);
}

// Render inline markdown: **bold**, *italic*, `code`, [link](url), ~~strike~~
function renderInline(text: string): string {
  let out = text;

  // Escape sequences so they survive
  // Inline code first (so bold/italic inside code isn't processed)
  out = out.replace(/`([^`\n]+)`/g, (_, code) => chalk.cyan(code));

  // Bold **text** or __text__
  out = out.replace(/\*\*([^*\n]+)\*\*/g, (_, t) => chalk.bold(t));
  out = out.replace(/__([^_\n]+)__/g, (_, t) => chalk.bold(t));

  // Italic *text* or _text_
  out = out.replace(/(?<![*\w])\*([^*\n]+)\*(?!\w)/g, (_, t) => chalk.italic(t));
  out = out.replace(/(?<![_\w])_([^_\n]+)_(?!\w)/g, (_, t) => chalk.italic(t));

  // Strikethrough ~~text~~
  out = out.replace(/~~([^~\n]+)~~/g, (_, t) => chalk.strikethrough(t));

  // Links [text](url)
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) =>
    chalk.cyan.underline(label) + chalk.dim(` (${url})`)
  );

  return out;
}

/**
 * Render markdown content as ANSI-colored terminal output.
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split('\n');
  const out: string[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block
    const fenceMatch = line.match(/^(\s*)```(\w*)\s*$/);
    if (fenceMatch) {
      const indent = fenceMatch[1];
      const lang = fenceMatch[2];
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !/^(\s*)```\s*$/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence

      const code = codeLines.join('\n');
      const highlighted = highlightCode(lang, code);
      const langLabel = lang ? chalk.dim(` ${lang}`) : '';

      // Render as a dim-bordered block
      out.push(indent + chalk.dim('┌─' + langLabel));
      for (const cl of highlighted.split('\n')) {
        out.push(indent + chalk.dim('│ ') + cl);
      }
      out.push(indent + chalk.dim('└─'));
      continue;
    }

    // Horizontal rule
    if (/^[\s]*(-{3,}|_{3,}|\*{3,})\s*$/.test(line)) {
      out.push(chalk.dim('─'.repeat(Math.min(process.stdout.columns || 60, 60))));
      i++;
      continue;
    }

    // Headers
    const headerMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headerMatch) {
      const level = headerMatch[1].length;
      const text = renderInline(headerMatch[2]);
      if (level === 1) {
        out.push('');
        out.push(chalk.bold.cyan('▌ ' + text));
        out.push('');
      } else if (level === 2) {
        out.push('');
        out.push(chalk.bold.white(text));
        out.push(chalk.dim('─'.repeat(Math.min(text.length, 60))));
      } else if (level === 3) {
        out.push('');
        out.push(chalk.bold.yellow(text));
      } else {
        out.push(chalk.bold(text));
      }
      i++;
      continue;
    }

    // Blockquote
    if (/^\s*>\s?/.test(line)) {
      const quote = line.replace(/^\s*>\s?/, '');
      out.push(chalk.dim('│ ') + chalk.italic(renderInline(quote)));
      i++;
      continue;
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)([-*+])\s+(.*)$/);
    if (ulMatch) {
      const indent = ulMatch[1];
      const text = renderInline(ulMatch[3]);
      out.push(indent + chalk.cyan('•') + ' ' + text);
      i++;
      continue;
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (olMatch) {
      const indent = olMatch[1];
      const num = olMatch[2];
      const text = renderInline(olMatch[3]);
      out.push(indent + chalk.cyan(num + '.') + ' ' + text);
      i++;
      continue;
    }

    // Plain paragraph / blank line
    if (line.trim() === '') {
      out.push('');
    } else {
      out.push(renderInline(line));
    }
    i++;
  }

  return out.join('\n');
}

/**
 * Strip markdown formatting to plain text (for titles, summaries).
 */
export function stripMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#+\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .trim();
}
