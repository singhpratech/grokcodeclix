import { ChildProcess, spawn } from 'child_process';
import { ToolResult } from './registry.js';
import { sanitizeOutput, validateCommand } from '../utils/security.js';

export interface BackgroundProcess {
  id: string;
  command: string;
  child: ChildProcess;
  stdoutBuffer: string;
  stderrBuffer: string;
  status: 'running' | 'completed' | 'killed' | 'failed';
  exitCode: number | null;
  startedAt: number;
  /** Cursor used by BashOutput to return only new bytes */
  stdoutCursor: number;
  stderrCursor: number;
}

const MAX_BG_OUTPUT = 1024 * 1024; // 1MB per stream
const processes = new Map<string, BackgroundProcess>();
let nextId = 1;

function genId(): string {
  return `bash_${nextId++}`;
}

export function listBackgroundProcesses(): BackgroundProcess[] {
  return Array.from(processes.values());
}

export interface BashBgStartParams {
  command: string;
  cwd?: string;
}

export function startBackgroundBash(params: BashBgStartParams): ToolResult {
  const security = validateCommand(params.command);
  if (!security.allowed) {
    return {
      success: false,
      output: '',
      error: `Security: ${security.reason}${security.suggestion ? ` - ${security.suggestion}` : ''}`,
    };
  }

  const id = genId();
  let child: ChildProcess;
  try {
    child = spawn('bash', ['-c', params.command], {
      cwd: params.cwd || process.cwd(),
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
      detached: false,
    });
  } catch (error) {
    return { success: false, output: '', error: `Failed to spawn: ${(error as Error).message}` };
  }

  const proc: BackgroundProcess = {
    id,
    command: params.command,
    child,
    stdoutBuffer: '',
    stderrBuffer: '',
    status: 'running',
    exitCode: null,
    startedAt: Date.now(),
    stdoutCursor: 0,
    stderrCursor: 0,
  };

  child.stdout?.on('data', (d) => {
    if (proc.stdoutBuffer.length < MAX_BG_OUTPUT) {
      proc.stdoutBuffer += d.toString();
    }
  });
  child.stderr?.on('data', (d) => {
    if (proc.stderrBuffer.length < MAX_BG_OUTPUT) {
      proc.stderrBuffer += d.toString();
    }
  });
  child.on('close', (code) => {
    proc.exitCode = code;
    if (proc.status === 'running') {
      proc.status = code === 0 ? 'completed' : 'failed';
    }
  });
  child.on('error', () => {
    proc.status = 'failed';
  });

  processes.set(id, proc);

  return {
    success: true,
    output: `Started background process ${id}: ${params.command}\nUse BashOutput with bash_id="${id}" to read output, KillBash to stop.`,
    display: { summary: `Background ${id} started` },
  };
}

export interface BashOutputParams {
  bash_id: string;
  filter?: string;
}

export function readBackgroundOutput(params: BashOutputParams): ToolResult {
  const proc = processes.get(params.bash_id);
  if (!proc) {
    return { success: false, output: '', error: `No background process with id "${params.bash_id}"` };
  }

  let stdoutNew = proc.stdoutBuffer.slice(proc.stdoutCursor);
  let stderrNew = proc.stderrBuffer.slice(proc.stderrCursor);
  proc.stdoutCursor = proc.stdoutBuffer.length;
  proc.stderrCursor = proc.stderrBuffer.length;

  if (params.filter) {
    try {
      const re = new RegExp(params.filter);
      stdoutNew = stdoutNew.split('\n').filter((l) => re.test(l)).join('\n');
      stderrNew = stderrNew.split('\n').filter((l) => re.test(l)).join('\n');
    } catch {
      return { success: false, output: '', error: `Invalid regex filter: ${params.filter}` };
    }
  }

  const parts: string[] = [];
  parts.push(`<status>${proc.status}${proc.exitCode !== null ? ` exit=${proc.exitCode}` : ''}</status>`);
  if (stdoutNew) parts.push(`<stdout>\n${sanitizeOutput(stdoutNew)}\n</stdout>`);
  if (stderrNew) parts.push(`<stderr>\n${sanitizeOutput(stderrNew)}\n</stderr>`);
  if (!stdoutNew && !stderrNew) parts.push('<stdout>(no new output)</stdout>');

  return {
    success: true,
    output: parts.join('\n'),
    display: {
      summary: `${proc.id} · ${proc.status}${proc.exitCode !== null ? ` (exit ${proc.exitCode})` : ''}`,
    },
  };
}

export interface KillBashParams {
  bash_id: string;
}

export function killBackgroundBash(params: KillBashParams): ToolResult {
  const proc = processes.get(params.bash_id);
  if (!proc) {
    return { success: false, output: '', error: `No background process with id "${params.bash_id}"` };
  }
  if (proc.status !== 'running') {
    return {
      success: true,
      output: `Process ${proc.id} already ${proc.status}`,
      display: { summary: `${proc.id} not running` },
    };
  }
  try {
    proc.child.kill('SIGTERM');
    setTimeout(() => {
      try {
        if (proc.status === 'running') proc.child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }, 3000);
    proc.status = 'killed';
    return {
      success: true,
      output: `Killed background process ${proc.id}`,
      display: { summary: `${proc.id} killed` },
    };
  } catch (error) {
    return { success: false, output: '', error: `Failed to kill: ${(error as Error).message}` };
  }
}

/** Clean up all background processes — call on shutdown. */
export function killAllBackground(): void {
  for (const proc of processes.values()) {
    if (proc.status === 'running') {
      try {
        proc.child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
    }
  }
}
