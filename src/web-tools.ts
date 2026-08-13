import type { TavilySearchResponse } from "@tavily/core";
import type { Document as FirecrawlDocument } from "firecrawl";

export interface WebSearchInput {
  query: string;
  maxResults: number;
  searchDepth: "basic" | "advanced";
}

export interface WebFetchInput {
  url: string;
  maxCharacters: number;
}

export interface WebSearchClient {
  search(
    query: string,
    options: {
      maxResults: number;
      searchDepth: "basic" | "advanced";
      includeAnswer: true;
      includeRawContent: false;
    },
  ): Promise<TavilySearchResponse>;
}

export interface WebFetchClient {
  scrape(
    url: string,
    options: {
      formats: ["markdown"];
      onlyMainContent: true;
    },
  ): Promise<FirecrawlDocument>;
}

export interface WebSearchOutput {
  query: string;
  answer?: string;
  results: Array<{
    title: string;
    url: string;
    content: string;
    score: number;
  }>;
}

export interface WebFetchOutput {
  url: string;
  title?: string;
  description?: string;
  markdown: string;
  truncated: boolean;
}

/**
 * 使用 Tavily 搜索网页，并只保留 Agent 回答所需的稳定字段。
 *
 * @param client - Tavily 搜索客户端，支持测试时注入替身。
 * @param input - 搜索词、结果数量和检索深度。
 * @returns 适合通过 MCP 返回给模型的精简搜索结果。
 */
export async function executeWebSearch(client: WebSearchClient, input: WebSearchInput): Promise<WebSearchOutput> {
  const response = await client.search(input.query, {
    maxResults: input.maxResults,
    searchDepth: input.searchDepth,
    includeAnswer: true,
    includeRawContent: false,
  });

  return {
    query: response.query,
    ...(response.answer ? { answer: response.answer } : {}),
    results: response.results.map((result) => ({
      title: result.title,
      url: result.url,
      content: result.content,
      score: result.score,
    })),
  };
}

/**
 * 使用 Firecrawl 抓取单个页面的主体 Markdown，并限制回传上下文大小。
 *
 * @param client - Firecrawl 抓取客户端，支持测试时注入替身。
 * @param input - 目标 URL 与最大返回字符数。
 * @returns 页面元数据、Markdown 和是否被截断的标记。
 */
export async function executeWebFetch(client: WebFetchClient, input: WebFetchInput): Promise<WebFetchOutput> {
  const document = await client.scrape(input.url, {
    formats: ["markdown"],
    onlyMainContent: true,
  });
  const markdown = document.markdown?.trim();

  if (!markdown) {
    throw new Error(`Firecrawl returned no Markdown content for ${input.url}`);
  }

  // 截断只影响发送给模型的内容，保留明确标志避免模型误以为已读取全文。
  const truncated = markdown.length > input.maxCharacters;
  const metadata = document.metadata;
  return {
    url: metadata?.sourceURL ?? metadata?.url ?? input.url,
    ...(metadata?.title ? { title: metadata.title } : {}),
    ...(metadata?.description ? { description: metadata.description } : {}),
    markdown: truncated ? markdown.slice(0, input.maxCharacters) : markdown,
    truncated,
  };
}
