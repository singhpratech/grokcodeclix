import chalk from 'chalk';
import * as readline from 'readline';

export interface SelectorOption {
  label: string;
  value: string;
  description?: string;
}

export async function interactiveSelect(
  title: string,
  options: SelectorOption[],
  currentValue?: string
): Promise<string | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0;

    // Find current value index
    if (currentValue) {
      const idx = options.findIndex(o => o.value === currentValue);
      if (idx >= 0) selectedIndex = idx;
    }

    const render = () => {
      // Clear previous render
      process.stdout.write('\x1B[?25l'); // Hide cursor

      // Move up and clear lines if not first render
      const totalLines = options.length + 2;
      process.stdout.write(`\x1B[${totalLines}A`);

      // Title
      console.log(chalk.bold(title));
      console.log(chalk.dim('↑↓/Tab to navigate, Enter to select, Esc to cancel'));

      // Options
      for (let i = 0; i < options.length; i++) {
        const opt = options[i];
        const isSelected = i === selectedIndex;
        const isCurrent = opt.value === currentValue;

        const pointer = isSelected ? chalk.cyan('❯') : ' ';
        const label = isSelected ? chalk.cyan.bold(opt.label) : opt.label;
        const current = isCurrent ? chalk.white(' (current)') : '';
        const desc = opt.description ? chalk.dim(` - ${opt.description}`) : '';

        console.log(`${pointer} ${label}${current}${desc}`);
      }
    };

    // Initial render with padding
    console.log(chalk.bold(title));
    console.log(chalk.dim('↑↓/Tab to navigate, Enter to select, Esc to cancel'));
    for (const opt of options) {
      const isCurrent = opt.value === currentValue;
      const current = isCurrent ? chalk.white(' (current)') : '';
      const desc = opt.description ? chalk.dim(` - ${opt.description}`) : '';
      console.log(`  ${opt.label}${current}${desc}`);
    }

    // Now render with selection
    render();

    // Set up raw mode for key input
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (key: Buffer) => {
      const char = key.toString();

      // Arrow up or k
      if (char === '\x1B[A' || char === 'k') {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        render();
      }
      // Arrow down or j
      else if (char === '\x1B[B' || char === 'j') {
        selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        render();
      }
      // Tab - cycle forward
      else if (char === '\t') {
        selectedIndex = (selectedIndex + 1) % options.length;
        render();
      }
      // Shift+Tab - cycle backward (usually \x1B[Z)
      else if (char === '\x1B[Z') {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        render();
      }
      // Enter
      else if (char === '\r' || char === '\n') {
        cleanup();
        resolve(options[selectedIndex].value);
      }
      // Escape or q
      else if (char === '\x1B' || char === 'q') {
        cleanup();
        resolve(null);
      }
      // Ctrl+C
      else if (char === '\x03') {
        cleanup();
        resolve(null);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
      process.stdout.write('\x1B[?25h'); // Show cursor
      console.log(); // New line after selection
    };

    process.stdin.on('data', onKeypress);
  });
}

// Simple yes/no confirmation
export async function confirm(message: string, defaultYes = true): Promise<boolean> {
  return new Promise((resolve) => {
    const hint = defaultYes ? '[Y/n]' : '[y/N]';
    process.stdout.write(`${message} ${chalk.dim(hint)} `);

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();

    const onKeypress = (key: Buffer) => {
      const char = key.toString().toLowerCase();

      if (char === 'y') {
        cleanup();
        console.log(chalk.white('Yes'));
        resolve(true);
      } else if (char === 'n') {
        cleanup();
        console.log(chalk.red('No'));
        resolve(false);
      } else if (char === '\r' || char === '\n') {
        cleanup();
        console.log(defaultYes ? chalk.white('Yes') : chalk.red('No'));
        resolve(defaultYes);
      } else if (char === '\x03' || char === '\x1B') {
        cleanup();
        console.log(chalk.red('Cancelled'));
        resolve(false);
      }
    };

    const cleanup = () => {
      process.stdin.removeListener('data', onKeypress);
      if (process.stdin.isTTY) {
        process.stdin.setRawMode(false);
      }
    };

    process.stdin.on('data', onKeypress);
  });
}
