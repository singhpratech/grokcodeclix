#!/usr/bin/env python3
"""
Convert mascot.png to ANSI terminal art using Unicode quarter-block glyphs.

Strategy that finally produces a clean iconic render at 16-cell width:

  1. Crop to the subject so the face fills the frame.
  2. **Quantize to a 6-colour brand palette FIRST** — saffron, india-green,
     deep blue, amber, white, black. This snaps every anti-aliased edge in
     the source PNG to a crisp brand colour and eliminates the muddy
     mid-tones that were turning the per-cell two-colour clustering into
     noise.
  3. Resize to (TARGET_W * 2) × (TARGET_W * 2) using NEAREST so the snap
     from step 2 survives the downsample.
  4. For each 2×2 pixel block, the four pixels are already palette
     colours, so the dominant colour is just a count. Pick the two most
     common as fg/bg and render the matching quadrant glyph.
  5. Skip cells whose pixels are all the page-background colour so the
     mascot floats on the user's terminal background.

Run after editing mascot.png:
    python3 tools/digitize-mascot.py
"""

from PIL import Image
from pathlib import Path
from collections import Counter

SRC = Path('/home/papapratlinux/Documents/grokcodeclix/docs/assets/mascot.png')
DST_TS = Path('/home/papapratlinux/Documents/grokcodeclix/src/utils/mascot.ts')

TARGET_W = 16    # cell columns. With quarter-block this is 32px-wide subject
                 # coverage. Width × 1× cell-rows is the rendered art size.

# Brand palette — every output pixel snaps to one of these. Order matters
# only insofar as RGB exactness. Background sentinel is added below.
BRAND = [
    (255, 255, 255),  # white   — hair, highlights
    ( 18,  18,  18),  # black   — outline (slightly off-pure-black to read)
    (255, 153,  51),  # saffron — face markings, smile (#FF9933)
    ( 19, 136,   8),  # india-green — bindi dots (#138808)
    ( 30,  58, 138),  # deep blue — face (#1E3A8A)
    (255, 191,   0),  # amber   — eyes, ear tips
]


def detect_bg_colour(img: Image.Image):
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size
    corners = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]

    def close(a, b, tol=18):
        return all(abs(a[i] - b[i]) <= tol for i in range(3))

    if all(close(corners[0], c) for c in corners[1:]):
        return tuple(corners[0])
    return None


def trim_to_subject(img: Image.Image, bg) -> Image.Image:
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size

    def is_background(c):
        if bg is None:
            r, g, b = c
            return r + g + b > 720
        return all(abs(c[i] - bg[i]) <= 22 for i in range(3))

    cols, rows = [], []
    for x in range(w):
        for y in range(h):
            if not is_background(px[x, y]):
                cols.append(x)
                break
    for y in range(h):
        for x in range(w):
            if not is_background(px[x, y]):
                rows.append(y)
                break
    if not cols or not rows:
        return rgb
    pad = 6
    return rgb.crop((
        max(0, min(cols) - pad),
        max(0, min(rows) - pad),
        min(w, max(cols) + pad),
        min(h, max(rows) + pad),
    ))


