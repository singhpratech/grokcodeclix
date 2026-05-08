import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface GenerateImageParams {
  prompt: string;
  /** number of images to generate, 1-4 (default 1) */
  n?: number;
  /** xai: 'grok-2-image-latest' (default). On OpenRouter, falls back to first x-ai image model */
  model?: string;
  /** Where to save the generated PNG(s). Defaults to ./grok-images/ */
  output_dir?: string;
}

interface GeneratedImagePayload {
  data: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>;
  model?: string;
}

/** Detect image format from the first few bytes. */
function sniffImageExt(buffer: Buffer): string {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) {
    return 'png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'jpg';
  }
  if (buffer.length >= 12 && buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    return 'webp';
  }
  if (buffer.length >= 6 && buffer.slice(0, 6).toString('ascii') === 'GIF87a') return 'gif';
  if (buffer.length >= 6 && buffer.slice(0, 6).toString('ascii') === 'GIF89a') return 'gif';
  return 'png'; // sensible default
}

/**
 * Provider-aware image generation. Reads the active key/provider from env
 * since this tool runs inside the chat session that already loaded them.
 *
 *   xAI:        POST https://api.x.ai/v1/images/generations
 *   OpenRouter: POST https://openrouter.ai/api/v1/images/generations
 *
 * Both follow the OpenAI-compatible schema. Result images are saved as PNG
 * under ./grok-images/ (or output_dir) with a timestamped filename, and
 * the model gets paths back so it can attach them to subsequent turns.
 */
export async function generateImageTool(params: GenerateImageParams): Promise<ToolResult> {
  const apiKey = process.env.GROK_RUNTIME_API_KEY;
  const provider = (process.env.GROK_RUNTIME_PROVIDER as 'xai' | 'openrouter' | undefined) || 'xai';

  if (!apiKey) {
    return {
      success: false,
      output: '',
      error: 'No API key in environment. The chat session must export GROK_RUNTIME_API_KEY before calling GenerateImage.',
    };
  }

  const prompt = (params.prompt || '').trim();
  if (!prompt) {
    return { success: false, output: '', error: 'prompt is required' };
  }

  const n = Math.max(1, Math.min(params.n ?? 1, 4));
  const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.x.ai/v1';
  // Default model per provider — Grok-first on both, since the tool is
  // branded grokclix and users expect their xAI/OpenRouter spend to go
  // to Grok unless they explicitly ask otherwise.
  //   xAI:        grok-imagine-image  (the older grok-2-image alias is gone)
  //   OpenRouter: x-ai/grok-2-image
  // Override via params.model — e.g. `google/gemini-3-pro-image-preview`
  // (Nano Banana Pro) does produce better image quality, but that's an
  // opt-in, not the default.
  const model =
    params.model ||
    (provider === 'openrouter' ? 'x-ai/grok-2-image' : 'grok-imagine-image');
  const outDir = path.resolve(params.output_dir || './grok-images');

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/singhpratech/grokcodeclix';
    headers['X-Title'] = 'Grok Code CLI';
  }

  // Two API shapes share one tool:
  //   1. /v1/images/generations  — OpenAI-style, returns { data: [{ b64_json }] }
  //      Used by xAI grok-imagine-image and OpenRouter x-ai/grok-2-image.
  //   2. /v1/chat/completions    — used by Gemini's image models on OpenRouter.
  //      Returns assistant message with `images: [{ image_url: { url: data:... } }]`.
  //
  // Detect by model id: any Gemini / Imagen / GPT-Image / Stable-Diffusion
  // model on OpenRouter goes through chat completions with `modalities`.
  const useChatPath =
    provider === 'openrouter' &&
    /(gemini.*image|imagen|gpt-.*image|stable-diffusion|flux|dall-e-3)/i.test(model);

  let payload: GeneratedImagePayload;
  if (useChatPath) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model,
          modalities: ['image', 'text'],
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (error) {
      return { success: false, output: '', error: `Network error: ${(error as Error).message}` };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, output: '', error: `Image generation failed (${response.status}): ${text.slice(0, 400)}` };
    }
    const chat = (await response.json()) as {
      choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
    };
    const images = chat.choices?.[0]?.message?.images || [];
    payload = {
      data: images
        .map((im) => {
          const url = im?.image_url?.url || '';
          const m = url.match(/^data:image\/[^;]+;base64,(.+)$/);
          if (m) return { b64_json: m[1] };
          if (url.startsWith('http')) return { url };
          return null;
        })
        .filter((x): x is NonNullable<typeof x> => !!x),
    };
  } else {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ prompt, model, n, response_format: 'b64_json' }),
      });
    } catch (error) {
      return { success: false, output: '', error: `Network error: ${(error as Error).message}` };
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      return { success: false, output: '', error: `Image generation failed (${response.status}): ${text.slice(0, 400)}` };
    }
    payload = (await response.json()) as GeneratedImagePayload;
  }

  if (!payload.data || payload.data.length === 0) {
    return { success: false, output: '', error: 'API returned no images' };
  }

  await fs.mkdir(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const savedPaths: string[] = [];
  let fallbackRevised: string | undefined;

  for (let i = 0; i < payload.data.length; i++) {
    const item = payload.data[i];
    let bytes: Buffer | null = null;
    if (item.b64_json) {
      bytes = Buffer.from(item.b64_json, 'base64');
    } else if (item.url) {
      try {
        const dl = await fetch(item.url);
        if (dl.ok) bytes = Buffer.from(await dl.arrayBuffer());
      } catch {
        /* ignored */
      }
    }
    if (!bytes) continue;

    // Detect actual format from magic bytes — xAI's grok-imagine-image
    // returns JPEG even though the OpenAI-style API doesn't let us
    // request a format. Fall back to .png if we can't tell.
    const ext = sniffImageExt(bytes);
    const fname = payload.data.length === 1
      ? `grok-${stamp}.${ext}`
      : `grok-${stamp}-${i + 1}.${ext}`;
    const outPath = path.join(outDir, fname);
    await fs.writeFile(outPath, bytes);
    savedPaths.push(outPath);
    if (item.revised_prompt) fallbackRevised = item.revised_prompt;
  }

  if (savedPaths.length === 0) {
    return { success: false, output: '', error: 'API returned data but no decodable images' };
  }

  const rel = savedPaths.map((p) => {
    const r = path.relative(process.cwd(), p);
    return !r || r.startsWith('..') ? p : r;
  });

  const summary =
    `Generated ${savedPaths.length} image${savedPaths.length === 1 ? '' : 's'} (${model}) — saved to ${rel.join(', ')}` +
    (fallbackRevised ? `\nRevised prompt: ${fallbackRevised}` : '');

  return {
    success: true,
    output: summary,
    display: {
      summary: `${savedPaths.length} image${savedPaths.length === 1 ? '' : 's'} → ${rel[0]}${rel.length > 1 ? ` (+${rel.length - 1})` : ''}`,
    },
  };
}
