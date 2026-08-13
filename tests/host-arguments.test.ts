import { describe, expect, it } from "vitest";

import { parseHostArguments } from "../src/host-arguments.ts";

describe("parseHostArguments", () => {
  it("defaults to stdio and preserves a multi-word prompt", () => {
    expect(parseHostArguments(["search", "the", "web"])).toEqual({
      transport: "stdio",
      prompt: "search the web",
    });
  });

  it.each([
    [["--transport", "sse", "hello"], "sse"],
    [["-t", "streamable-http", "hello"], "streamable-http"],
    [["--transport=stdio", "hello"], "stdio"],
  ] as const)("parses transport form %#", (argv, transport) => {
    expect(parseHostArguments([...argv])).toEqual({
      transport,
      prompt: "hello",
    });
  });

  it("supports interactive mode without a prompt", () => {
    expect(parseHostArguments(["--transport", "sse"])).toEqual({
      transport: "sse",
    });
  });

  it("rejects an unsupported transport", () => {
    expect(() => parseHostArguments(["--transport", "websocket"])).toThrow(/Unsupported MCP transport/);
  });

  it("rejects unknown Host options", () => {
    expect(() => parseHostArguments(["--server", "sse"])).toThrow(/Unknown Host option/);
  });
});
