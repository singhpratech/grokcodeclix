import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface SpeakTextParams {
  text: string;
  voice?: string;
  output_path?: string;
  model?: string;
  format?: 'mp3' | 'wav' | 'opus' | 'aac' | 'flac' | 'pcm';
}

/**
 * Text-to-speech, provider-aware.
 *
 *   xAI direct:  attempts POST https://api.x.ai/v1/audio/speech (OpenAI-
 *                compatible). xAI announced grok-voice-* models for speech;
 *                if endpoint isn't live, returns clear error.
 *   OpenRouter:  POST https://openrouter.ai/api/v1/audio/speech (routes
 *                to OpenAI tts-1 or similar).
 *
 * Saves the generated audio under ./grok-audio/ (or output_path).
 */
export async function speakTextTool(params: SpeakTextParams): Promise<ToolResult> {
  const apiKey = process.env.GROK_RUNTIME_API_KEY;
  const provider = (process.env.GROK_RUNTIME_PROVIDER as 'xai' | 'openrouter' | undefined) || 'xai';

  if (!apiKey) {
    return {
      success: false,
      output: '',
      error: 'No API key in environment. The chat session must export GROK_RUNTIME_API_KEY before calling Speak.',
    };
  }

  const text = (params.text || '').trim();
  if (!text) return { success: false, output: '', error: 'text is required' };

  const format = params.format || 'mp3';
  const voice = params.voice || (provider === 'openrouter' ? 'alloy' : 'aurora');
  const model = params.model || (provider === 'openrouter' ? 'openai/tts-1' : 'grok-voice');

  const baseUrl = provider === 'openrouter' ? 'https://openrouter.ai/api/v1' : 'https://api.x.ai/v1';
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (provider === 'openrouter') {
    headers['HTTP-Referer'] = 'https://github.com/singhpratech/grokcodeclix';
    headers['X-Title'] = 'Grok Code CLI';
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/audio/speech`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model, voice, input: text, response_format: format }),
    });
  } catch (error) {
    return { success: false, output: '', error: `Network error: ${(error as Error).message}` };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (provider === 'xai' && (response.status === 404 || response.status === 405)) {
      return {
        success: false,
        output: '',
        error:
          'xAI direct does not currently expose a text-to-speech endpoint. ' +
          'Switch to OpenRouter (`/login` → option [2]) for OpenAI TTS routing. ' +
          'For local TTS, see https://github.com/coqui-ai/TTS.',
      };
    }
    return {
      success: false,
      output: '',
      error: `Speech generation failed (${response.status}): ${body.slice(0, 400)}`,
    };
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const outDir = params.output_path
    ? path.dirname(path.resolve(params.output_path))
    : path.resolve('./grok-audio');
  await fs.mkdir(outDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outPath = params.output_path
    ? path.resolve(params.output_path)
    : path.join(outDir, `grok-${stamp}.${format}`);

  await fs.writeFile(outPath, buffer);

  const rel = path.relative(process.cwd(), outPath);
  const displayPath = !rel || rel.startsWith('..') ? outPath : rel;

  return {
    success: true,
    output: `Generated speech via ${model} (${voice}, ${format}) — saved to ${outPath} (${(buffer.length / 1024).toFixed(1)} KB)`,
    display: {
      summary: `Speech → ${displayPath} (${model}, ${voice}, ${format})`,
    },
  };
}
