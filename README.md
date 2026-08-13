# LangGraph MCP Demo (TypeScript + Node.js)

一个可本地运行、调试和验证的 MCP Demo，包含完整的三方角色：

- **Host Agent**：LangGraph Agent，负责承载 LLM、管理多轮状态并决定何时调用工具。
- **MCP Client**：运行在 Host 内，按启动参数选择 Stdio、SSE 或 Streamable HTTP，并动态执行
  `tools/list`。
- **MCP Server**：提供 Stdio、SSE、Streamable HTTP 三种独立入口，共享 `web_search` 和
  `web_fetch` 两个标准 MCP Tool。

实现参考了飞书文档《MCP 详解》的 Host-Client-Server 分层、动态能力发现和传输层生命周期，
也复用了 `~/own/a2a_demo` 中的多模型工厂、环境变量校验、LangSmith 和本地调试模式。

## 架构

```text
User
  |
  v
Host Agent (LangGraph: model -> tools -> model)
  |  function calling
  v
MCP Client (@modelcontextprotocol/sdk + @langchain/mcp-adapters)
  |  MCP / JSON-RPC 2.0
  v
MCP Server (@modelcontextprotocol/sdk)
  |-- Stdio (Host 默认)
  |-- SSE: GET /sse + POST /messages
  |-- Streamable HTTP: /mcp
  |-- web_search -> Tavily
  `-- web_fetch  -> Firecrawl
```

Host 不复制 Server 的工具 schema。启动时，MCP Client 完成 `initialize` 和 `tools/list`，
再把动态加载的 LangChain Tools 绑定给模型。模型通过 Function Calling 表达调用意图，
MCP 负责发现、传输和执行工具。

具体协议调用顺序：

1. `Client.connect(transport)` 自动执行 `initialize` 和 `notifications/initialized`；
2. `loadMcpTools()` 执行 `tools/list`，并转换为 LangChain `DynamicStructuredTool`；
3. 模型调用动态工具时，Adapter 自动执行 `tools/call`；
4. Host 退出时关闭 MCP Client；Stdio 模式同时终止 Server 子进程。

## 环境要求

- Node.js 20+，已在 nvm 管理的 Node.js 22 环境验证
- OpenAI、DeepSeek 或 Anthropic 模型 Key
- Tavily API Key
- Firecrawl API Key
- 可选：LangSmith API Key

## 快速开始

```bash
npm install
npm run env:init
```

编辑 `.env`：

```dotenv
MODEL_PROVIDER=openai
MODEL=gpt-4o-mini
API_KEY=your-model-key

TAVILY_API_KEY=your-tavily-key
FIRECRAWL_API_KEY=your-firecrawl-key

# SSE 与 Streamable HTTP 的监听配置
MCP_HTTP_HOST=127.0.0.1
MCP_SSE_PORT=3001
MCP_STREAMABLE_HTTP_PORT=3002

LANGSMITH_API_KEY=your-langsmith-key
```

模型推理参数、工具超时和结果上限等完整配置见 `.env.example`。

先做无费用诊断。该命令会构造模型、启动 MCP Server 子进程并完成
`initialize -> tools/list`，但不会调用模型、Tavily 或 Firecrawl：

```bash
npm run doctor
```

Host 命令按 transport 拆分，执行单轮请求：

```bash
npm run host:stdio -- "搜索 LangGraph 最新版本，抓取官方页面并给出来源"
npm run host:sse -- "搜索 MCP 最新规范"
npm run host:streamable-http -- "搜索 MCP 最新规范"
```

`host:sse` 和 `host:streamable-http` 只连接网络 Server，运行前需先启动对应的
`mcp:sse` 或 `mcp:streamable-http` 命令。

不提供消息时进入多轮交互模式：

```bash
npm run host:stdio
```

终端使用 `user >` 接收输入、`assistant >` 输出回答，同一进程内复用 `contextId`
保持多轮 LangGraph 上下文。`exit` 和 `quit` 不区分大小写。

开发时可使用 watch 模式，参数仍放在 `--` 后：

```bash
npm run dev -- --transport stdio
npm run dev -- --transport sse
npm run dev -- --transport streamable-http
```

Host 总会关闭 MCP Client；Stdio 模式还会停止它启动的 Server 子进程。

Stdio 模式下 Host 需要模型 Key、`TAVILY_API_KEY` 和 `FIRECRAWL_API_KEY`。SSE 和
Streamable HTTP 模式下，工具 Key 只需要配置在独立 Server 进程中，Host 只需要模型 Key。

## 模型配置

| `MODEL_PROVIDER`       | LangChain 适配器                  | 示例 `MODEL`        | Key                              |
| ---------------------- | --------------------------------- | ------------------- | -------------------------------- |
| `openai` / `gpt`       | `ChatOpenAI`                      | `gpt-4o-mini`       | `API_KEY` 或 `OPENAI_API_KEY`    |
| `deepseek`             | `ChatOpenAI`（OpenAI compatible） | `deepseek-chat`     | `API_KEY` 或 `DEEPSEEK_API_KEY`  |
| `anthropic` / `claude` | `ChatAnthropic`                   | `claude-sonnet-4-6` | `API_KEY` 或 `ANTHROPIC_API_KEY` |

可通过 `BASE_URL` 配置兼容端点。DeepSeek 未配置时默认使用
`https://api.deepseek.com`。`deepseek-v4-flash` 会启用 Responses API，其他
DeepSeek 模型使用 Chat Completions。

