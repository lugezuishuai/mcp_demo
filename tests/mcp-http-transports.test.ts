import { once } from "node:events";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../src/config.ts";
import { createMcpClient, loadWebTools } from "../src/mcp-client.ts";
import {
  createSseMcpApplication,
  createStreamableHttpMcpApplication,
  type McpHttpApplication,
} from "../src/mcp-http-server.ts";
import type { WebToolDependencies } from "../src/mcp-server.ts";
import type { WebFetchClient, WebSearchClient } from "../src/web-tools.ts";

const config: AppConfig = {
  modelProvider: "openai",
  model: "test-model",
  apiKey: "test-key",
  temperature: 0,
  timeoutMs: 1_000,
  maxRetries: 0,
  mcpToolTimeoutMs: 1_000,
  webSearchMaxResults: 5,
  webFetchMaxCharacters: 20_000,
  langSmithProject: "mcp_demo",
  systemPrompt: "test",
};

describe("MCP HTTP transports", () => {
  it("supports initialization and tool calls over deprecated SSE", async () => {
    const dependencies = createDependencies();
    const application = createSseMcpApplication(config, {
      host: "127.0.0.1",
      dependencies,
    });
    const runtime = await listenOnRandomPort(application);
    const client = createMcpClient(config, {
      transport: "sse",
      url: `${runtime.baseUrl}/sse`,
    });

    try {
      await verifyHostClientRoundTrip(client);
      expect(dependencies.searchClient.search).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await runtime.close();
    }
  });

  it("supports initialization and tool calls over Streamable HTTP", async () => {
    const dependencies = createDependencies();
    const application = createStreamableHttpMcpApplication(config, {
      host: "127.0.0.1",
      dependencies,
    });
    const runtime = await listenOnRandomPort(application);
    const client = createMcpClient(config, {
      transport: "streamable-http",
      url: `${runtime.baseUrl}/mcp`,
    });

    try {
      await verifyHostClientRoundTrip(client);
      expect(dependencies.searchClient.search).toHaveBeenCalledOnce();
    } finally {
      await client.close();
      await runtime.close();
    }
  });
});

/**
 * 使用 Host MCP Client 验证 initialize、tools/list 和 tools/call 三段协议流程。
 */
async function verifyHostClientRoundTrip(client: ReturnType<typeof createMcpClient>): Promise<void> {
  const tools = await loadWebTools(client);
  expect(tools.map((tool) => tool.name).sort()).toEqual(["web_fetch", "web_search"]);

  const webSearch = tools.find((tool) => tool.name === "web_search");
  expect(webSearch).toBeDefined();
  await webSearch?.invoke({ query: "MCP transport test" });
}

/**
 * 在随机端口启动应用，避免测试与开发中的固定端口互相冲突。
 */
async function listenOnRandomPort(application: McpHttpApplication) {
  const server = application.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      // 先关闭 MCP 会话释放 SSE 长连接，再关闭 HTTP listener。
      await application.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}

function createDependencies(): WebToolDependencies {
  const search = vi.fn<WebSearchClient["search"]>().mockImplementation(async (query) => ({
    query,
    answer: "MCP transport result",
    responseTime: 0.1,
    images: [],
    requestId: "request-1",
    results: [],
  }));
  const scrape = vi.fn<WebFetchClient["scrape"]>().mockResolvedValue({
    markdown: "# MCP",
    metadata: { sourceURL: "https://example.com/mcp" },
  });

  return {
    searchClient: { search },
    fetchClient: { scrape },
  };
}
