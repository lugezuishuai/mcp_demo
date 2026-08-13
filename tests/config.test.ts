import { describe, expect, it } from "vitest";

import { loadConfig, loadMcpHttpServerConfig } from "../src/config.ts";

describe("loadConfig", () => {
  it.each([
    ["openai", "openai"],
    ["gpt", "openai"],
    ["deepseek", "deepseek"],
    ["anthropic", "anthropic"],
    ["claude", "anthropic"],
  ])("normalizes provider %s to %s", (configured, expected) => {
    const config = loadConfig({ MODEL_PROVIDER: configured, API_KEY: "test-key" });
    expect(config.modelProvider).toBe(expected);
  });

  it("uses the provider-specific model key and fixed LangSmith project", () => {
    const config = loadConfig({
      MODEL_PROVIDER: "claude",
      ANTHROPIC_API_KEY: "anthropic-key",
      LANGSMITH_PROJECT: "should-not-override",
    });

    expect(config.apiKey).toBe("anthropic-key");
    expect(config.langSmithProject).toBe("mcp_demo");
  });

  it("parses configurable MCP result limits", () => {
    const config = loadConfig({
      API_KEY: "test-key",
      WEB_SEARCH_MAX_RESULTS: "8",
      WEB_FETCH_MAX_CHARACTERS: "42000",
      MCP_TOOL_TIMEOUT_MS: "90000",
    });

    expect(config.webSearchMaxResults).toBe(8);
    expect(config.webFetchMaxCharacters).toBe(42_000);
    expect(config.mcpToolTimeoutMs).toBe(90_000);
  });

  it("requires both external tool credentials for MCP Server startup", () => {
    expect(() =>
      loadConfig(
        {
          API_KEY: "test-key",
          TAVILY_API_KEY: "tavily-key",
        },
        { requireToolApiKeys: true },
      ),
    ).toThrow(/FIRECRAWL_API_KEY/);
  });

  it("allows the standalone MCP Server to start without a model key", () => {
    expect(() =>
      loadConfig(
        {
          TAVILY_API_KEY: "tavily-key",
          FIRECRAWL_API_KEY: "firecrawl-key",
        },
        {
          requireModelApiKey: false,
          requireToolApiKeys: true,
        },
      ),
    ).not.toThrow();
  });

  it("parses independent SSE and Streamable HTTP listen ports", () => {
    expect(
      loadMcpHttpServerConfig({
        MCP_HTTP_HOST: "localhost",
        MCP_SSE_PORT: "4101",
        MCP_STREAMABLE_HTTP_PORT: "4102",
      }),
    ).toEqual({
      host: "localhost",
      ssePort: 4_101,
      streamableHttpPort: 4_102,
    });
  });
});
