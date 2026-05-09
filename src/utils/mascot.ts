/**
 * Naavi GrokAavi terminal-mascot.
 *
 * Inspired by Claude Code's approach: Claude uses a single `✻` glyph as
 * its "mascot" — minimal, iconic, and impossible to render badly because
 * it's just one Unicode character at native font weight. We tried four
 * different ANSI-art digitizers (half-block, quarter-block, brand-snap
 * palette, k-means cluster) and every one looked muddy at the cell counts
 * that fit above the welcome box. Claude wins by not trying.
 *
 * So we follow suit: a single saffron `✻` accent line above the welcome
 * box, with a subtle India-green flourish on either side. No pixel art.
 * The `Welcome to Grok Code!` line inside the box already includes its
 * own `✻` (matching Claude's `✻ Welcome to Claude Code!`), so this
 * top-line accent is the "mascot" — a quiet brand mark, nothing more.
 */

const SAFFRON = '\x1b[38;2;255;153;51m';
const GREEN   = '\x1b[38;2;19;136;8m';
const DIM     = '\x1b[2m';
const RESET   = '\x1b[0m';

export const NAAVI_MASCOT =
  `${DIM}${GREEN}✦${RESET}  ${SAFFRON}✻${RESET}  ${DIM}${GREEN}✦${RESET}`;
