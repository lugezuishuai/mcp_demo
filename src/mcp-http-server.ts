import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Express, Response } from "express";

import type { AppConfig } from "./config.ts";
import { createWebMcpServer, type WebToolDependencies } from "./mcp-server.ts";

interface McpSession<TTransport> {
  server: McpServer;
  transport: TTransport;
}

export interface McpHttpApplication {
  app: Express;
  close(): Promise<void>;
}

export interface CreateMcpHttpApplicationOptions {
  host: string;
  dependencies?: WebToolDependencies;
}

export interface StartMcpHttpServerOptions {
  host: string;
  port: number;
  label: string;
  endpoint: string;
}

/**
 * 创建旧版 HTTP+SSE MCP 应用：GET /sse 建立下行流，POST /messages 接收请求。
 */
export function createSseMcpApplication(
  config: AppConfig,
  options: CreateMcpHttpApplicationOptions,
): McpHttpApplication {
  const app = createBaseApplication(options.host, "sse");
  const sessions = new Map<string, McpSession<SSEServerTransport>>();

  app.get("/sse", async (_request, response) => {
    const server = createServer(config, options.dependencies);
    const transport = new SSEServerTransport("/messages", response);
    const sessionId = transport.sessionId;

    sessions.set(sessionId, { server, transport });
    transport.onclose = () => {
      sessions.delete(sessionId);
    };

    try {
      // connect() 会启动 transport，并通过 endpoint 事件告知 Client 消息上行地址。
      await server.connect(transport);
      console.log(`[mcp-sse] session initialized: ${sessionId}`);
    } catch (error) {
      sessions.delete(sessionId);
      await server.close();
      sendInternalError(response, error);
    }
  });

  app.post("/messages", async (request, response) => {
    const sessionId = typeof request.query.sessionId === "string" ? request.query.sessionId : undefined;
    if (!sessionId) {
      response.status(400).send("Missing sessionId query parameter");
      return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
      response.status(404).send("SSE session not found");
      return;
    }

    try {
      await session.transport.handlePostMessage(request, response, request.body);
    } catch (error) {
      sendInternalError(response, error);
    }
  });

  return {
    app,
    close: () => closeSessions(sessions),
  };
}

/**
 * 创建有状态 Streamable HTTP MCP 应用，所有请求统一使用 /mcp 端点。
 */
export function createStreamableHttpMcpApplication(
  config: AppConfig,
  options: CreateMcpHttpApplicationOptions,
): McpHttpApplication {
  const app = createBaseApplication(options.host, "streamable-http");
  const sessions = new Map<string, McpSession<StreamableHTTPServerTransport>>();

  app.all("/mcp", async (request, response) => {
    const sessionId = readHeader(request.headers["mcp-session-id"]);
    let session = sessionId ? sessions.get(sessionId) : undefined;

    if (sessionId && !session) {
      sendJsonRpcError(response, 404, "MCP session not found");
      return;
    }

    if (!session) {
      if (request.method !== "POST" || !isInitializeRequest(request.body)) {
        sendJsonRpcError(response, 400, "An initialize request without Mcp-Session-Id is required");
        return;
      }

      const server = createServer(config, options.dependencies);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (initializedSessionId) => {
          sessions.set(initializedSessionId, { server, transport });
          console.log(`[mcp-streamable-http] session initialized: ${initializedSessionId}`);
        },
      });
      transport.onclose = () => {
        const closedSessionId = transport.sessionId;
        if (closedSessionId) sessions.delete(closedSessionId);
      };

      // SDK 1.30 的 onclose 可选声明与 exactOptionalPropertyTypes 不兼容，运行时实现满足 Transport。
      await server.connect(transport as Transport);
      session = { server, transport };
    }

    try {
      // POST、GET 与 DELETE 都由同一个 transport 根据 MCP 语义处理。
      await session.transport.handleRequest(request, response, request.body);
    } catch (error) {
      sendInternalError(response, error);
    }
  });

  return {
    app,
    close: () => closeSessions(sessions),
  };
}

/**
 * 监听 HTTP 端口并注册 SIGINT/SIGTERM 清理，供两个网络入口复用。
 */
export async function startMcpHttpServer(
  application: McpHttpApplication,
  options: StartMcpHttpServerOptions,
): Promise<HttpServer> {
  const httpServer = await listen(application.app, options);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[${options.label}] shutting down`);

    await application.close();
    await closeHttpServer(httpServer);
    process.kill(process.pid, signal);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  console.log(`[${options.label}] listening on http://${options.host}:${options.port}${options.endpoint}`);
  return httpServer;
}

/**
 * 为网络 Server 创建带 localhost DNS rebinding 防护和健康检查的 Express 应用。
 */
function createBaseApplication(host: string, transport: string): Express {
  const app = createMcpExpressApp({ host });
  app.get("/healthz", (_request, response) => {
    response.json({ ok: true, transport });
  });
  return app;
}

/**
 * 每个 HTTP 会话使用独立 McpServer，避免一个 Server 绑定多个 transport。
 */
function createServer(config: AppConfig, dependencies: WebToolDependencies | undefined): McpServer {
  return dependencies ? createWebMcpServer(config, dependencies) : createWebMcpServer(config);
}

/**
 * 关闭全部会话；先清空 Map，避免 transport.onclose 与关闭循环互相干扰。
 */
async function closeSessions<TTransport>(sessions: Map<string, McpSession<TTransport>>): Promise<void> {
  const activeSessions = [...sessions.values()];
  sessions.clear();
  await Promise.allSettled(activeSessions.map((session) => session.server.close()));
}

/**
 * 启动 Express HTTP Server，并把异步 listen 错误转成 Promise rejection。
 */
function listen(app: Express, options: StartMcpHttpServerOptions): Promise<HttpServer> {
  return new Promise((resolve, reject) => {
    const server = app.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve(server);
    });
    server.once("error", reject);
  });
}

/**
 * 停止接收新连接，并等待现有 HTTP 连接结束。
 */
function closeHttpServer(server: HttpServer): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function readHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJsonRpcError(response: Response, status: number, message: string): void {
  response.status(status).json({
    jsonrpc: "2.0",
    error: { code: -32_000, message },
    id: null,
  });
}

function sendInternalError(response: Response, error: unknown): void {
  console.error(error);
  if (!response.headersSent) {
    sendJsonRpcError(response, 500, "Internal server error");
  }
}
