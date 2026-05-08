import { ToolResult } from './registry.js';
import chalk from 'chalk';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

export interface TodoWriteParams {
  todos: TodoItem[];
}

/**
 * In-memory todo list owned by the chat session. The TodoWrite tool
 * replaces this list wholesale on each call (matching Claude Code).
 */
export const todoState: { items: TodoItem[] } = { items: [] };

const SAFFRON = chalk.hex('#FF9933');
const INDIA_GREEN = chalk.hex('#138808');

function statusBadge(status: TodoStatus): string {
  switch (status) {
    case 'completed':
      return INDIA_GREEN('✔');
    case 'in_progress':
      return SAFFRON('●');
    case 'pending':
    default:
      return chalk.dim('○');
  }
}

export function renderTodoList(items: TodoItem[]): string {
  if (items.length === 0) return chalk.dim('  (no todos)');
  const lines: string[] = [];
  for (const t of items) {
    const text =
      t.status === 'completed'
        ? chalk.dim.strikethrough(t.content)
        : t.status === 'in_progress'
          ? chalk.bold(t.activeForm || t.content)
          : t.content;
    lines.push(`  ${statusBadge(t.status)} ${text}`);
  }
  return lines.join('\n');
}

export async function todoWriteTool(params: TodoWriteParams): Promise<ToolResult> {
  if (!params.todos || !Array.isArray(params.todos)) {
    return { success: false, output: '', error: 'todos must be an array' };
  }

  const valid: TodoItem[] = [];
  for (const t of params.todos) {
    if (typeof t?.content !== 'string' || !t.content.trim()) {
      return { success: false, output: '', error: 'each todo must have a non-empty content string' };
    }
    if (!['pending', 'in_progress', 'completed'].includes(t.status)) {
      return { success: false, output: '', error: `invalid status "${t.status}" — must be pending|in_progress|completed` };
    }
    valid.push({
      content: t.content.trim(),
      status: t.status,
      activeForm: t.activeForm?.trim() || undefined,
    });
  }

  const inProgress = valid.filter((t) => t.status === 'in_progress').length;
  if (inProgress > 1) {
    return {
      success: false,
      output: '',
      error: `Only one todo may be in_progress at a time (found ${inProgress}). Mark the others pending or completed.`,
    };
  }

  todoState.items = valid;

  const summary =
    `${valid.filter((t) => t.status === 'completed').length}/${valid.length} done` +
    (inProgress ? ` · 1 in progress` : '');

  return {
    success: true,
    output: `Updated todo list (${valid.length} item${valid.length === 1 ? '' : 's'}, ${summary})`,
    display: {
      summary: `Todos · ${summary}`,
      preview: renderTodoList(valid),
    },
  };
}