def quantize_to_brand(img: Image.Image, bg) -> Image.Image:
    """Snap every pixel to its nearest brand colour, EXCEPT pixels that
    match the page background — those stay as the bg sentinel so we can
    skip them at render time."""
    rgb = img.convert('RGB')
    out = Image.new('RGB', rgb.size)
    src = rgb.load()
    dst = out.load()
    w, h = rgb.size

    bg_sentinel = (1, 1, 1)  # sentinel triple we know is not in BRAND

    for y in range(h):
        for x in range(w):
            c = src[x, y]
            # Page-background pixels stay transparent.
            if bg is not None and all(abs(c[i] - bg[i]) <= 24 for i in range(3)):
                dst[x, y] = bg_sentinel
                continue
            # Otherwise: nearest brand colour.
            best, best_d = BRAND[0], 1 << 30
            for p in BRAND:
                d = (c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 + (c[2] - p[2]) ** 2
                if d < best_d:
                    best_d = d
                    best = p
            dst[x, y] = best
    return out


# Quadrant masks: (TL, TR, BL, BR) → glyph
GLYPHS = {
    (0, 0, 0, 0): ' ',
    (1, 0, 0, 0): '▘',
    (0, 1, 0, 0): '▝',
    (1, 1, 0, 0): '▀',
    (0, 0, 1, 0): '▖',
    (1, 0, 1, 0): '▌',
    (0, 1, 1, 0): '▞',
    (1, 1, 1, 0): '▛',
    (0, 0, 0, 1): '▗',
    (1, 0, 0, 1): '▚',
    (0, 1, 0, 1): '▐',
    (1, 1, 0, 1): '▜',
    (0, 0, 1, 1): '▄',
    (1, 0, 1, 1): '▙',
    (0, 1, 1, 1): '▟',
    (1, 1, 1, 1): '█',
}

BG_SENTINEL = (1, 1, 1)


def make_ansi(img: Image.Image, target_w: int) -> str:
    iw, ih = img.size
    aspect = ih / iw

    pixel_w = target_w * 2
    pixel_h = max(2, round(pixel_w * aspect))
    if pixel_h % 2 == 1:
        pixel_h += 1

    # Halve pixel_h so cell-grid is roughly square in physical terminal pixels
    # (terminal cells are about twice as tall as wide).
    pixel_h_render = max(2, pixel_h // 2)
    if pixel_h_render % 2 == 1:
        pixel_h_render += 1

    img = img.resize((pixel_w, pixel_h_render), Image.NEAREST).convert('RGB')

    out_lines = []
    pixels = img.load()
    target_h_cells = pixel_h_render // 2
    for cy in range(target_h_cells):
        line = ''
        for cx in range(target_w):
            x0, y0 = cx * 2, cy * 2
            quad = (
                pixels[x0, y0],
                pixels[x0 + 1, y0],
                pixels[x0, y0 + 1],
                pixels[x0 + 1, y0 + 1],
            )

            if all(p == BG_SENTINEL for p in quad):
                line += '\x1b[0m '
                continue

            # Count occurrences of each colour. Background sentinel is
            # treated specially — it represents transparency.
            counts = Counter(quad)
            ordered = counts.most_common()

            real_colours = [c for c, _ in ordered if c != BG_SENTINEL]
            if not real_colours:
                line += '\x1b[0m '
                continue

            fg = real_colours[0]
            # Build mask: 1 where pixel == fg, 0 elsewhere.
            mask = tuple(1 if p == fg else 0 for p in quad)
            glyph = GLYPHS[mask]

            # Background colour: the second most common real colour, or
            # transparent (the page background) if only fg is present.
            if len(real_colours) >= 2:
                bg = real_colours[1]
                line += (
                    f'\x1b[0m'
                    f'\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m'
                    f'\x1b[48;2;{bg[0]};{bg[1]};{bg[2]}m'
                    f'{glyph}'
                )
            else:
                # Only fg is real. Either some quadrants are bg (transparent),
                # or all quadrants are fg.
                if all(p == fg for p in quad):
                    line += f'\x1b[0m\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m█'
                else:
                    line += f'\x1b[0m\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m{glyph}'
        line += '\x1b[0m'
        out_lines.append(line)
    return '\n'.join(out_lines)


def main():
    print(f'Reading {SRC}…')
    img = Image.open(SRC)
    print(f'  original size: {img.size}')

    bg = detect_bg_colour(img)
    print(f'  detected bg: {bg}')

    cropped = trim_to_subject(img, bg)
    print(f'  after subject crop: {cropped.size}')

    # Re-detect bg on the cropped image — corners may have shifted.
    bg2 = detect_bg_colour(cropped) or bg

    quantized = quantize_to_brand(cropped, bg2)
    print(f'  quantized to {len(BRAND)}-colour brand palette')

    art = make_ansi(quantized, TARGET_W)

    print('\n=== Preview (true-colour terminal required) ===\n')
    print(art)
    print()

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
        ' * Each cell is one Unicode quarter-block glyph (▘▝▀▖▌▞▛▗▚▐▜▄▙▟█) that\n'
        ' * encodes a 2×2 pixel block. Source is pre-quantized to a 6-colour\n'
        ' * brand palette (saffron, india-green, deep blue, amber, white, black)\n'
        ' * before downsampling, so each cell ends up rendering with at most two\n'
        ' * distinct brand colours instead of muddy mid-tones.\n'
        ' *\n'
        ' * To regenerate: python3 tools/digitize-mascot.py\n'
        ' */\n\n'
        f'export const NAAVI_MASCOT = `{js_safe}`;\n'
    )
    DST_TS.parent.mkdir(parents=True, exist_ok=True)
    DST_TS.write_text(ts)
    print(f'✓ Wrote {DST_TS} ({len(ts)} bytes)')


if __name__ == '__main__':
    main()
