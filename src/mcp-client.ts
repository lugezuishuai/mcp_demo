import { loadMcpTools } from "@langchain/mcp-adapters";
import type { DynamicStructuredTool } from "@langchain/core/tools";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { resolve } from "node:path";

import type { AppConfig, McpHttpServerConfig } from "./config.ts";

export type McpTransportType = "stdio" | "sse" | "streamable-http";

export type McpServerConnection =
  { transport: "stdio" } | { transport: "sse"; url: string } | { transport: "streamable-http"; url: string };

/**
 * 创建 Host 内部的 MCP Client，并按连接参数选择对应 transport。
 *
 * @param config - MCP 工具超时等运行配置。
 * @param connection - Stdio 子进程或网络 MCP Server 连接信息。
 * @returns 管理协议会话和 LangChain 工具适配的客户端。
 */
export function createMcpClient(
  config: AppConfig,
  connection: McpServerConnection = { transport: "stdio" },
): WebMcpClient {
  const transport = createTransport(config, connection);
  const client = new Client({
    name: "langgraph-mcp-host",
    version: "0.1.0",
  });

  return new WebMcpClient(client, transport, config.mcpToolTimeoutMs);
}

/**
 * 将 CLI transport 参数和 HTTP 监听配置转换为 MCP Client 连接信息。
 */
export function createMcpServerConnection(
  transport: McpTransportType,
  httpConfig: McpHttpServerConfig,
): McpServerConnection {
  if (transport === "stdio") return { transport };

  // Server 可能监听所有网卡，但 Client 必须使用可连接的具体本机地址。
  const clientHost = httpConfig.host === "0.0.0.0" || httpConfig.host === "::" ? "127.0.0.1" : httpConfig.host;
  const urlHost = clientHost.includes(":") ? `[${clientHost}]` : clientHost;

  if (transport === "sse") {
    return {
      transport,
      url: `http://${urlHost}:${httpConfig.ssePort}/sse`,
    };
  }
  return {
    transport,
    url: `http://${urlHost}:${httpConfig.streamableHttpPort}/mcp`,
  };
}

/**
 * 创建具体 transport；只有 Stdio 模式会由 Host 拉起本地子进程。
 */
function createTransport(config: AppConfig, connection: McpServerConnection): Transport {
  if (connection.transport === "sse") {
    return new SSEClientTransport(new URL(connection.url));
  }
  if (connection.transport === "streamable-http") {
    // SDK 1.30 的可选回调声明与 exactOptionalPropertyTypes 不兼容，运行时实现满足 Transport。
    return new StreamableHTTPClientTransport(new URL(connection.url)) as Transport;
  }

  const serverEntry = resolve(process.cwd(), "src/mcp-server-stdio-entry.ts");
  const childEnvironment = createChildEnvironment(config);
  return new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", serverEntry],
    cwd: process.cwd(),
    env: childEnvironment,
    stderr: "inherit",
  });
}

/**
 * 显式向 stdio 子进程透传环境，并以已校验配置覆盖两个工具 Key。
 *
 * Stdio transport 默认只转发一组安全变量，需显式补充 Server 使用的工具凭据。
 */
function createChildEnvironment(config: AppConfig): Record<string, string> {
  return {
    ...getDefaultEnvironment(),
    ...(config.tavilyApiKey ? { TAVILY_API_KEY: config.tavilyApiKey } : {}),
    ...(config.firecrawlApiKey ? { FIRECRAWL_API_KEY: config.firecrawlApiKey } : {}),
  };
}

/**
 * 显式管理一个 MCP Client 与 transport，保证 Host 退出时连接被关闭。
 */
export class WebMcpClient {
  private connected = false;

  constructor(
    private readonly client: Client,
    private readonly transport: Transport,
    private readonly toolTimeoutMs: number,
  ) {}

  /**
   * 完成 initialize 与 tools/list，并将 MCP Tools 转换为 LangChain Tools。
   */
  async loadTools(): Promise<DynamicStructuredTool[]> {
    if (!this.connected) {
      // 初始化 Client 连接（initialize、notification/initialized）
      await this.client.connect(this.transport);
      this.connected = true;
    }

    // tools/list
    const tools = await loadMcpTools("web", this.client, {
      throwOnLoadError: true,
      prefixToolNameWithServerName: false,
      useStandardContentBlocks: true,
      defaultToolTimeout: this.toolTimeoutMs,
    });
    const toolNames = new Set(tools.map((tool) => tool.name));
    const missingTools = ["web_search", "web_fetch"].filter((name) => !toolNames.has(name));

    if (missingTools.length > 0) {
      throw new Error(`MCP Server did not expose required tools: ${missingTools.join(", ")}`);
    }
    return tools;
  }

  /**
   * 关闭协议连接并直接关闭 transport；Stdio transport 还负责终止子进程。
   */
  async close(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client.close();
    } finally {
      // transport.close() 具备幂等性，显式调用可覆盖上层 Client 关闭不完整的情况。
      await this.transport.close();
      this.connected = false;
    }
  }
}

/**
 * 保留独立加载函数，让 Host 与诊断入口共享能力发现校验流程。
 */
export async function loadWebTools(client: WebMcpClient): Promise<DynamicStructuredTool[]> {
  return client.loadTools();
}
