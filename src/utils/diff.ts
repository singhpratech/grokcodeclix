/**
 * Simple line diff utility for Edit/Write tool display.
 *
 * Produces a compact diff showing added and removed lines, matching
 * Claude Code's edit result format:
 *
 *   Updated file.ts with 2 additions and 1 removal
 *        12  - old line
 *        13  + new line
 *        14  + another new line
 */

import chalk from 'chalk';

export interface DiffLine {
  type: 'context' | 'add' | 'remove';
  oldLine?: number;
  newLine?: number;
  content: string;
}

export interface DiffSummary {
  additions: number;
  removals: number;
  lines: DiffLine[];
}

/**
 * Compute a line-level diff between two strings using LCS.
 * Returns all the lines of `b` annotated as context/add, and all removed
 * lines from `a` as remove — in source order.
 */
export function computeDiff(a: string, b: string): DiffSummary {
  const aLines = a.split('\n');
  const bLines = b.split('\n');

  // LCS dp
  const n = aLines.length;
  const m = bLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (aLines[i] === bLines[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  const lines: DiffLine[] = [];
  let additions = 0;
  let removals = 0;
  let i = 0;
  let j = 0;

  while (i < n && j < m) {
    if (aLines[i] === bLines[j]) {
      lines.push({
        type: 'context',
        oldLine: i + 1,
        newLine: j + 1,
        content: aLines[i],
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      lines.push({ type: 'remove', oldLine: i + 1, content: aLines[i] });
      removals++;
      i++;
    } else {
      lines.push({ type: 'add', newLine: j + 1, content: bLines[j] });
      additions++;
      j++;
    }
  }
  while (i < n) {
    lines.push({ type: 'remove', oldLine: i + 1, content: aLines[i] });
    removals++;
    i++;
  }
  while (j < m) {
    lines.push({ type: 'add', newLine: j + 1, content: bLines[j] });
    additions++;
    j++;
  }

  return { additions, removals, lines };
}

/**
 * Render a diff as ANSI-colored text, showing only changed regions with
 * a few lines of context. Limits total output to `maxLines` to avoid
 * flooding the terminal for large edits.
 */
export function renderDiff(diff: DiffSummary, maxLines: number = 30, context: number = 2): string {
  // Mark which lines are "interesting" (change + surrounding context)
  const keep = new Set<number>();
  for (let idx = 0; idx < diff.lines.length; idx++) {
    if (diff.lines[idx].type !== 'context') {
      for (let k = Math.max(0, idx - context); k <= Math.min(diff.lines.length - 1, idx + context); k++) {
        keep.add(k);
      }
    }
  }

  const shown: string[] = [];
  let lastIdx = -2;
  let rendered = 0;
  let truncated = false;

  const maxLineNum = diff.lines.reduce((acc, l) => {
    const n = Math.max(l.oldLine ?? 0, l.newLine ?? 0);
    return Math.max(acc, n);
  }, 0);
  const pad = String(maxLineNum).length;

  for (let idx = 0; idx < diff.lines.length; idx++) {
    if (!keep.has(idx)) continue;

    if (rendered >= maxLines) {
      truncated = true;
      break;
    }

    // Separator between non-adjacent hunks
    if (lastIdx >= 0 && idx - lastIdx > 1) {
      shown.push(chalk.dim('       ⋮'));
    }

    const line = diff.lines[idx];
    const lineNum = line.type === 'remove' ? line.oldLine : line.newLine;
    const numStr = String(lineNum ?? '').padStart(pad);

    // Truncate very long lines
    const content = line.content.length > 200 ? line.content.slice(0, 200) + '…' : line.content;

    if (line.type === 'add') {
      shown.push(`     ${chalk.green(numStr + ' +')} ${chalk.green(content)}`);
    } else if (line.type === 'remove') {
      shown.push(`     ${chalk.red(numStr + ' -')} ${chalk.red(content)}`);
    } else {
      shown.push(`     ${chalk.dim(numStr + '  ')} ${chalk.dim(content)}`);
    }

    lastIdx = idx;
    rendered++;
  }

  if (truncated) {
    shown.push(chalk.dim(`       … (diff truncated)`));
  }

  return shown.join('\n');
}

/**
 * Format the one-line summary, e.g.
 *   "with 3 additions and 1 removal"
 */
export function formatDiffSummary(diff: DiffSummary): string {
  const parts: string[] = [];
  if (diff.additions > 0) {
    parts.push(`${diff.additions} addition${diff.additions === 1 ? '' : 's'}`);
  }
  if (diff.removals > 0) {
    parts.push(`${diff.removals} removal${diff.removals === 1 ? '' : 's'}`);
  }
  if (parts.length === 0) return 'no changes';
  return parts.join(' and ');
}
