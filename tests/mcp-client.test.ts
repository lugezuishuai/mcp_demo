import { describe, expect, it } from "vitest";

import type { McpHttpServerConfig } from "../src/config.ts";
import { createMcpServerConnection } from "../src/mcp-client.ts";

const httpConfig: McpHttpServerConfig = {
  host: "127.0.0.1",
  ssePort: 3_001,
  streamableHttpPort: 3_002,
};

describe("createMcpServerConnection", () => {
  it("keeps stdio as a process connection", () => {
    expect(createMcpServerConnection("stdio", httpConfig)).toEqual({
      transport: "stdio",
    });
  });

  it("builds the SSE endpoint from HTTP configuration", () => {
    expect(createMcpServerConnection("sse", httpConfig)).toEqual({
      transport: "sse",
      url: "http://127.0.0.1:3001/sse",
    });
  });

  it("builds the Streamable HTTP endpoint from HTTP configuration", () => {
    expect(createMcpServerConnection("streamable-http", httpConfig)).toEqual({
      transport: "streamable-http",
      url: "http://127.0.0.1:3002/mcp",
    });
  });

  it("maps all-interface bind hosts to a connectable loopback address", () => {
    expect(
      createMcpServerConnection("sse", {
        ...httpConfig,
        host: "0.0.0.0",
      }),
    ).toMatchObject({
      url: "http://127.0.0.1:3001/sse",
    });
  });
});
