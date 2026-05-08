#!/usr/bin/env python3
"""
Convert mascot.png to ANSI terminal art using Unicode quarter-block glyphs.

Each output cell is 1 char × 1 row in the terminal but encodes a 2×2 grid
of source pixels by choosing the right Unicode quadrant glyph (▘▝▀▖▌▞▛▗▚▐▜▄▙▟█)
together with a single foreground + single background colour.  This gives
4× the effective resolution of the simpler half-block render — eyes,
markings, and ear tips become recognisable instead of a colour mush.

Pipeline:
  1. Crop the source down to the subject.
  2. Resize to (TARGET_W * 2) × (TARGET_H * 2) pixels using LANCZOS so each
     output cell maps to a 2×2 pixel block.
  3. For each 2×2 block, pick 2 representative colours (k-means with k=2
     done by largest pairwise distance), assign each pixel to the nearest,
     and emit the glyph that matches the binary pattern.
  4. Skip any block whose pixels all match the corner-detected background
     so the mascot floats on the user's terminal background.

Run after editing mascot.png:
    python3 tools/digitize-mascot.py
"""

from PIL import Image, ImageEnhance
from pathlib import Path

SRC = Path('/home/papapratlinux/Documents/grokcodeclix/docs/assets/mascot.png')
DST_TS = Path('/home/papapratlinux/Documents/grokcodeclix/src/utils/mascot.ts')

TARGET_W = 24    # cell columns. With quarter-block this gives 48px-wide
                 # subject coverage — wide enough for legible features and
                 # narrow enough to sit above the welcome box (62 cols).

# Each tuple: (top-left, top-right, bottom-left, bottom-right) of the cell.
# 1 = foreground, 0 = background.
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


def detect_bg_colour(img: Image.Image):
    """Return the (r,g,b) corner-sampled background colour, or None."""
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
    """Crop the background out so the subject fills the frame."""
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size

    def is_background(c):
        if bg is None:
            r, g, b = c
            return r + g + b > 720  # near-white fallback
        return all(abs(c[i] - bg[i]) <= 22 for i in range(3))

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
    pad = 8
    left = max(0, min(cols) - pad)
    right = min(w, max(cols) + pad)
    top = max(0, min(rows) - pad)
    bot = min(h, max(rows) + pad)
    return rgb.crop((left, top, right, bot))


def dist2(a, b):
    return sum((a[i] - b[i]) ** 2 for i in range(3))


