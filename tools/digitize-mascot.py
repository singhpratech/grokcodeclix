#!/usr/bin/env python3
"""
Convert mascot.png to ANSI terminal art using Unicode half-block (▀).
Each row of characters represents 2 vertical pixels:
  - foreground colour = top pixel
  - background colour = bottom pixel
This doubles vertical resolution. We trim transparent / near-transparent
edges and crop to non-empty bounds before resizing.
Output: a TypeScript file with the art as a string constant.
"""

import sys
from PIL import Image
from pathlib import Path

SRC = Path('/home/papapratlinux/Documents/grokcodeclix/docs/assets/mascot.png')
DST_TS = Path('/home/papapratlinux/Documents/grokcodeclix/src/utils/mascot.ts')

# Target terminal cell dimensions. Each cell is 1 char wide and represents
# 2 pixels vertically. Aim for ~28 cells wide so the welcome banner fits in
# any reasonably sized terminal.
TARGET_W = 30
# Maintain aspect: image is square 1024x1024 → we want roughly square cells.
# Terminal cells are taller than wide (~2:1), so for a square image we want
# pixel_rows ≈ pixel_cols, i.e. cell_rows = pixel_rows/2.
TARGET_H = 30  # pixel rows; will be ceil(30/2) = 15 cell rows


def trim_to_subject(img: Image.Image) -> Image.Image:
    """Crop the background out to focus on the character.

    Handles both dark (3D render) and bright/white (flat vector logo)
    backgrounds by sampling the four corners. If they agree on a colour
    that's the background.
    """
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size

    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]

    def close(a, b, tol=22):
        return all(abs(a[i] - b[i]) <= tol for i in range(3))

    bg = corners[0] if all(close(corners[0], c) for c in corners[1:]) else None

    def is_background(c):
        if bg is not None:
            return close(c, bg, tol=24)
        # Fall back to dark-pixel heuristic.
        r, g, b = c
        return r + g + b < 165

    # Find subject bounding box by columns/rows that have at least one
    # non-background pixel.
    cols = []
    for x in range(w):
        for y in range(h):
            if not is_background(px[x, y]):
                cols.append(x)
                break
    rows = []
    for y in range(h):
        for x in range(w):
            if not is_background(px[x, y]):
                rows.append(y)
                break

    if not cols or not rows:
        return rgb
    left, right = max(0, min(cols) - 8), min(w, max(cols) + 8)
    top, bot = max(0, min(rows) - 8), min(h, max(rows) + 8)
    return rgb.crop((left, top, right, bot))


def make_ansi(img: Image.Image, target_w: int, target_h: int, bg_color=None) -> str:
    """Render image as Unicode upper-half-block (▀) ANSI art.

    Each cell encodes 2 stacked pixels: foreground = top, background = bottom.
    If ``bg_color`` is provided, pixels close to it are treated as transparent
    — that cell is rendered with default fg/bg so the mascot floats on the
    user's actual terminal background.
    """
    if target_h % 2 == 1:
        target_h += 1

    iw, ih = img.size
    aspect = ih / iw
    pixel_w = target_w
    pixel_h = max(1, round(pixel_w * aspect))
    if pixel_h % 2 == 1:
        pixel_h += 1
    pixel_h = min(pixel_h, target_h)

    img = img.resize((pixel_w, pixel_h), Image.LANCZOS).convert('RGB')

    def is_bg(c, tol=24):
        if bg_color is None:
            return False
        return all(abs(c[i] - bg_color[i]) <= tol for i in range(3))

    out_lines = []
    pixels = img.load()
    for y in range(0, pixel_h, 2):
        line = ''
        for x in range(pixel_w):
            top = pixels[x, y]
            bot = pixels[x, y + 1] if (y + 1) < pixel_h else top
            top_bg = is_bg(top)
            bot_bg = is_bg(bot)

            line += '\x1b[0m'  # reset between cells (cheap, robust)
            if top_bg and bot_bg:
                line += ' '   # both transparent
            elif top_bg and not bot_bg:
                # Show only bottom — use ▄ (lower-half) with bottom as fg
                line += f'\x1b[38;2;{bot[0]};{bot[1]};{bot[2]}m▄'
            elif not top_bg and bot_bg:
                # Show only top — use ▀ (upper-half) with top as fg
                line += f'\x1b[38;2;{top[0]};{top[1]};{top[2]}m▀'
            else:
                line += (
                    f'\x1b[38;2;{top[0]};{top[1]};{top[2]}m'
                    f'\x1b[48;2;{bot[0]};{bot[1]};{bot[2]}m▀'
                )
        line += '\x1b[0m'
        out_lines.append(line)
    return '\n'.join(out_lines)


def detect_bg_colour(img: Image.Image):
    """Return the (r,g,b) corner-sampled background colour, or None."""
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]

    def close(a, b, tol=22):
        return all(abs(a[i] - b[i]) <= tol for i in range(3))

    if all(close(corners[0], c) for c in corners[1:]):
        return tuple(corners[0])
    return None


def main():
    print(f'Reading {SRC}…')
    img = Image.open(SRC)
    print(f'  original size: {img.size}')
    bg = detect_bg_colour(img)
    print(f'  detected bg: {bg}')
    cropped = trim_to_subject(img)
    print(f'  after subject crop: {cropped.size}')
    art = make_ansi(cropped, TARGET_W, TARGET_H, bg_color=bg)

    # Print a preview to stdout
    print('\n=== Preview (will look right on a 24-bit colour terminal) ===\n')
    print(art)
    print()

    # Emit TypeScript module with the art baked as an escape-encoded string.
    # We use String.fromCharCode(27) for ESC so the source stays plain UTF-8.
    js_safe = (
        art.replace('\\', '\\\\')
           .replace('`', '\\`')
           .replace('\x1b', '\\x1b')
    )
    ts = (
        '/**\n'
        ' * Naavi GrokAavi terminal-mascot.\n'
        ' *\n'
        ' * Auto-generated from docs/assets/mascot.png by tools/digitize-mascot.py.\n'
        ' * Each line is a row of Unicode upper-half-block characters (▀) where\n'
        ' * the foreground colour represents the top pixel and the background\n'
        ' * colour represents the bottom pixel — so each cell is 1×2 image\n'
        ' * pixels. Uses 24-bit colour escapes so it requires a true-colour\n'
        ' * terminal (modern terminals all support this).\n'
        ' *\n'
        ' * To regenerate: python3 tools/digitize-mascot.py\n'
        ' */\n\n'
        f'export const NAAVI_MASCOT = `{js_safe}`;\n'
    )
    DST_TS.parent.mkdir(parents=True, exist_ok=True)
    DST_TS.write_text(ts)
    print(f'\n✓ Wrote {DST_TS} ({len(ts)} bytes)')


if __name__ == '__main__':
    main()
