# DSWeave · Agent 接入设计

> 文档版本：v0.2 ｜ 配套：`01-architecture.md`、`02-technical-design.md`、`03-implementation-plan.md`、`04-player.md`
>
> **接入路线（已更新）**：
> - **M4**：通过 [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp) 接入 **Claude Code**（现成官方 ACP agent，走 stdio）。先把主竖切 + SceneSpec 链路跑通。
> - **M6**：把自有的 **dscode**（DeepSeek V4 Pro）作为**内置 agent** 接入（headless `AcpBackend`，不走 MCP）。后置。

---

## 1. 接入策略

Agent 始终是**可插拔**的：`web → Host(内部协议) → Agent(ACP over stdio)`。Host 在 stdio 边界说 **官方 ACP**（`@agentclientprotocol/sdk`），不同 Agent 实现只要是合规 ACP agent 即可热插拔，DSWeave 前端零改动。

| 阶段 | Agent | 形态 | 价值 |
| --- | --- | --- | --- |
| M2/M3 | Mock | 进程内 / stdio | 验证可插拔抽象、文件理解链路 |
| **M4** | **Claude Code** | `claude-agent-acp`（外部 npm，stdio） | 不自研 agent 即可跑通真实竖切 + SceneSpec |
| M6 | dscode | 内置 headless `AcpBackend` | 自有引擎、DeepSeek、可深度定制 |

> 先接 Claude Code 的理由：它是**现成、稳定的官方 ACP agent**，让我们把精力集中在「Player 渲染 + SceneSpec 契约 + scene.html 注入 + 产物交付」这条主竖切上，而不是同时调试一个新 agent 引擎。dscode 内置接入的设计已成熟（见 §4），但可后置到竖切验证之后。

---

## 2. M4 · 接入 Claude Code（`claude-agent-acp`）

### 2.1 事实（已核对 npm，2026-06）

> 注：`@zed-industries/*` 这套 ACP 包已整体**重命名**为 `@agentclientprotocol/*`（旧名仍可用但标 deprecated）。计划文档原本的包名即新名，采用之。

| 项 | 值 |
| --- | --- |
| adapter npm 包 | **`@agentclientprotocol/claude-agent-acp@0.50.0`**（Apache-2.0；旧名 `@zed-industries/claude-code-acp@0.16.2` 已 deprecated） |
| 启动 | bin `claude-agent-acp`；`npx -y @agentclientprotocol/claude-agent-acp`，stdio |
| 运行时 | Node ≥ 20（本机 v22 ✅） |
| 协议 SDK | 官方 **`@agentclientprotocol/sdk@0.29.0`**（`PROTOCOL_VERSION = 1`；`ClientSideConnection` + `ndJsonStream`；旧名 `@zed-industries/agent-client-protocol@0.4.5` 已 deprecated，API 兼容） |
| 底层 | Claude Code CLI（本机 `claude` v2.1.185） |
| 鉴权 | 三选一：① `ANTHROPIC_API_KEY`；② 本机 Claude Code 登录态（`~/.claude.json` / Keychain）；③ **DeepSeek 网关**（`~/.bash_profile` 设 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`）。**本仓阶段 A 实测走 ③（DeepSeek `deepseek-v4-pro`）通过**。Host spawn 时透传 `process.env`，子进程继承。 |
| 能力 | 工具调用 + 权限请求（`session/request_permission`）、`fs/read_text_file`、`fs/write_text_file`、terminals、session/update 流 |

### 2.2 拓扑

```mermaid
graph LR
  U[用户] --> W[Web Canvas]
  W -->|内部协议 over WS| H[DSWeave Host]
  H -->|spawn: claude-agent-acp<br/>官方 ACP over stdio| C[Claude Code Agent]
  C -->|write scene.spec.json| FS[(workspace)]
  H -->|turn 结束读取 + 校验| FS
  H -->|注入 scene.html| P[R3F Player]
  P --> W
