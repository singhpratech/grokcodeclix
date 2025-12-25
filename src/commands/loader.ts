/**
 * Custom Commands Loader
 *
 * Loads custom slash commands from:
 * - .grok/commands/ (project-specific)
 * - ~/.grok/commands/ (user-specific)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import chalk from 'chalk';

export interface CustomCommand {
  name: string;
  description: string;
  content: string;
  source: 'project' | 'user';
  filePath: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
}

interface CommandFrontmatter {
  description?: string;
  'argument-hint'?: string;
  'allowed-tools'?: string;
  model?: string;
}

/**
 * Parse frontmatter from markdown content
 */
function parseFrontmatter(content: string): { frontmatter: CommandFrontmatter; body: string } {
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const frontmatter: CommandFrontmatter = {};
  const lines = match[1].split('\n');

  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      (frontmatter as any)[key] = value;
    }
  }

  return { frontmatter, body: match[2] };
}

/**
 * Load commands from a directory
 */
async function loadCommandsFromDir(
  dir: string,
  source: 'project' | 'user',
  namespace?: string
): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recurse into subdirectories with namespace
        const subCommands = await loadCommandsFromDir(
          fullPath,
          source,
          namespace ? `${namespace}:${entry.name}` : entry.name
        );
        commands.push(...subCommands);
      } else if (entry.name.endsWith('.md')) {
        // Load markdown command file
        try {
          const content = await fs.readFile(fullPath, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          const name = entry.name.replace(/\.md$/, '');
          const fullName = namespace ? `${name}` : name;

          commands.push({
            name: fullName,
            description: frontmatter.description || `Custom command from ${source}`,
            content: body.trim(),
            source,
            filePath: fullPath,
            argumentHint: frontmatter['argument-hint'],
            allowedTools: frontmatter['allowed-tools']?.split(',').map(s => s.trim()),
            model: frontmatter.model,
          });
        } catch (err) {
          // Skip files that can't be read
          console.error(chalk.yellow(`Warning: Could not load command ${fullPath}`));
        }
      }
    }
  } catch {
    // Directory doesn't exist, return empty
  }

  return commands;
}

/**
 * Load all custom commands
 */
export async function loadCustomCommands(): Promise<CustomCommand[]> {
  const commands: CustomCommand[] = [];

  // Load project commands
  const projectDir = path.join(process.cwd(), '.grok', 'commands');
  const projectCommands = await loadCommandsFromDir(projectDir, 'project');
  commands.push(...projectCommands);

  // Load user commands
  const userDir = path.join(os.homedir(), '.grok', 'commands');
  const userCommands = await loadCommandsFromDir(userDir, 'user');

  // User commands only added if not overridden by project
  for (const cmd of userCommands) {
    if (!commands.find(c => c.name === cmd.name)) {
      commands.push(cmd);
    }
  }

  return commands;
}

/**
 * Process command arguments
 */
export function processCommandArgs(content: string, args: string): string {
  let result = content;

  // Replace $ARGUMENTS with all args
  result = result.replace(/\$ARGUMENTS/g, args);

  // Replace $1, $2, etc. with individual args
  const argList = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < argList.length; i++) {
    result = result.replace(new RegExp(`\\$${i + 1}`, 'g'), argList[i]);
  }

  // Process bash execution (!`command`)
  result = result.replace(/!\`([^`]+)\`/g, (_, cmd) => {
    // Return placeholder - actual execution happens in chat
    return `[Execute: ${cmd}]`;
  });

  // Process file references (@path)
  result = result.replace(/@([^\s]+)/g, (_, filePath) => {
    return `[Read file: ${filePath}]`;
  });

  return result;
}

/**
 * Get command help text
 */
export function getCommandHelp(commands: CustomCommand[]): string {
  if (commands.length === 0) {
    return chalk.gray('No custom commands found.');
  }

  const lines: string[] = [];
  const projectCmds = commands.filter(c => c.source === 'project');
  const userCmds = commands.filter(c => c.source === 'user');

  if (projectCmds.length > 0) {
    lines.push(chalk.bold('Project Commands:'));
    for (const cmd of projectCmds) {
      const hint = cmd.argumentHint ? chalk.gray(` ${cmd.argumentHint}`) : '';
      lines.push(`  /${cmd.name}${hint}`);
      lines.push(`    ${chalk.gray(cmd.description)}`);
    }
    lines.push('');
  }

  if (userCmds.length > 0) {
    lines.push(chalk.bold('User Commands:'));
    for (const cmd of userCmds) {
      const hint = cmd.argumentHint ? chalk.gray(` ${cmd.argumentHint}`) : '';
      lines.push(`  /${cmd.name}${hint}`);
      lines.push(`    ${chalk.gray(cmd.description)}`);
    }
  }

  return lines.join('\n');
}

/**
 * Initialize custom commands directory structure
 */
export async function initCommandsDir(): Promise<void> {
  const projectDir = path.join(process.cwd(), '.grok', 'commands');

  try {
    await fs.mkdir(projectDir, { recursive: true });

    // Create example command
    const examplePath = path.join(projectDir, 'review.md');
    try {
      await fs.access(examplePath);
    } catch {
      await fs.writeFile(examplePath, `---
description: Review the current code changes
argument-hint: [focus-area]
---

Please review the recent code changes in this project.

Focus on:
- Code quality and best practices
- Potential bugs or issues
- Security concerns
- Performance implications

$ARGUMENTS
`);
    }

    // Create .gitignore for commands
    const gitignorePath = path.join(process.cwd(), '.grok', '.gitignore');
    try {
      await fs.access(gitignorePath);
    } catch {
      await fs.writeFile(gitignorePath, `# Ignore local-only files
*.local.md
`);
    }
  } catch (err) {
    // Ignore errors
  }
}
