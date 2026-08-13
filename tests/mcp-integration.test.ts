import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.ts";
import { createWebMcpServer } from "../src/mcp-server.ts";
import type { WebFetchClient, WebSearchClient } from "../src/web-tools.ts";

const config: AppConfig = {
  modelProvider: "openai",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0,
  timeoutMs: 1_000,
  maxRetries: 0,
  tavilyApiKey: "tavily-key",
  firecrawlApiKey: "firecrawl-key",
  mcpToolTimeoutMs: 1_000,
  webSearchMaxResults: 5,
  webFetchMaxCharacters: 20_000,
  langSmithProject: "mcp_demo",
  systemPrompt: "test",
};

const closers: Array<() => Promise<void>> = [];

afterEach(async () => {
  // 每个用例都关闭协议两端，避免 transport 回调泄漏到后续测试。
  await Promise.allSettled(closers.splice(0).map((close) => close()));
});

describe("MCP protocol integration", () => {
  it("discovers and invokes web_search and web_fetch through MCP", async () => {
    const search = vi.fn<WebSearchClient["search"]>().mockResolvedValue({
      query: "MCP",
      answer: "Model Context Protocol",
      responseTime: 0.1,
      images: [],
      requestId: "request-1",
      results: [
        {
          title: "MCP",
          url: "https://example.com/mcp",
          content: "Protocol overview",
          score: 0.99,
          publishedDate: "2026-08-01",
          id: "result-1",
        },
      ],
    });
    const scrape = vi.fn<WebFetchClient["scrape"]>().mockResolvedValue({
      markdown: "# MCP\n\nProtocol details",
      metadata: {
        title: "MCP details",
        sourceURL: "https://example.com/mcp",
      },
    });
    const server = createWebMcpServer(config, {
      searchClient: { search },
      fetchClient: { scrape },
    });
    const client = new Client({ name: "integration-test", version: "0.1.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

    await server.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(
      () => client.close(),
      () => server.close(),
    );

    // tools/list 验证能力发现，随后分别走两次 tools/call 验证协议参数与结果。
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["web_fetch", "web_search"]);

    const searchResult = await client.callTool({
      name: "web_search",
      arguments: {
        query: "MCP",
        max_results: 2,
        search_depth: "advanced",
      },
    });
    const fetchResult = await client.callTool({
      name: "web_fetch",
      arguments: {
        url: "https://example.com/mcp",
        max_characters: 2_000,
      },
    });

    expect(search).toHaveBeenCalledOnce();
    expect(scrape).toHaveBeenCalledOnce();
    expect(searchResult.isError).not.toBe(true);
    expect(fetchResult.isError).not.toBe(true);
    expect(searchResult.structuredContent).toMatchObject({
      query: "MCP",
      answer: "Model Context Protocol",
    });
    expect(fetchResult.structuredContent).toMatchObject({
      title: "MCP details",
      markdown: "# MCP\n\nProtocol details",
      truncated: false,
    });
  });
});
