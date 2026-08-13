import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { fakeModel } from "@langchain/core/testing";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createHostAgentGraph } from "../src/host-agent.ts";

describe("Host Agent graph", () => {
  it("executes a discovered MCP tool and returns the model summary", async () => {
    const search = vi.fn().mockResolvedValue('{"results":[{"url":"https://example.com"}]}');
    const webSearch = new DynamicStructuredTool({
      name: "web_search",
      description: "Search the web",
      schema: z.object({ query: z.string() }),
      func: search,
    });
    const model = fakeModel()
      .respondWithTools([
        {
          name: "web_search",
          args: { query: "latest MCP release" },
          id: "tool-call-1",
        },
      ])
      .respond(new AIMessage("The latest source is https://example.com."));
    const graph = createHostAgentGraph(model, [webSearch], "Use web tools.", {
      useLocalMemorySaver: false,
    });

    const result = await graph.invoke({
      messages: [new HumanMessage("Find the latest MCP release")],
    });

    expect(search).toHaveBeenCalledWith(
      { query: "latest MCP release" },
      undefined,
      expect.objectContaining({ toolCall: expect.any(Object) }),
    );
    expect(result.messages.some(ToolMessage.isInstance)).toBe(true);
    expect(result.messages.at(-1)?.text).toBe("The latest source is https://example.com.");
  });
});
