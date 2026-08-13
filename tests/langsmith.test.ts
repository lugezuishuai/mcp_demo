import { afterEach, describe, expect, it } from "vitest";

import { enableLangSmithTracing } from "../src/langsmith.ts";

const trackedNames = ["LANGSMITH_TRACING", "LANGCHAIN_TRACING_V2", "LANGSMITH_API_KEY", "LANGSMITH_PROJECT"] as const;
const originalValues = new Map(trackedNames.map((name) => [name, process.env[name]]));

afterEach(() => {
  // 恢复测试修改的进程环境，防止 tracing 配置污染其他用例。
  for (const name of trackedNames) {
    const value = originalValues.get(name);
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
});

describe("enableLangSmithTracing", () => {
  it("sets both tracing switches and the mcp_demo project", () => {
    const enabled = enableLangSmithTracing({
      apiKey: "langsmith-key",
      projectName: "mcp_demo",
    });

    expect(enabled).toBe(true);
    expect(process.env.LANGSMITH_TRACING).toBe("true");
    expect(process.env.LANGCHAIN_TRACING_V2).toBe("true");
    expect(process.env.LANGSMITH_API_KEY).toBe("langsmith-key");
    expect(process.env.LANGSMITH_PROJECT).toBe("mcp_demo");
  });

  it("keeps tracing disabled when the API key is absent", () => {
    expect(
      enableLangSmithTracing({
        apiKey: undefined,
        projectName: "mcp_demo",
      }),
    ).toBe(false);
    expect(process.env.LANGSMITH_TRACING).toBe("false");
    expect(process.env.LANGCHAIN_TRACING_V2).toBe("false");
  });
});