```

### 2.3 关键决策一：stdio 边界说「官方 ACP」

`claude-agent-acp` 走官方 ACP 线协议,而我们 `packages/protocol` 是**自研 ACP 形态**（方法名/语义对齐,但非官方线类型）。因此：

- Host 在 stdio 边界**采用 `@agentclientprotocol/sdk` 作为 ACP client** 来 spawn 并对接 `claude-agent-acp`（`packages/host/src/claude/acp-client.ts`）。
- **翻译收敛在一个「Claude 驱动的内部 Agent」里**（`packages/host/src/claude/claude-agent.ts`）：它实现与启发式 agent **完全相同的内部契约**（`AgentSideConnection`：`onPrompt` + `sessionUpdate` + `requestPermission` + `invokeCapability`），但 `onPrompt` 内部经官方 ACP 驱动 `claude-agent-acp`。内部 `session/prompt` → 官方 prompt turn；官方 `session/update`（agent_message_chunk / tool_call）→ 内部 `SessionUpdate`；官方 permission 请求 → 内部 `request_permission`。
- 因此 **`bridge.ts`、内部协议、前端、`CapabilityRegistry` 全部零改动**——仅 Agent 实现从启发式换成 Claude。这正是 `messages.ts` 注释预留的演进点（"M4 接真实 Agent 时，可在 stdio 边界换上官方 SDK 而不影响上层"）。

### 2.4 关键决策二：Claude 如何产出 SceneSpec

Claude 是通用编码 agent,不天然"输出 SceneSpec"。两条路：

| 方案 | 机制 | 取舍 |
| --- | --- | --- |
| **A（首选）写文件** | 系统指令/`CLAUDE.md` 约束：把 SceneSpec JSON 写到 `<workspace>/scene.spec.json`；Host 在 turn 结束读取 + zod 校验 + 注入 Player | 零 MCP；契合编码 agent 强项（写文件）；权限流天然覆盖写操作；可重试 |
| B（备选）Client MCP tool | 用 `claude-agent-acp` 支持的 Client MCP servers 暴露 `set_scene(spec)` 工具 | 更结构化,但引入 MCP 表面 |

> 默认走 **A**。系统指令明确：你的唯一交付物是符合 `SceneSpec` schema 的 `scene.spec.json`,不要写运行时代码（Player 已预构建）。Host 校验失败 → 把错误回灌让 Claude 修正（重试）。

### 2.5 cwd / 鉴权 handshake

| 维度 | 机制 |
| --- | --- |
| **cwd** | 官方 ACP `session/new` 的 `workingDir` → 指向 DSWeave session workspace（flow/assets/`scene.spec.json`/`scene.html`）；Claude 的文件工具据此读写 |
| **鉴权** | Host spawn 时透传 `ANTHROPIC_API_KEY`（操作者提供）；或复用本机 Claude Code 登录态 |
| **模型** | 由 Claude Agent SDK / 环境决定（如 `ANTHROPIC_MODEL`），Host 不另造表面 |

### 2.6 改动清单（本仓，已落地）

| 位置 | 改动 |
| --- | --- |
| `packages/host`（依赖） | `@agentclientprotocol/sdk` 作为 stdio 边界的 ACP client |
| `packages/host/src/claude/acp-client.ts`（新增） | `ClaudeAcpSession`：spawn `claude-agent-acp` + `ClientSideConnection`/`ndJsonStream`；`init(cwd)` → `initialize`/`session/new`；`prompt(text)` 一轮 turn；实现 Client 侧 `requestPermission`/`fs`。adapter 命令可经 `CLAUDE_ACP_CMD`/`CLAUDE_ACP_ARGS` 覆盖（测试用）。 |
| `packages/host/src/claude/claude-agent.ts`（新增） | `createClaudeAgent`：Claude 驱动的内部 `AgentSideConnection`。`onPrompt` 编 prompt → 驱动 ACP → 读 `<cwd>/scene.spec.json` → zod 校验（失败回灌重试）→ `invokeCapability('scene.html')`；流式 update/permission 透传前端。 |
| `packages/host/src/claude/prompt.ts`（新增） | 把图 + 理解 + 上下文 + 输出编成系统指令 + `SceneSpec` schema + 机器可读 `<DSWEAVE_CONTEXT>`（可引用的 nodeId/部件名/分块 id），约束"只产出 `scene.spec.json`、不写代码"。 |
| `packages/host/src/agent-manager.ts` | 新增 `inProcessClaudeAgentConnector`（进程内 memory transport + `createClaudeAgent`）。 |
| `packages/host/src/index.ts` / `main.ts` | `agentKind: 'mock'\|'scene'\|'claude'` + `connectorForKind`；`DSWEAVE_AGENT=claude` 选 Claude。 |
| `packages/host/src/claude/fake-adapter.ts`（新增） | 测试用「假 ACP Agent」（说官方 ACP，写合法 SceneSpec），供 `m4b:smoke` 在沙箱内验证全链路。 |
| `packages/host/bridge.ts` | **零改动**（翻译收敛在 Claude agent 内）。 |
| `packages/core` | `SceneSpec` 类型 + zod schema（M4 共用）。 |

### 2.7 验收

- [x] **阶段 A 探针**（`pnpm m4b:probe`，见 `packages/host/src/m4b-probe.ts`）：Host 用官方 ACP SDK（`@agentclientprotocol/sdk`）spawn `@agentclientprotocol/claude-agent-acp`。**已实测（2026-06-24）**：`spawn → initialize(protocolVersion=1) → session/new` 全通过，**证明链路 + 鉴权（读 `~/.claude/settings.json` 的 key）正常**；`session/prompt` 因账户 `Credit balance is too low` 失败 → 探针识别为计费问题并打印 `M4B_HANDSHAKE_OK ⚠️`。补余额/换有额度 key 后即可走完整 turn（Claude 经 `fs/write_text_file` 写哨兵文件 → `M4B_PROBE_OK`）。
- [x] **阶段 A 探针完整通过（2026-06-24）**：经本机 DeepSeek 网关（`~/.bash_profile` 的 `ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`）真调模型，`spawn → initialize → session/new → session/prompt`（Claude 调 `Write` 工具、走 ACP 权限请求）→ 写哨兵文件 → `end_turn` 全通过，`M4B_PROBE_OK ✅`。
- [x] **阶段 B 全链路（沙箱内，`pnpm m4b:smoke`）✅**：用「假 ACP Agent」替身（说官方 ACP）验证 Host 官方 ACP client + scene.spec.json 收口 + 校验 + `scene.html` 能力出物 + 权限翻译 + 产物缓存全通过，且 `bridge.ts`/内部协议/前端零改动。
- [x] SceneSpec 校验失败可回灌重试直至合法（`claude-agent.ts` 内 `maxRetries`，错误经 `buildRetryPrompt` 回灌）。
- [x] 切换 Mock ↔ scene ↔ Claude（`DSWEAVE_AGENT` / `agentKind`），DSWeave 前端零改代码。
- [ ] **真模型竖切（操作者本机）**：`DSWEAVE_AGENT=claude pnpm dev:host` + `pnpm dev:web`，拖入 gltf+文档、写关系、选 `scene.html` → Claude 产出合法 `scene.spec.json` → Host 注入 → **自包含单文件 3D HTML**（需本机 Claude 登录态或 DeepSeek 网关；沙箱内不可联网实测）。

---

## 3. M4a / M4b（M4 内部分步）

- **M4a（确定性、无 LLM）✅ 已落地**：Player 渲染 + `scene.html` 注入 + **启发式 SceneSpec agent** 走现有内部链路 → `pnpm m4:smoke` 绿。不依赖外网/key。
  - Agent 经新增协议方法 `capability/invoke` 调用 Host `scene.html` 能力（Bridge 在 agent→host 方向拦截）；产物内容寻址落盘 + HTTP 静态服务预览；审批走 `request_permission` + Web `PermissionDialog`。
  - 收口选择：M4a 采用 **`capability/invoke`（结构化）** 而非「写 `scene.spec.json` 文件」——因启发式 agent 在进程内、SceneSpec 直接可达；M4b 接 Claude Code 时改走「写文件 + turn 结束读取校验」（§2.4 方案 A），两者经同一 `CapabilityRegistry` 收敛到 `scene.html` 能力。
- **M4b（接 Claude Code）✅ 已落地**：
  - **阶段 A（探针）✅**：`pnpm m4b:probe`（`packages/host/src/m4b-probe.ts`）独立验证 Host↔`claude-agent-acp` 官方 ACP 握手 + 写文件 prompt turn，不碰 DSWeave 业务。**2026-06-24 经 DeepSeek 网关真调通过 `M4B_PROBE_OK`**。
  - **阶段 B（完整接入）✅**：翻译收敛在 **Claude 驱动的内部 Agent**（`packages/host/src/claude/`，见 §2.3/§2.6），`bridge.ts`/内部协议零改动；turn 结束读取 `scene.spec.json` → zod 校验（失败回灌重试）→ `scene.html` 注入。`inProcessClaudeAgentConnector` spawn `claude-agent-acp`（adapter 命令可覆盖）。
  - **阶段 B 沙箱验证**：`pnpm m4b:smoke`（`packages/host/src/m4b-smoke.ts` + `fake-adapter.ts`）以假 ACP 替身跑通除「真模型」外的全部代码路径；真模型竖切由操作者本机 `DSWEAVE_AGENT=claude` 运行。

---

## 4. M6 · 内置 dscode（后置）

> 目标：把自有的 **dscode**（`creativedswork/dscode`，本机 `~/Workspace/DeepSeekSpace/dscode`，DeepSeek V4 Pro）作为**内置 agent**。**不走 MCP**。竖切（M4）验证后再做。

### 4.1 结论：给 dscode 加 headless `AcpBackend`

dscode 的 `Harness.run(ui?: UiBackend)` 接受一个 backend（默认 `TuiBackend`，`--web` 换 `WebUiBackend`）。dscode 把 **Agent 引擎的所有 IO 都从 `this.ui` 这一个口子走**（源码核对）：

| 行为 | 源码位置 | 经由 |
| --- | --- | --- |
| 权限请求 | `harness.ts:70` | `this.ui.getPromptPermission()` |
| thinking/text 流 | `harness.ts:1055/1058` | `this.ui.thinkingDelta / textDelta` |
| 工具调用起止 | `harness.ts:1064/1070` | `this.ui.toolStart / toolEnd` |
| 消息/处理生命周期 | `harness.ts:1090-1099` | `startAssistantMessage / finishAssistantMessage / setProcessing` |

即 `UiBackend` 名为 UI，**功能上是 Agent 引擎对外的唯一 IO 端口**。`AcpBackend` = 这个端口的第三个"渲染器",渲染目标是 ACP/stdio 字节流,**不画任何界面;界面 100% 归 DSWeave**。走此接缝 = 零改动复用（事件绑定/权限/重试都已接在 `this.ui` 上）；绕开则需在 DSWeave 侧重实现 `harness.ts:1055-1167`,等于 fork。

```mermaid
graph LR
  HZ[dscode Harness · DeepSeek] -->|this.ui 唯一 IO 端口| SEAM{ }
  SEAM --> T[TuiBackend → 终端]
  SEAM --> W[WebBackend → 浏览器]
  SEAM --> A[AcpBackend → ACP/stdio · headless]
  A -->|JSON-RPC| DS[DSWeave Host → Web Canvas]
