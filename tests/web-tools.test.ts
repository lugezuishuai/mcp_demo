import { describe, expect, it, vi } from "vitest";

import { executeWebFetch, executeWebSearch, type WebFetchClient, type WebSearchClient } from "../src/web-tools.ts";

describe("web tools", () => {
  it("maps Tavily results to the stable MCP output shape", async () => {
    const search = vi.fn<WebSearchClient["search"]>().mockResolvedValue({
      query: "LangGraph MCP",
      answer: "LangGraph can consume MCP tools through adapters.",
      responseTime: 0.1,
      images: [],
      requestId: "request-1",
      results: [
        {
          title: "LangGraph docs",
          url: "https://example.com/langgraph",
          content: "Documentation excerpt",
          score: 0.98,
          publishedDate: "2026-08-01",
          id: "result-1",
        },
      ],
    });

    const output = await executeWebSearch(
      { search },
      {
        query: "LangGraph MCP",
        maxResults: 3,
        searchDepth: "advanced",
      },
    );

    expect(search).toHaveBeenCalledWith("LangGraph MCP", {
      maxResults: 3,
      searchDepth: "advanced",
      includeAnswer: true,
      includeRawContent: false,
    });
    expect(output.results).toEqual([
      {
        title: "LangGraph docs",
        url: "https://example.com/langgraph",
        content: "Documentation excerpt",
        score: 0.98,
      },
    ]);
  });

  it("truncates Firecrawl Markdown and preserves source metadata", async () => {
    const scrape = vi.fn<WebFetchClient["scrape"]>().mockResolvedValue({
      markdown: `# Title\n\n${"x".repeat(1_200)}`,
      metadata: {
        title: "Fetched title",
        description: "Fetched description",
        sourceURL: "https://example.com/final",
      },
    });

    const output = await executeWebFetch(
      { scrape },
      {
        url: "https://example.com/start",
        maxCharacters: 1_000,
      },
    );

    expect(output.url).toBe("https://example.com/final");
    expect(output.markdown).toHaveLength(1_000);
    expect(output.truncated).toBe(true);
  });

  it("fails clearly when Firecrawl returns no Markdown", async () => {
    const scrape = vi.fn<WebFetchClient["scrape"]>().mockResolvedValue({
      metadata: { sourceURL: "https://example.com/empty" },
    });

    await expect(
      executeWebFetch(
        { scrape },
        {
          url: "https://example.com/empty",
          maxCharacters: 1_000,
        },
      ),
    ).rejects.toThrow(/no Markdown content/);
  });
});
