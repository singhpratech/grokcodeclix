import { ToolResult } from './registry.js';

export interface WebFetchToolParams {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
}

// Simple HTML to text converter
function htmlToText(html: string): string {
  return html
    // Remove script and style tags with content
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    // Convert block elements to newlines
    .replace(/<\/(p|div|h[1-6]|li|tr|br)>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    // Remove remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    // Clean up whitespace
    .replace(/\n\s*\n/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export async function webFetchTool(params: WebFetchToolParams): Promise<ToolResult> {
  const { url, method = 'GET', headers = {}, body, timeout = 30000 } = params;

  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return {
      success: false,
      output: '',
      error: `Invalid URL: ${url}`,
    };
  }

  // Only allow http/https
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return {
      success: false,
      output: '',
      error: `Unsupported protocol: ${parsedUrl.protocol}`,
    };
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(url, {
      method,
      headers: {
        'User-Agent': 'GrokCodeCLI/1.0',
        ...headers,
      },
      body: body && method !== 'GET' ? body : undefined,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const contentType = response.headers.get('content-type') || '';
    let content: string;

    if (contentType.includes('application/json')) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else if (contentType.includes('text/html')) {
      const html = await response.text();
      content = htmlToText(html);
    } else {
      content = await response.text();
    }

    // Truncate very long responses
    const maxLength = 50000;
    if (content.length > maxLength) {
      content = content.slice(0, maxLength) + '\n\n... (truncated)';
    }

    const statusInfo = `Status: ${response.status} ${response.statusText}`;
    const headerInfo = `Content-Type: ${contentType}`;

    if (!response.ok) {
      return {
        success: false,
        output: content,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    return {
      success: true,
      output: `${statusInfo}\n${headerInfo}\n\n${content}`,
    };
  } catch (error) {
    const err = error as Error;

    if (err.name === 'AbortError') {
      return {
        success: false,
        output: '',
        error: `Request timed out after ${timeout}ms`,
      };
    }

    return {
      success: false,
      output: '',
      error: `Fetch error: ${err.message}`,
    };
  }
}
