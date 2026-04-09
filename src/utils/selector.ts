import chalk from 'chalk';

export interface SelectorOption {
  label: string;
  value: string;
  description?: string;
}

const MAX_VISIBLE = 12;

/**
 * Interactive single-select list with a scrolling window.
 *
 * Renders a fixed number of visible rows (up to MAX_VISIBLE) and scrolls
 * the window as the user moves up/down. Shows "↑ N more" / "↓ N more"
 * indicators when the full list doesn't fit. Wraps around at edges.
 *
 * Returns the selected `value` or `null` if cancelled (Esc / q / Ctrl+C).
 */
export async function interactiveSelect(
  title: string,
  options: SelectorOption[],
  currentValue?: string
): Promise<string | null> {
  if (options.length === 0) return null;

  return new Promise((resolve) => {
    let selectedIndex = 0;
    if (currentValue) {
      const idx = options.findIndex((o) => o.value === currentValue);
      if (idx >= 0) selectedIndex = idx;
    }

    // How many rows of options we can show at once
    const visible = Math.min(options.length, MAX_VISIBLE);
    // Scroll offset (top of visible window)
    let scrollOffset = Math.max(0, Math.min(selectedIndex - Math.floor(visible / 2), options.length - visible));

    // Track how many lines our previous render occupied so we can erase it
    let prevRenderLines = 0;

    const updateScroll = () => {
      if (selectedIndex < scrollOffset) scrollOffset = selectedIndex;
      if (selectedIndex >= scrollOffset + visible) scrollOffset = selectedIndex - visible + 1;
      scrollOffset = Math.max(0, Math.min(scrollOffset, options.length - visible));
    };

    const erase = () => {
      if (prevRenderLines === 0) return;
      // Move cursor up prevRenderLines then clear to end of screen
      process.stdout.write(`\x1B[${prevRenderLines}A\r\x1B[J`);
      prevRenderLines = 0;
    };

    const render = (isFirst: boolean = false) => {
      if (!isFirst) erase();

      const lines: string[] = [];

      // Title
      if (title) lines.push(chalk.bold(title));
      lines.push(chalk.dim('↑↓/Tab to navigate · Enter to select · Esc to cancel'));

      // "More above" indicator
      if (scrollOffset > 0) {
        lines.push(chalk.dim(`  ↑ ${scrollOffset} more above`));
      }

      const end = Math.min(options.length, scrollOffset + visible);
      for (let i = scrollOffset; i < end; i++) {
        const opt = options[i];
        const isSelected = i === selectedIndex;
        const isCurrent = opt.value === currentValue;

        const pointer = isSelected ? chalk.cyan('❯') : ' ';
        const label = isSelected ? chalk.cyan.bold(opt.label) : opt.label;
        const currentTag = isCurrent ? chalk.white(' (current)') : '';
        const desc = opt.description
          ? (isSelected ? chalk.white(' — ') + chalk.dim(opt.description) : chalk.dim(' — ' + opt.description))
          : '';
        lines.push(`${pointer} ${label}${currentTag}${desc}`);
      }

      // "More below" indicator
      if (end < options.length) {
        lines.push(chalk.dim(`  ↓ ${options.length - end} more below`));
      }

      // Position indicator
      lines.push(chalk.dim(`  ${selectedIndex + 1}/${options.length}`));

      process.stdout.write('\x1B[?25l'); // hide cursor
      process.stdout.write(lines.join('\n') + '\n');
      prevRenderLines = lines.length;
    };

    // Initial render (no erase)
    render(true);

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
        updateScroll();
        render();
      }
      // Arrow down or j
      else if (char === '\x1B[B' || char === 'j') {
        selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0;
        updateScroll();
        render();
      }
      // Page Up — move by visible window
      else if (char === '\x1B[5~') {
        selectedIndex = Math.max(0, selectedIndex - visible);
        updateScroll();
        render();
      }
      // Page Down
      else if (char === '\x1B[6~') {
        selectedIndex = Math.min(options.length - 1, selectedIndex + visible);
        updateScroll();
        render();
      }
      // Home
      else if (char === '\x1B[H' || char === '\x1B[1~') {
        selectedIndex = 0;
        updateScroll();
        render();
      }
      // End
      else if (char === '\x1B[F' || char === '\x1B[4~') {
        selectedIndex = options.length - 1;
        updateScroll();
        render();
      }
      // Tab — cycle forward
      else if (char === '\t') {
        selectedIndex = (selectedIndex + 1) % options.length;
        updateScroll();
        render();
      }
      // Shift+Tab — cycle backward
      else if (char === '\x1B[Z') {
        selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1;
        updateScroll();
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
      process.stdout.write('\x1B[?25h'); // show cursor
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
