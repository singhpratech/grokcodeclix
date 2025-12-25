import { ToolResult } from './registry.js';
import chalk from 'chalk';

export interface WebSearchToolParams {
  query: string;
  num_results?: number;
}

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

// DuckDuckGo HTML search (no API key needed)
async function searchDuckDuckGo(query: string, numResults: number = 10): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    // Use DuckDuckGo HTML version
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
    });

    if (!response.ok) {
      throw new Error(`Search failed: ${response.status} ${response.statusText}`);
    }

    const html = await response.text();

    // Parse results from HTML
    // DuckDuckGo HTML results are in <a class="result__a"> tags
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>([^<]*(?:<[^>]*>[^<]*)*)<\/a>/gi;

    // Alternative: Parse result blocks
    const resultBlocks = html.split('<div class="result results_links results_links_deep web-result');

    for (let i = 1; i < resultBlocks.length && results.length < numResults; i++) {
      const block = resultBlocks[i];

      // Extract URL
      const urlMatch = block.match(/href="([^"]+)"/);
      // Extract title
      const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
      // Extract snippet
      const snippetMatch = block.match(/class="result__snippet"[^>]*>([^<]+)/);

      if (urlMatch && titleMatch) {
        let url = urlMatch[1];
        // DuckDuckGo uses redirect URLs, try to extract actual URL
        if (url.includes('uddg=')) {
          const actualUrl = url.match(/uddg=([^&]+)/);
          if (actualUrl) {
            url = decodeURIComponent(actualUrl[1]);
          }
        }

        results.push({
          title: decodeHtmlEntities(titleMatch[1].trim()),
          url: url,
          snippet: snippetMatch ? decodeHtmlEntities(snippetMatch[1].trim()) : '',
        });
      }
    }

    // If no results found with block parsing, try simpler approach
    if (results.length === 0) {
      const links = html.matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi);
      for (const match of links) {
        if (results.length >= numResults) break;
        let url = match[1];
        if (url.includes('uddg=')) {
          const actualUrl = url.match(/uddg=([^&]+)/);
          if (actualUrl) {
            url = decodeURIComponent(actualUrl[1]);
          }
        }
        results.push({
          title: decodeHtmlEntities(match[2].trim()),
          url: url,
          snippet: '',
        });
      }
    }

  } catch (error) {
    // Fallback: try alternative search
    return await searchWithAlternative(query, numResults);
  }

  return results;
}

// Fallback using a simple web scraping approach
async function searchWithAlternative(query: string, numResults: number): Promise<SearchResult[]> {
  const results: SearchResult[] = [];

  try {
    // Try using DuckDuckGo Lite
    const searchUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; GrokCode/1.0)',
        'Accept': 'text/html',
      },
    });

    if (!response.ok) {
      return results;
    }

    const html = await response.text();

    // Parse lite version results
    const linkMatches = html.matchAll(/<a[^>]*rel="nofollow"[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/gi);

    for (const match of linkMatches) {
      if (results.length >= numResults) break;
      const url = match[1];
      const title = match[2];

      // Skip DuckDuckGo internal links
      if (url.startsWith('/') || url.includes('duckduckgo.com')) continue;

      results.push({
        title: decodeHtmlEntities(title.trim()),
        url: url,
        snippet: '',
      });
    }
  } catch {
    // Return empty results if all methods fail
  }

  return results;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, '/')
    .replace(/&apos;/g, "'");
}

export async function webSearchTool(params: WebSearchToolParams): Promise<ToolResult> {
  try {
    const query = params.query.trim();
    const numResults = Math.min(params.num_results ?? 10, 20);

    if (!query) {
      return {
        success: false,
        output: '',
        error: 'Search query cannot be empty',
      };
    }

    if (query.length > 500) {
      return {
        success: false,
        output: '',
        error: 'Search query too long (maximum 500 characters)',
      };
    }

    const results = await searchDuckDuckGo(query, numResults);

    if (results.length === 0) {
      return {
        success: true,
        output: `${chalk.yellow('No results found for:')} "${query}"\n\nTry:\n  • Using different keywords\n  • Checking spelling\n  • Using fewer, more general terms`,
      };
    }

    let output = `${chalk.cyan('🔍 Search Results for:')} "${query}"\n`;
    output += `${chalk.gray(`Found ${results.length} results`)}\n\n`;

    results.forEach((result, index) => {
      output += `${chalk.bold(`${index + 1}. ${result.title}`)}\n`;
      output += `   ${chalk.blue(result.url)}\n`;
      if (result.snippet) {
        output += `   ${chalk.gray(result.snippet)}\n`;
      }
      output += '\n';
    });

    // Add sources section like Claude Code
    output += `${chalk.cyan('Sources:')}\n`;
    results.forEach((result) => {
      output += `  • [${result.title}](${result.url})\n`;
    });

    return {
      success: true,
      output,
    };
  } catch (error) {
    const err = error as Error;
    return {
      success: false,
      output: '',
      error: `Search failed: ${err.message}`,
    };
  }
}
