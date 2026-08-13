import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tavily } from "@tavily/core";
import { Firecrawl } from "firecrawl";
import { z } from "zod";

import type { AppConfig } from "./config.ts";
import { executeWebFetch, executeWebSearch, type WebFetchClient, type WebSearchClient } from "./web-tools.ts";

export interface WebToolDependencies {
  searchClient: WebSearchClient;
  fetchClient: WebFetchClient;
}

/**
 * 创建暴露 web_search 与 web_fetch 的 MCP Server。
 *
 * @param config - 工具凭据和默认结果限制。
 * @param dependencies - 可选客户端依赖；测试时可注入无网络实现。
 * @returns 已注册工具、等待绑定 transport 的 MCP Server。
 */
export function createWebMcpServer(
  config: AppConfig,
  dependencies: WebToolDependencies = createDefaultDependencies(config),
): McpServer {
  const server = new McpServer(
    {
      name: "langgraph-web-tools",
      version: "0.1.0",
    },
    {
      instructions:
        "Use web_search to discover current sources. Use web_fetch to retrieve the main Markdown content of a specific URL.",
    },
  );

  registerWebSearchTool(server, config, dependencies.searchClient);
  registerWebFetchTool(server, config, dependencies.fetchClient);
  return server;
}

/**
 * 注册 Tavily 搜索工具，并把第三方异常转换为 MCP 可识别的工具错误。
 */
function registerWebSearchTool(server: McpServer, config: AppConfig, client: WebSearchClient): void {
  server.registerTool(
    "web_search",
    {
      title: "Web Search",
      description:
        "Search the public web with Tavily. Use for current information, source discovery, and finding relevant URLs.",
      inputSchema: {
        query: z.string().min(1).describe("The search query."),
        max_results: z.number().int().min(1).max(10).optional().describe("Maximum number of results."),
        search_depth: z
          .enum(["basic", "advanced"])
          .optional()
          .describe("Use advanced for broader, higher-quality retrieval at higher cost."),
      },
      outputSchema: {
        query: z.string(),
        answer: z.string().optional(),
        results: z.array(
          z.object({
            title: z.string(),
            url: z.string(),
            content: z.string(),
            score: z.number(),
          }),
        ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ query, max_results, search_depth }) => {
      try {
        const output = await executeWebSearch(client, {
          query,
          maxResults: max_results ?? config.webSearchMaxResults,
          searchDepth: search_depth ?? "basic",
        });
        return toSuccessfulToolResult(output);
      } catch (error) {
        return toFailedToolResult("web_search", error);
      }
    },
  );
}

/**
 * 注册 Firecrawl 页面抓取工具，并限制返回给模型的 Markdown 长度。
 */
function registerWebFetchTool(server: McpServer, config: AppConfig, client: WebFetchClient): void {
  server.registerTool(
    "web_fetch",
    {
      title: "Web Fetch",
      description:
        "Fetch one public URL with Firecrawl and return its main content as Markdown. Use after web_search when full page content is needed.",
      inputSchema: {
        url: z.url().describe("The public HTTP or HTTPS URL to fetch."),
        max_characters: z
          .number()
          .int()
          .min(1_000)
          .max(100_000)
          .optional()
          .describe("Maximum Markdown characters returned to the model."),
      },
      outputSchema: {
        url: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        markdown: z.string(),
        truncated: z.boolean(),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ url, max_characters }) => {
      try {
        const output = await executeWebFetch(client, {
          url,
          maxCharacters: max_characters ?? config.webFetchMaxCharacters,
        });
        return toSuccessfulToolResult(output);
      } catch (error) {
        return toFailedToolResult("web_fetch", error);
      }
    },
  );
}

/**
 * 使用环境变量中的凭据创建真实 Tavily 与 Firecrawl 客户端。
 */
function createDefaultDependencies(config: AppConfig): WebToolDependencies {
  if (!config.tavilyApiKey || !config.firecrawlApiKey) {
    throw new Error("TAVILY_API_KEY and FIRECRAWL_API_KEY are required to create the MCP Server");
  }

  return {
    searchClient: tavily({ apiKey: config.tavilyApiKey }),
    fetchClient: new Firecrawl({ apiKey: config.firecrawlApiKey }),
  };
}

/**
 * 同时返回文本和 structuredContent，兼容普通 MCP Client 与 LangChain Adapter。
 */
function toSuccessfulToolResult(output: Record<string, unknown> | object) {
  return {
    // MCP SDK 的 structuredContent 类型要求字符串索引；业务输出已由 outputSchema 约束。
    structuredContent: output as Record<string, unknown>,
    content: [{ type: "text" as const, text: JSON.stringify(output) }],
  };
}

/**
 * 将任意第三方 SDK 异常收敛成不泄露凭据的 MCP 工具错误。
 */
function toFailedToolResult(toolName: string, error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    isError: true,
    content: [{ type: "text" as const, text: `${toolName} failed: ${message}` }],
  };
}