## MCP 工具

### `web_search`

使用 Tavily 搜索公开网页：

- `query`：查询词，必填
- `max_results`：1-10，默认读取 `WEB_SEARCH_MAX_RESULTS`
- `search_depth`：`basic` 或 `advanced`

### `web_fetch`

使用 Firecrawl 抓取单个 URL 的主体 Markdown：

- `url`：HTTP/HTTPS URL，必填
- `max_characters`：1000-100000，默认读取 `WEB_FETCH_MAX_CHARACTERS`

结果包含 `truncated`，让 Agent 能识别内容是否被截断。

## 三种 MCP Server

三个入口共享同一套工具注册，不会因传输方式不同产生工具行为差异。

| 传输            | Server 命令                   | Inspector 命令                        | 地址 / 用途                              |
| --------------- | ----------------------------- | ------------------------------------- | ---------------------------------------- |
| Stdio           | `npm run mcp:stdio`           | `npm run mcp:inspect:stdio`           | stdin/stdout；Host 默认并自动拉起        |
| SSE             | `npm run mcp:sse`             | `npm run mcp:inspect:sse`             | `/sse` + `/messages`；旧客户端兼容，弃用 |
| Streamable HTTP | `npm run mcp:streamable-http` | `npm run mcp:inspect:streamable-http` | `/mcp`；现行远程推荐传输                 |

Inspector 会自动完成初始化、能力发现和工具调用。SSE 与 Streamable HTTP 的 Inspector
只连接已有网络 Server，因此必须先运行对应 Server 命令；Stdio Inspector 会自行启动子进程。

### Stdio

```bash
npm run mcp:stdio
```

Stdio 的 stdout 专用于 JSON-RPC，不能直接在终端输入普通文本。推荐使用 MCP Inspector
调试握手、工具 schema 和调用结果：

```bash
npm run mcp:inspect:stdio
```

Host 也会自动启动同一个 Stdio 入口，无需提前手动运行 Server：

```bash
npm run host:stdio -- "搜索 LangGraph 最新版本并给出来源"
```

### SSE

先启动 SSE Server：

```bash
npm run mcp:sse
```

启动另一个终端连接 Inspector：

```bash
npm run mcp:inspect:sse
```

再在另一个终端启动 Host：

```bash
npm run host:sse -- "搜索 LangGraph 最新版本并给出来源"
```

默认地址：

- SSE 下行流：`http://127.0.0.1:3001/sse`
- Client 消息上行：`http://127.0.0.1:3001/messages`
- 健康检查：`http://127.0.0.1:3001/healthz`

SSE 是旧版双端点协议，只用于兼容或对比验证，新接入应使用 Streamable HTTP。

### Streamable HTTP

先启动 Streamable HTTP Server：

```bash
npm run mcp:streamable-http
```

启动另一个终端连接 Inspector：

```bash
npm run mcp:inspect:streamable-http
```

再在另一个终端启动 Host：

```bash
npm run host:streamable-http -- "搜索 LangGraph 最新版本并给出来源"
```

默认地址：