def two_colour_split(quad):
    """Pick FG and BG colours for a 4-pixel quadrant.

    Strategy: find the two pixels with the largest pairwise colour distance,
    treat them as cluster seeds, then assign the other two to whichever
    seed they're closer to. Returns (fg, bg, mask) where mask is the 4-tuple
    of {0,1} flags in (TL, TR, BL, BR) order.
    """
    if len(set(quad)) == 1:
        c = quad[0]
        return c, c, (1, 1, 1, 1)

    # Find max-distance pair.
    best = (0, 1)
    best_d = -1
    for i in range(4):
        for j in range(i + 1, 4):
            d = dist2(quad[i], quad[j])
            if d > best_d:
                best_d = d
                best = (i, j)
    a_idx, b_idx = best
    a, b = quad[a_idx], quad[b_idx]

    # Compute mean of pixels assigned to each cluster.
    a_pix = [a]
    b_pix = [b]
    for k in range(4):
        if k in (a_idx, b_idx):
            continue
        if dist2(quad[k], a) <= dist2(quad[k], b):
            a_pix.append(quad[k])
        else:
            b_pix.append(quad[k])

    def mean(ps):
        n = len(ps)
        return tuple(sum(p[i] for p in ps) // n for i in range(3))

    fg = mean(a_pix)
    bg = mean(b_pix)

    mask = []
    for k in range(4):
        if dist2(quad[k], fg) <= dist2(quad[k], bg):
            mask.append(1)
        else:
            mask.append(0)
    return fg, bg, tuple(mask)


def make_ansi(img: Image.Image, target_w: int, bg_color=None) -> str:
    """Render image as Unicode quarter-block ANSI art."""
    iw, ih = img.size
    aspect = ih / iw

    # Each cell encodes a 2×2 pixel block, and terminal cells are ~1:2 (w:h).
    # So one square image-pixel ≈ one cell horizontally, two cells vertically
    # ... no — each cell holds 2 vertical pixels in the half-block approach.
    # Quarter-block puts 2 vertical pixels in the SAME cell, so rows are now
    # half as tall. To preserve aspect we want pixel_h == round(pixel_w * aspect)
    # but rendered into target_h = pixel_h / 2 cell rows. Keep it simple: use
    # the source's aspect and compute pixel grid; the ratio works out.
    pixel_w = target_w * 2
    pixel_h = max(2, round(pixel_w * aspect))
    if pixel_h % 2 == 1:
        pixel_h += 1

    # Quarter-block cells are 2×2 pixels but terminal cells are taller than
    # wide. Halve the pixel_h so the rendered art is roughly square in the
    # terminal (1 cell wide ≈ 2 cells tall in physical pixels).
    pixel_h_render = max(2, pixel_h // 2)
    if pixel_h_render % 2 == 1:
        pixel_h_render += 1

    # Light contrast boost helps the small face read better — flat-icon
    # source colours are already saturated but downsampling softens them.
    boosted = ImageEnhance.Contrast(img).enhance(1.10)
    boosted = ImageEnhance.Color(boosted).enhance(1.15)
    boosted = boosted.resize((pixel_w, pixel_h_render), Image.LANCZOS).convert('RGB')

    def is_bg(c, tol=22):
        if bg_color is None:
            return False
        return all(abs(c[i] - bg_color[i]) <= tol for i in range(3))

    out_lines = []
    pixels = boosted.load()
    target_h_cells = pixel_h_render // 2
    for cy in range(target_h_cells):
        line = ''
        for cx in range(target_w):
            x0, y0 = cx * 2, cy * 2
            tl = pixels[x0, y0]
            tr = pixels[x0 + 1, y0]
            bl = pixels[x0, y0 + 1]
            br = pixels[x0 + 1, y0 + 1]

            quad = (tl, tr, bl, br)

            # If every pixel matches the page background, render the cell
            # as a transparent space so the welcome box / shell background
            # shows through.
            if all(is_bg(p) for p in quad):
                line += '\x1b[0m '
                continue

            fg, bg, mask = two_colour_split(quad)

            # If FG and BG are within a tight tolerance, treat the cell as
            # a single solid colour to avoid noisy alternating glyphs.
            if dist2(fg, bg) < 350:
                line += f'\x1b[0m\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m█'
                continue

            # If one of fg/bg is the page background, replace it with the
            # default cell (no bg paint) so transparency works at the edges.
            fg_is_bg = is_bg(fg)
            bg_is_bg = is_bg(bg)

            glyph = GLYPHS[mask]
            if bg_is_bg and not fg_is_bg:
                line += f'\x1b[0m\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m{glyph}'
            elif fg_is_bg and not bg_is_bg:
                # Invert mask + glyph so the non-bg colour becomes FG.
                inv = tuple(1 - m for m in mask)
                line += f'\x1b[0m\x1b[38;2;{bg[0]};{bg[1]};{bg[2]}m{GLYPHS[inv]}'
            else:
                line += (
                    f'\x1b[0m'
                    f'\x1b[38;2;{fg[0]};{fg[1]};{fg[2]}m'
                    f'\x1b[48;2;{bg[0]};{bg[1]};{bg[2]}m'
                    f'{glyph}'
                )
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

    bg2 = detect_bg_colour(cropped) or bg
    art = make_ansi(cropped, TARGET_W, bg_color=bg2)

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
        ' * encodes a 2×2 pixel block of the source image, giving 4× the effective\n'
        ' * resolution of a half-block render. Uses 24-bit colour escapes so it\n'
        ' * needs a true-colour terminal.\n'
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
