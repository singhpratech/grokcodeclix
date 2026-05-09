/**
 * Grok API Client
 *
 * xAI's Grok API is OpenAI-compatible with several xAI extensions.
 * Base URL: https://api.x.ai/v1
 *
 * Supported endpoints / features:
 *   POST /chat/completions       — chat, streaming, tools, reasoning, live search
 *   GET  /models                 — list available models
 *   GET  /language-models/:id    — model metadata
 *
 * Grok-specific extras handled here:
 *   - reasoning_content streaming (for grok-4 / grok-4-1 reasoning variants)
 *   - search_parameters (Live Search — web, x, news, rss)
 *   - vision message parts (image_url content blocks)
 */

export type GrokRole = 'system' | 'user' | 'assistant' | 'tool';

export interface GrokTextPart {
  type: 'text';
  text: string;
}

export interface GrokImagePart {
  type: 'image_url';
  image_url: { url: string; detail?: 'low' | 'high' | 'auto' };
}

export type GrokContentPart = GrokTextPart | GrokImagePart;

export interface GrokMessage {
  role: GrokRole;
  content: string | GrokContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning_content?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface Tool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface SearchSource {
  type: 'web' | 'x' | 'news' | 'rss';
  country?: string;
  excluded_websites?: string[];
  allowed_websites?: string[];
  safe_search?: boolean;
  x_handles?: string[];
  links?: string[];
}

export interface SearchParameters {
  mode?: 'off' | 'auto' | 'on';
  return_citations?: boolean;
  from_date?: string;
  to_date?: string;
  max_search_results?: number;
  sources?: SearchSource[];
}

export interface GrokCompletionRequest {
  model: string;
  messages: GrokMessage[];
  tools?: Tool[];
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  response_format?: { type: 'text' } | { type: 'json_object' } | { type: 'json_schema'; json_schema: Record<string, unknown> };
  search_parameters?: SearchParameters;
  reasoning_effort?: 'low' | 'high';
  user?: string;
}

export interface GrokUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  reasoning_tokens?: number;
  num_sources_used?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    text_tokens?: number;
    image_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    accepted_prediction_tokens?: number;
  };
}

export interface Citation {
  url: string;
  title?: string;
}

export interface GrokCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    message: GrokMessage;
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  }[];
  usage: GrokUsage;
  citations?: Citation[];
  system_fingerprint?: string;
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: {
    index: number;
    delta: Partial<GrokMessage> & { reasoning_content?: string };
    finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter' | null;
  }[];
  usage?: GrokUsage;
  citations?: Citation[];
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stop?: string | string[];
  reasoningEffort?: 'low' | 'high';
  searchParameters?: SearchParameters;
  responseFormat?: GrokCompletionRequest['response_format'];
  signal?: AbortSignal;
  user?: string;
}

export type GrokProvider = 'xai' | 'openrouter';

export interface GrokClientOptions {
  baseUrl?: string;
  provider?: GrokProvider;
}

/**
 * Detect which provider an API key belongs to from its prefix.
 *   xai-*     → xAI direct
 *   sk-or-*   → OpenRouter
 *   anything else defaults to xAI.
 */
export function detectProvider(apiKey: string): GrokProvider {
  if (apiKey.startsWith('sk-or-')) return 'openrouter';
  return 'xai';
}

export function providerBaseUrl(provider: GrokProvider): string {
  switch (provider) {
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'xai':
    default:
      return 'https://api.x.ai/v1';
  }
}

/**
 * Translate a model name to the form the active provider expects.
 *  xAI accepts: grok-4-1-fast-reasoning, grok-4, grok-3, ...
 *  OpenRouter expects: x-ai/grok-4, x-ai/grok-4-fast, x-ai/grok-code-fast-1, ...
 */
