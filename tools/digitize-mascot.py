#!/usr/bin/env python3
"""
Convert mascot.png to ANSI terminal art using Unicode half-block (▀).

Each row of characters represents 2 vertical pixels (fg = top, bg = bottom).
We auto-detect the source background colour from the four corners; pixels
close to that colour are rendered as transparent so the mascot floats on
the user's actual terminal background.

For flat-design source images we additionally **quantize** the source to a
small theme palette (saffron, India-green, deep blue, white, amber, black)
before scaling. Quantization snaps every pixel to one of those exact brand
colours, which is what gives the terminal mascot a clean iconic look
instead of a fuzzy 30-colour blur.

To regenerate after changing mascot.png:
    python3 tools/digitize-mascot.py
"""

from PIL import Image
from pathlib import Path

SRC = Path('/home/papapratlinux/Documents/grokcodeclix/docs/assets/mascot.png')
DST_TS = Path('/home/papapratlinux/Documents/grokcodeclix/src/utils/mascot.ts')

# Target terminal cell dimensions.
# Each cell is 1 char wide and 2 image-pixels tall.
TARGET_W = 24    # cell columns. 24 reads cleanly even on a 36-col terminal.
TARGET_H = 24    # pixel rows; → 12 cell rows


# Tiranga-themed brand palette. Every output pixel snaps to one of these.
# Order matters only insofar as RGB exactness — the choice of colour is
# done by nearest-neighbour distance.
PALETTE = [
    (255, 255, 255),  # white (background card / hair)
    (0, 0, 0),        # black (outline)
    (255, 153,  51),  # saffron (#FF9933)
    ( 19, 136,   8),  # India green (#138808)
    ( 30,  58, 138),  # deep blue (Navi skin #1E3A8A)
    ( 64, 110, 204),  # mid blue (skin highlight)
    (255, 191,   0),  # amber yellow (eyes)
    (210, 210, 210),  # light grey (anti-aliasing fallback)
]


def quantize_to_palette(img: Image.Image) -> Image.Image:
    """Snap every pixel of img to its nearest entry in PALETTE."""
    rgb = img.convert('RGB')
    pal_img = Image.new('P', (1, 1))
    flat = []
    for c in PALETTE:
        flat.extend(c)
    flat.extend([0] * (256 * 3 - len(flat)))
    pal_img.putpalette(flat)
    return rgb.quantize(palette=pal_img, dither=Image.Dither.NONE).convert('RGB')


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


def trim_to_subject(img: Image.Image, bg) -> Image.Image:
    """Crop the background out so the subject fills the frame."""
    rgb = img.convert('RGB')
    px = rgb.load()
    w, h = rgb.size

    def is_background(c):
        if bg is None:
            r, g, b = c
            return r + g + b < 165
        return all(abs(c[i] - bg[i]) <= 24 for i in range(3))

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
    pad = 6
    left = max(0, min(cols) - pad)
    right = min(w, max(cols) + pad)
    top = max(0, min(rows) - pad)
    bot = min(h, max(rows) + pad)
    return rgb.crop((left, top, right, bot))


def make_ansi(img: Image.Image, target_w: int, target_h: int, bg_color=None) -> str:
    """Render image as Unicode half-block (▀ / ▄) ANSI art."""
    if target_h % 2 == 1:
        target_h += 1

    iw, ih = img.size
    aspect = ih / iw
    pixel_w = target_w
    pixel_h = max(1, round(pixel_w * aspect))
    if pixel_h % 2 == 1:
        pixel_h += 1
    pixel_h = min(pixel_h, target_h)

    # NEAREST scaling preserves the quantized palette colours; LANCZOS would
    # mix them and re-introduce noise.
    img = img.resize((pixel_w, pixel_h), Image.NEAREST).convert('RGB')

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

            line += '\x1b[0m'  # reset between cells (defensive, cheap)
            if top_bg and bot_bg:
                line += ' '
            elif top_bg and not bot_bg:
                line += f'\x1b[38;2;{bot[0]};{bot[1]};{bot[2]}m▄'
            elif not top_bg and bot_bg:
                line += f'\x1b[38;2;{top[0]};{top[1]};{top[2]}m▀'
            else:
                line += (
                    f'\x1b[38;2;{top[0]};{top[1]};{top[2]}m'
                    f'\x1b[48;2;{bot[0]};{bot[1]};{bot[2]}m▀'
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

    quantized = quantize_to_palette(cropped)
    print(f'  quantized to {len(PALETTE)}-colour brand palette')

    art = make_ansi(quantized, TARGET_W, TARGET_H, bg_color=bg)

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
        ' * Each line is a row of Unicode upper-half-block characters (▀ / ▄)\n'
        ' * where the foreground colour represents the top pixel and the\n'
        ' * background colour represents the bottom pixel — so each cell is\n'
        ' * 1 character wide × 2 image pixels tall. Uses 24-bit colour escapes\n'
        ' * so it needs a true-colour terminal.\n'
        ' *\n'
        ' * The image is quantized to an 8-colour brand palette (saffron,\n'
        ' * India-green, deep blue, white, black, amber, mid-blue, light grey)\n'
        ' * before rendering, which keeps the mascot looking like an icon\n'
        ' * rather than a low-resolution photograph.\n'
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
