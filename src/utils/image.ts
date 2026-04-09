/**
 * Image handling utilities for vision-enabled Grok models.
 *
 * Supports:
 *   - Loading image files from disk and converting to base64 data URLs
 *   - Grabbing clipboard images cross-platform (Linux/macOS/Windows)
 *   - Detecting image file references in user input (@file.png or drag-and-dropped paths)
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn } from 'child_process';
import { platform } from 'os';

export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'];
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 20MB

export interface ImageAttachment {
  /** data:image/png;base64,... URL suitable for image_url content blocks */
  dataUrl: string;
  /** Original source path or "clipboard" */
  source: string;
  /** MIME type */
  mimeType: string;
  /** Size in bytes */
  size: number;
}

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === '.png') return 'image/png';
  if (e === '.jpg' || e === '.jpeg') return 'image/jpeg';
  if (e === '.gif') return 'image/gif';
  if (e === '.webp') return 'image/webp';
  if (e === '.bmp') return 'image/bmp';
  return 'application/octet-stream';
}

export function isImagePath(p: string): boolean {
  const ext = path.extname(p).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * Load an image file from disk and return as a base64 data URL.
 */
export async function loadImageFromFile(filePath: string): Promise<ImageAttachment> {
  const resolved = path.resolve(filePath);
  const stats = await fs.stat(resolved);

  if (!stats.isFile()) {
    throw new Error(`Not a file: ${filePath}`);
  }
  if (stats.size > MAX_IMAGE_BYTES) {
    throw new Error(
      `Image too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Maximum is ${MAX_IMAGE_BYTES / 1024 / 1024}MB.`
    );
  }
  if (!isImagePath(resolved)) {
    throw new Error(`Not a supported image format: ${path.extname(resolved) || '(no extension)'}`);
  }

  const buffer = await fs.readFile(resolved);
  const mimeType = mimeFromExt(path.extname(resolved));
  const dataUrl = `data:${mimeType};base64,${buffer.toString('base64')}`;

  return {
    dataUrl,
    source: resolved,
    mimeType,
    size: stats.size,
  };
}

/**
 * Run a command and capture its stdout as a Buffer. Returns null if the
 * command is missing or exits non-zero.
 */
function runCommand(cmd: string, args: string[]): Promise<Buffer | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(cmd, args);
      const chunks: Buffer[] = [];
      let errored = false;

      child.stdout.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
      });
      child.on('error', () => {
        errored = true;
        resolve(null);
      });
      child.on('close', (code) => {
        if (errored) return;
        if (code !== 0 || chunks.length === 0) {
          resolve(null);
          return;
        }
        resolve(Buffer.concat(chunks));
      });
    } catch {
      resolve(null);
    }
  });
}

/**
 * Attempt to grab an image from the system clipboard. Returns null if
 * there is no image or the required tool is missing.
 *
 * Linux: requires `xclip` or `wl-paste`
 * macOS: requires `pngpaste` (brew install pngpaste) OR uses built-in osascript fallback
 * Windows: uses PowerShell's Windows.Forms.Clipboard
 */
export async function loadImageFromClipboard(): Promise<ImageAttachment | null> {
  const os = platform();

  if (os === 'linux') {
    // Try wl-paste first (Wayland), then xclip (X11)
    let data = await runCommand('wl-paste', ['--type', 'image/png']);
    if (!data) {
      data = await runCommand('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']);
    }
    if (!data || data.length === 0) return null;
    return {
      dataUrl: `data:image/png;base64,${data.toString('base64')}`,
      source: 'clipboard',
      mimeType: 'image/png',
      size: data.length,
    };
  }

  if (os === 'darwin') {
    // Try pngpaste (common Homebrew tool)
    let data = await runCommand('pngpaste', ['-']);
    if (!data || data.length === 0) {
      // Fall back to osascript tempfile approach
      const tmpPath = `/tmp/grokcli-clipboard-${Date.now()}.png`;
      const script = `try
  set pngData to (the clipboard as «class PNGf»)
  set fp to open for access POSIX file "${tmpPath}" with write permission
  set eof fp to 0
  write pngData to fp
  close access fp
  return "ok"
on error
  return "no-image"
end try`;
      const result = await runCommand('osascript', ['-e', script]);
      if (result && result.toString().trim() === 'ok') {
        try {
          data = await fs.readFile(tmpPath);
          await fs.unlink(tmpPath).catch(() => {});
        } catch {
          data = null;
        }
      }
    }
    if (!data || data.length === 0) return null;
    return {
      dataUrl: `data:image/png;base64,${data.toString('base64')}`,
      source: 'clipboard',
      mimeType: 'image/png',
      size: data.length,
    };
  }

  if (os === 'win32') {
    const tmpPath = path.join(process.env.TEMP || 'C:\\Temp', `grokcli-clipboard-${Date.now()}.png`);
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -ne $null) {
  $img.Save('${tmpPath.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
  Write-Output "ok"
} else {
  Write-Output "no-image"
}`;
    const result = await runCommand('powershell', ['-NoProfile', '-Command', script]);
    if (result && result.toString().trim().endsWith('ok')) {
      try {
        const data = await fs.readFile(tmpPath);
        await fs.unlink(tmpPath).catch(() => {});
        return {
          dataUrl: `data:image/png;base64,${data.toString('base64')}`,
          source: 'clipboard',
          mimeType: 'image/png',
          size: data.length,
        };
      } catch {
        return null;
      }
    }
    return null;
  }

  return null;
}

/**
 * Scan a user input string for image references like `@path/to/image.png`
 * and return the list of resolved paths plus the stripped text.
 */
export function extractImageReferences(input: string): { text: string; paths: string[] } {
  const paths: string[] = [];

  // Match @/absolute/path.png OR @relative/path.png OR @./path.png
  // or just bare absolute-looking image paths (drag-and-dropped into terminal)
  const text = input.replace(
    /(?:^|\s)@?((?:[\/\w.~][\w./\-~]*\.(?:png|jpg|jpeg|gif|webp|bmp)))/gi,
    (match, p) => {
      paths.push(p);
      return match.replace(`@${p}`, '').replace(p, '').trim() ? match : ' ';
    }
  );

  return { text: text.replace(/\s+/g, ' ').trim(), paths };
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