export function normaliseModelForProvider(model: string, provider: GrokProvider): string {
  if (provider === 'openrouter') {
    if (model.startsWith('x-ai/') || model.includes('/')) return model;
    // Map xAI canonical names to OpenRouter slugs
    const map: Record<string, string> = {
      'grok-4-1-fast-reasoning': 'x-ai/grok-4.1-fast',
      'grok-4-1-fast-non-reasoning': 'x-ai/grok-4.1-fast',
      'grok-4-fast-reasoning': 'x-ai/grok-4-fast',
      'grok-4-fast-non-reasoning': 'x-ai/grok-4-fast',
      'grok-4': 'x-ai/grok-4',
      'grok-code-fast-1': 'x-ai/grok-code-fast-1',
      'grok-3': 'x-ai/grok-3',
      'grok-3-mini': 'x-ai/grok-3-mini',
    };
    return map[model] || `x-ai/${model}`;
  }
  // xAI direct: strip a leading x-ai/ if someone passed an OR slug
  if (model.startsWith('x-ai/')) return model.replace(/^x-ai\//, '');
  return model;
}

export class GrokClient {
  private apiKey: string;
  private baseUrl: string;
  public model: string;
  public provider: GrokProvider;

  constructor(apiKey: string, model: string = 'grok-4-1-fast-reasoning', options: GrokClientOptions | string = {}) {
    this.apiKey = apiKey;
    // Backwards compatibility: third arg used to be baseUrl: string
    const opts: GrokClientOptions = typeof options === 'string' ? { baseUrl: options } : options;
    this.provider = opts.provider || detectProvider(apiKey);
    this.baseUrl = opts.baseUrl || providerBaseUrl(this.provider);
    this.model = normaliseModelForProvider(model, this.provider);
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (this.provider === 'openrouter') {
      h['HTTP-Referer'] = 'https://github.com/singhpratech/grokcodeclix';
      h['X-Title'] = 'Grok Code CLI';
    }
    if (extra) Object.assign(h, extra);
    return h;
  }

  private buildRequest(
    messages: GrokMessage[],
    tools: Tool[] | undefined,
    stream: boolean,
    options: ChatOptions
  ): GrokCompletionRequest {
    const request: GrokCompletionRequest = {
      model: this.model,
      messages,
      stream,
      temperature: options.temperature ?? 0.7,
      max_tokens: options.maxTokens ?? 16384,
    };

    if (options.topP !== undefined) request.top_p = options.topP;
    if (options.stop !== undefined) request.stop = options.stop;
    if (options.user !== undefined) request.user = options.user;
    if (options.responseFormat) request.response_format = options.responseFormat;
    if (options.searchParameters) request.search_parameters = options.searchParameters;
    if (options.reasoningEffort) request.reasoning_effort = options.reasoningEffort;

    if (tools && tools.length > 0) {
      request.tools = tools;
      request.tool_choice = 'auto';
    }

    return request;
  }

  private async handleError(response: Response): Promise<never> {
    let detail = '';
    try {
      const body = await response.text();
      try {
        const parsed = JSON.parse(body);
        detail = parsed?.error?.message || parsed?.message || body;
      } catch {
        detail = body;
      }
    } catch {
      // ignore
    }

    const status = response.status;
    let hint = '';
    switch (status) {
      case 401:
        hint = ' — check your API key (run `grokclix /login`)';
        break;
      case 403:
        hint = ' — your account may not have access to this model';
        break;
      case 404:
        // OpenRouter uses 404 for both "no such model" and "blocked by your
        // privacy/data-policy settings." Detect the latter and steer the user.
        if (this.provider === 'openrouter' && /guardrail|data policy/i.test(detail)) {
          hint =
            ' — OpenRouter blocked this model under your privacy / data-policy settings.\n' +
            '  Visit https://openrouter.ai/settings/privacy and enable "Free model training" or pick a paid endpoint';
        } else {
          hint = ' — unknown model, try `/model` to pick another';
        }
        break;
      case 429: {
        const retry = response.headers.get('retry-after');
        hint = ` — rate limited${retry ? ` (retry after ${retry}s)` : ''}`;
        break;
      }
      case 500:
      case 502:
      case 503:
      case 504:
        hint = this.provider === 'openrouter'
          ? ' — OpenRouter / upstream is having a rough moment, try again shortly'
          : ' — xAI is having a rough moment, try again shortly';
        break;
    }

    throw new Error(`Grok API error ${status}${hint}${detail ? `: ${detail}` : ''}`);
  }

  async chat(
    messages: GrokMessage[],
    tools?: Tool[],
    options: ChatOptions = {}
  ): Promise<GrokCompletionResponse> {
    const request = this.buildRequest(messages, tools, false, options);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) await this.handleError(response);
    return response.json() as Promise<GrokCompletionResponse>;
  }

  async *chatStream(
    messages: GrokMessage[],
    tools?: Tool[],
    options: ChatOptions = {}
  ): AsyncGenerator<StreamChunk> {
    const request = this.buildRequest(messages, tools, true, options);

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(request),
      signal: options.signal,
    });

    if (!response.ok) await this.handleError(response);

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          if (trimmed === 'data: [DONE]') return;
          if (!trimmed.startsWith('data: ')) continue;
          try {
            const chunk = JSON.parse(trimmed.slice(6)) as StreamChunk;
            yield chunk;
          } catch {
            // Ignore incomplete chunks
          }
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // ignore
      }
    }
  }

  async listModels(): Promise<string[]> {
    const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });

    if (!response.ok) await this.handleError(response);

    const data = await response.json() as { data: { id: string }[] };
    let ids = data.data.map((m) => m.id);
    if (this.provider === 'openrouter') {
      ids = ids.filter((id) => id.startsWith('x-ai/'));
    }
    return ids;
  }

  async modelInfo(modelId: string): Promise<Record<string, unknown> | null> {
    if (this.provider === 'openrouter') {
      try {
        const response = await fetch(`${this.baseUrl}/models`, { headers: this.headers() });
        if (!response.ok) return null;
        const all = (await response.json()) as { data: Array<Record<string, unknown>> };
        return all.data.find((m) => m.id === modelId) || null;
      } catch {
        return null;
      }
    }
    try {
      const response = await fetch(`${this.baseUrl}/language-models/${modelId}`, {
        headers: this.headers(),
      });
      if (!response.ok) return null;
      return await response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
