import type { McpTransportType } from "./mcp-client.ts";

export interface HostArguments {
  transport: McpTransportType;
  prompt?: string;
}

const SUPPORTED_TRANSPORTS = new Set<McpTransportType>(["stdio", "sse", "streamable-http"]);

/**
 * 解析 Host CLI 参数，支持 --transport value、--transport=value 和 -t value。
 */
export function parseHostArguments(argv: string[]): HostArguments {
  let transport: McpTransportType = "stdio";
  const promptParts: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--") {
      promptParts.push(...argv.slice(index + 1));
      break;
    }

    if (argument === "--transport" || argument === "-t") {
      const value = argv[index + 1];
      if (!value) {
        throw new Error(`${argument} requires a transport value`);
      }
      transport = parseTransport(value);
      index += 1;
      continue;
    }

    if (argument?.startsWith("--transport=")) {
      transport = parseTransport(argument.slice("--transport=".length));
      continue;
    }

    if (argument?.startsWith("-")) {
      throw new Error(`Unknown Host option: ${argument}`);
    }
    if (argument) promptParts.push(argument);
  }

  const prompt = promptParts.join(" ").trim();
  return {
    transport,
    ...(prompt ? { prompt } : {}),
  };
}

/**
 * 校验 transport 名称并返回收窄后的联合类型。
 */
function parseTransport(value: string): McpTransportType {
  if (SUPPORTED_TRANSPORTS.has(value as McpTransportType)) {
    return value as McpTransportType;
  }
  throw new Error(`Unsupported MCP transport "${value}". Expected stdio, sse, or streamable-http`);
}
