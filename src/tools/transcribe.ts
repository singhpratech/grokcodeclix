import * as fs from 'fs/promises';
import * as path from 'path';
import { ToolResult } from './registry.js';

export interface TranscribeAudioParams {
  audio_path: string;
  model?: string;
  language?: string;
}

const SUPPORTED_AUDIO = ['.mp3', '.mp4', '.mpeg', '.mpga', '.m4a', '.wav', '.webm', '.flac', '.ogg', '.oga'];
const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // 25MB — OpenAI/Whisper hard limit

/**
 * Audio transcription. Provider-aware:
 *
 *   xAI direct:  attempts POST https://api.x.ai/v1/audio/transcriptions
 *                (OpenAI-compatible schema). If xAI hasn't shipped audio
 *                yet, the API returns 404 / 405 and we fall back gracefully
 *                with a clear message.
 *   OpenRouter:  POST https://openrouter.ai/api/v1/audio/transcriptions
 *                (routes to Whisper).
 *
 * The user's `--model` (or default) is used. xAI native models that may
 * be exposed in future include grok-voice / grok-audio variants.
 */
export async function transcribeAudioTool(params: TranscribeAudioParams): Promise<ToolResult> {
  const apiKey = process.env.GROK_RUNTIME_API_KEY;
  const provider = (process.env.GROK_RUNTIME_PROVIDER as 'xai' | 'openrouter' | undefined) || 'xai';

  if (!apiKey) {
    return {
      success: false,
      output: '',
      error: 'No API key in environment. The chat session must export GROK_RUNTIME_API_KEY before calling Transcribe.',
    };
  }

  const audioPath = path.resolve(params.audio_path);
  let stats;
  try {
    stats = await fs.stat(audioPath);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { success: false, output: '', error: `Audio file not found: ${params.audio_path}` };
    }
    return { success: false, output: '', error: `Cannot read audio file: ${err.message}` };
  }

  if (!stats.isFile()) {
    return { success: false, output: '', error: `Not a file: ${params.audio_path}` };
  }
  if (stats.size > MAX_AUDIO_BYTES) {
    return {
      success: false,
      output: '',
      error: `Audio file too large (${(stats.size / 1024 / 1024).toFixed(1)}MB). Whisper limit is ${MAX_AUDIO_BYTES / 1024 / 1024}MB.`,
    };
  }

  const ext = path.extname(audioPath).toLowerCase();
  if (!SUPPORTED_AUDIO.includes(ext)) {
    return {
      success: false,
      output: '',
      error: `Unsupported audio format ${ext || '(no extension)'}. Supported: ${SUPPORTED_AUDIO.join(', ')}`,
    };
  }

  const buffer = await fs.readFile(audioPath);

  // Try the active provider's audio endpoint first. The schema is
  // OpenAI-compatible. We re-build the FormData per attempt because the
  // body is consumed once a fetch is dispatched.
  const buildForm = (modelId: string): FormData => {
    const blob = new Blob([new Uint8Array(buffer)], { type: mimeForExt(ext) });
    const f = new FormData();
    f.append('file', blob, path.basename(audioPath));
    f.append('model', modelId);
    if (params.language) f.append('language', params.language);
    f.append('response_format', 'json');
    return f;
  };

  const attempt = async (
    url: string,
    modelId: string,
    extraHeaders: Record<string, string> = {}
  ): Promise<{ ok: true; text: string; language?: string } | { ok: false; status: number; detail: string }> => {
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: buildForm(modelId),
      });
    } catch (error) {
      return { ok: false, status: 0, detail: `Network error: ${(error as Error).message}` };
    }
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      return { ok: false, status: resp.status, detail };
    }
    const data = (await resp.json()) as { text?: string; language?: string };
    if (!data.text) return { ok: false, status: resp.status, detail: 'empty transcription' };
    return { ok: true, text: data.text, language: data.language };
  };

  // 1. Try the active provider's native audio endpoint.
  const xaiModel = params.model || 'grok-voice';
  const orModel = params.model || 'openai/whisper-1';

  if (provider === 'xai') {
    const r = await attempt('https://api.x.ai/v1/audio/transcriptions', xaiModel);
    if (r.ok) {
      return {
        success: true,
        output: r.text,
        display: {
          summary: `Transcribed ${path.basename(audioPath)}${r.language ? ` (${r.language})` : ''} via xAI`,
          preview: r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text,
        },
      };
    }
    // 404 / 405 from xAI = endpoint not exposed yet. Other errors (401, 413, etc.) we surface as-is.
    if (r.status === 404 || r.status === 405) {
      return {
        success: false,
        output: '',
        error:
          'xAI direct does not currently expose an audio transcription endpoint. ' +
          'Switch to OpenRouter for Whisper (run `/login` and pick option [2], or set XAI_API_KEY to a sk-or-... key). ' +
          'For local transcription, see https://github.com/ggerganov/whisper.cpp.',
      };
    }
    return { success: false, output: '', error: `xAI transcription failed (${r.status}): ${r.detail.slice(0, 400)}` };
  }

  // OpenRouter
  const r = await attempt(
    'https://openrouter.ai/api/v1/audio/transcriptions',
    orModel,
    {
      'HTTP-Referer': 'https://github.com/singhpratech/grokcodeclix',
      'X-Title': 'Grok Code CLI',
    }
  );
  if (!r.ok) {
    return {
      success: false,
      output: '',
      error: `OpenRouter transcription failed (${r.status}): ${r.detail.slice(0, 400)}`,
    };
  }
  return {
    success: true,
    output: r.text,
    display: {
      summary: `Transcribed ${path.basename(audioPath)}${r.language ? ` (${r.language})` : ''} via OpenRouter`,
      preview: r.text.length > 400 ? r.text.slice(0, 400) + '…' : r.text,
    },
  };
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case '.mp3':
    case '.mpga':
      return 'audio/mpeg';
    case '.mp4':
    case '.m4a':
      return 'audio/mp4';
    case '.wav':
      return 'audio/wav';
    case '.webm':
      return 'audio/webm';
    case '.flac':
      return 'audio/flac';
    case '.ogg':
    case '.oga':
      return 'audio/ogg';
    default:
      return 'application/octet-stream';
  }
}