```

### 4.2 模型与 cwd（dscode 已现成）

| 维度 | dscode 现状 | 用法 |
| --- | --- | --- |
| cwd | `main.ts` 支持 `--cwd <dir>` → `loadConfig(cwd)` | spawn 传 `--cwd <workspace>` |
| 模型 | `~/.dscode/config.json` + env（`DEEPSEEK_API_KEY`/`AGENT_PROVIDER`/`AGENT_MODEL`） | spawn 透传 env，模型选择归 dscode |

### 4.3 改动清单（dscode 侧）

| 文件 | 改动 |
| --- | --- |
| `src/ui/acp-backend.ts`（新增） | 实现 `UiBackend`：stdio 上说 ACP；`session/prompt`→`promptAndSave`；事件→`session/update`；`getPromptPermission`→`request_permission`。零界面。 |
| `src/drivers/set-scene.ts`（新增）+ `registry.ts` | builtin driver `set_scene(spec)`（**非 MCP**），校验后经 `session/update{type:'scene'}` 回流 Host。 |
| `src/core/main.ts` | 加 `--acp` 分支选 `AcpBackend`。 |
| system prompt | 产物是 SceneSpec，必须经 `set_scene` 提交，不写代码。 |
| （可选）`UiBackend` 改名 | → `AgentBackend`/`AgentIoPort`，消除"必须是 GUI"误解。 |

> M6 时若 M4 已采用「写 `scene.spec.json`」收口，dscode 侧亦可对齐成写文件方案，省去 `set_scene` driver；二选一以 M4 实际落地为准。

---

## 5. 风险与备选

| 风险 | 应对 |
| --- | --- |
| 内部协议 ↔ 官方 ACP 映射有缺口 | 先覆盖 prompt/update/permission 子集；bridge 单测；不支持的官方变体降级为日志 |
| Claude 不稳定产出合法 SceneSpec | 强系统约束 + schema 回灌重试；备选 Client MCP `set_scene` 工具 |
| 真 LLM 不可在沙箱实测 | M4a 启发式跑绿；Mock↔Claude 切换证明可插拔；真模型留运行时验收 |
| Claude 自带 fs/bash/terminal 越权 | ACP permission 请求 → DSWeave 审批；`workingDir` 沙箱限定 workspace |
| `claude-agent-acp` 版本演进 | 锁版本 + 关注 ACP SDK 兼容；Agent 可插拔，必要时回退 Mock |
