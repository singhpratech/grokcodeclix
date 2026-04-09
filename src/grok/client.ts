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

export class GrokClient {
  private apiKey: string;
  private baseUrl: string = 'https://api.x.ai/v1';
  public model: string;

  constructor(apiKey: string, model: string = 'grok-4-1-fast-reasoning', baseUrl?: string) {
    this.apiKey = apiKey;
    this.model = model;
    if (baseUrl) this.baseUrl = baseUrl;
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
        hint = ' — check your XAI_API_KEY (run `grok auth`)';
        break;
      case 403:
        hint = ' — your account may not have access to this model';
        break;
      case 404:
        hint = ' — unknown model, try `/model` to pick another';
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
        hint = ' — xAI is having a rough moment, try again shortly';
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
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
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
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
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { 'Authorization': `Bearer ${this.apiKey}` },
    });

    if (!response.ok) await this.handleError(response);

    const data = await response.json() as { data: { id: string }[] };
    return data.data.map((m) => m.id);
  }

  async modelInfo(modelId: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/language-models/${modelId}`, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      if (!response.ok) return null;
      return await response.json() as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}