- MCP 单端点：`http://127.0.0.1:3002/mcp`
- 健康检查：`http://127.0.0.1:3002/healthz`

该实现使用有状态 session，初始化响应通过 `Mcp-Session-Id` 返回会话 ID，后续
`POST/GET/DELETE` 都复用 `/mcp`。

## VS Code 调试

`.vscode/launch.json` 提供：

- `MCP: Debug Stdio Server`
- `MCP: Debug SSE Server`
- `MCP: Debug Streamable HTTP Server`
- `MCP: Debug Host Agent`
- `MCP: Debug SSE + Streamable HTTP`

Host 调试配置通过 `args` 选择 transport：

```json
"args": ["--transport", "sse"]
```

可将值替换为 `stdio` 或 `streamable-http`。调试网络 transport 时，应先启动对应
Server 配置，再启动 Host；Stdio Host 会自行启动 Server 子进程。

## LangSmith Tracing 与 Studio

配置 `LANGSMITH_API_KEY` 后，CLI 和 Studio 的 traces 都写入固定项目
`mcp_demo`。启动 Studio：

```bash
npm run studio
```

LangGraph CLI 会读取 `langgraph.json` 和 `.env`，加载 `host_agent` 图。Studio
入口不使用本地 `MemorySaver`，线程状态由 LangGraph Agent Server 管理。
默认端口为 `2024`；端口已占用时可覆盖：

```bash
npm run studio -- --port 21234
```

## 本地验证

```bash
npm run check
npm run format:check
npm test
npm run build
```

测试不需要真实外部 Key。MCP 集成测试使用 Tavily/Firecrawl 替身，真实覆盖：

1. MCP Client/Server 初始化握手；
2. `tools/list` 动态能力发现；
3. `web_search` 与 `web_fetch` 的 `tools/call`；
4. InMemory、SSE 与 Streamable HTTP 三种协议链路；
5. Host transport 参数解析与网络连接选择；
6. LangGraph 的模型、工具、模型循环；
7. 模型 Provider、监听端口与 LangSmith 环境配置。

当前测试集共 33 个用例。

## 项目结构

```text
.vscode/
  launch.json             三种 Server 与 Host 调试配置
scripts/
  init-env.ts             安全创建本地 .env
src/
  config.ts               环境变量解析与校验
  doctor.ts               本地配置和 Stdio 协议诊断
  host-agent-studio.ts    LangSmith Studio 图入口
  host-agent.ts           Host Agent 与 LangGraph
  host-arguments.ts       Host transport 与消息参数解析
  host-entry.ts           单轮与终端交互入口
  langsmith.ts            LangSmith tracing 配置
  mcp-client.ts           三种 transport 与 LangChain Tool 适配
  mcp-server.ts           MCP Tool 注册
  mcp-http-server.ts      SSE / Streamable HTTP 会话与生命周期
  mcp-server-sse-entry.ts SSE MCP Server 入口
  mcp-server-stdio-entry.ts
                          Stdio MCP Server 入口
  mcp-server-streamable-http-entry.ts
                          Streamable HTTP MCP Server 入口
  model-factory.ts        OpenAI / DeepSeek / Anthropic 模型工厂
  web-tools.ts            Tavily / Firecrawl 业务适配
tests/
  config.test.ts          环境变量校验测试
  host-agent.test.ts      LangGraph 工具循环测试
  host-arguments.test.ts  Host CLI 参数测试
  langsmith.test.ts       Tracing 配置测试
  mcp-client.test.ts      MCP transport 连接配置测试
  mcp-http-transports.test.ts
                          SSE / Streamable HTTP 网络集成测试
  mcp-integration.test.ts InMemory MCP 协议闭环测试
  model-factory.test.ts   多模型工厂测试
  web-tools.test.ts       Tavily / Firecrawl 适配测试
langgraph.json            LangGraph Studio 配置
```

## 实现约束

- 凭据只从环境变量读取，不写入源码、工具描述或返回结果。
- Stdio Server 的 stdout 只输出 JSON-RPC 帧，诊断日志写入 stderr。
- HTTP Server 默认只绑定 `127.0.0.1`，并启用 localhost Host Header 防护。
- 两个工具都标记为只读、幂等和开放世界访问。
- Firecrawl 内容在 Server 端截断，避免无限制占用模型上下文。
