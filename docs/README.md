# DSWeave 文档集

> **DSWeave** —— 一个**空间化知识引擎**：拖入文件 → Agent 理解 → 产出 **3D 沉浸式知识场景（HTML/WebGL）**。
> 即便目标产物是 HTML，它也是 3D 的——gltf 模型作为一等公民嵌入场景，知识被空间化组织，可旋转、漫游、点热点查资料。
> 领域聚焦：**知识库管理 + 自动研究（auto research）**。
> 用户只做三件事：① 拖入文件（gltf/md/pdf/txt/html/图片/数据）；② 给连线写关系、给输出选类型+写软细节；③ 点开始。剩下交给通过 **ACP** 连接的 AI Agent。

> **架构演进（2026-06）**：主链路已由「Agent 产出 SceneSpec 数据 → 预构建 R3F Player 渲染」改为「Agent 直接撰写自包含 HTML，Host 后处理注入 model-viewer 运行时 + 内联 asset://{nodeId} 资产字节」。产物离线自包含、内容寻址可缓存；@dsweave/player 包与 SceneSpec 契约已移除。下列文档相关章节据此更新。

## 阅读顺序

| # | 文档 | 内容 | 读者 |
| --- | --- | --- | --- |
| 00 | [产品与计划](./00-product-plan.md) | 愿景、3D 定位、核心引擎（文件理解+上下文）、受限输出、里程碑 | 所有人先读 |
| 01 | [架构](./01-architecture.md) | 系统拓扑、Monorepo、ACP 映射、数据流、时序 | 架构/后端 |
| 02 | [技术设计](./02-technical-design.md) | 节点图/IR、文件理解(文档+gltf)、scene.html 生成、输出注册表、协议 | 工程实现 |
| 03 | [实施计划](./03-implementation-plan.md) | 里程碑任务、逐包逐文件、依赖、验收 | 执行落地 |
| 04 | [Scene Player](./04-player.md) | **（已废弃）历史参考：R3F Player / SceneSpec 契约**；当前链路改为 Agent 直接写 HTML + Host 注入 model-viewer | 前端/3D |
| 05 | [Agent 接入](./05-agent-integration.md) | M4 接 Claude Code（`claude-agent-acp`，官方 ACP/stdio）；M6 内置 dscode（headless `AcpBackend`，不走 MCP） | Agent/后端 |

## 一图速览

```mermaid
flowchart LR
  U[拖文件(含 gltf) + 写关系/选输出] --> W[Web 画布 Client]
  W -->|ACP over WS| H[Node Host<br/>文档解析+gltf 渲染 / 能力]
  H -->|ACP over stdio| A[AI Agent 可插拔]
  A -->|自包含 HTML| H
  H -->|注入 model-viewer 运行时 + 内联 asset:// → 自包含 HTML| W --> U
```

## 核心理念

- **不一样的引擎**：产物是 **3D 沉浸式 HTML（WebGL）**，支持 gltf 模型——区别于普通报告/PPT 生成器。
- **输入只有文件**：核心功夫＝文档解析 + gltf 渲染/理解 + 上下文工程（分块/检索/引用）。
- **输出是受限菜单**：用户能选的＝Host 真能生产的；旗舰 `scene.html`（3D），平面 `report.html` 为降级，`app.react` 工程交付次之。
- **Agent 直接写 HTML、生成可靠**：**Agent 直接撰写自包含 HTML**（用 `<model-viewer>` 预览 3D、用 `asset://{nodeId}` 引用源文件）；**Host 仅做物理兜底**——注入 model-viewer 运行时、把 `asset://` 内联为资产字节（LLM 吐不出二进制）。产物**离线自包含、内容寻址可缓存**。校验是纯文本的（非空 / 无外链 script·link / `asset://` 仅引用 models∪images），失败回灌 Agent 重写。
- **过程透明**：执行态实时展示 + 仅危险操作审批（无计划预览）。
- **可复现**：工作流存为 `.flow.json`，内容寻址缓存。

## 已确认决策（v0.4）

- 名称：**DSWeave**；定位：**空间化知识引擎，3D 沉浸式 HTML 输出**。
- 运行形态：Web 前端 + 本地 Node Host（预留 Tauri）。
- Agent：可插拔（Mock / 自建 / 外部）。
- 领域：知识库管理 + auto research（用 3D 表达差异化）。
- 输入：仅文件；**gltf 与文档并列一等输入**。
- 输出：受限菜单，**MVP 首发 `scene.html`（3D）**，`report.html` 降级、`app.react` 工程次之、`custom` 隐藏。
- 运行时：**Agent 直接写自包含 HTML + Host 注入 model-viewer 运行时/内联资产**；默认交付**自包含单文件 HTML**（离线双击可开）；新增依赖 `@google/model-viewer`（离线 3D 运行时）。
- 核心攻坚：文件理解（文档解析 + gltf 渲染/部件）+ 上下文工程 + Agent 自包含 HTML 撰写 + Host 后处理（运行时注入 / 资产内联）。
- Monorepo：`core`/`protocol`/`host`/`agent`/`web`（5 包）。

## 下一步

文档评审通过后，从 [实施计划 M0](./03-implementation-plan.md) 开始搭骨架（Monorepo + 工具链 + core 类型）。
