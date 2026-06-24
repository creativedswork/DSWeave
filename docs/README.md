# DSWeave 文档集

> **DSWeave** —— 一个**空间化知识引擎**：拖入文件 → Agent 理解 → 产出 **3D 沉浸式知识场景（HTML/WebGL）**。
> 即便目标产物是 HTML，它也是 3D 的——gltf 模型作为一等公民嵌入场景，知识被空间化组织，可旋转、漫游、点热点查资料。
> 领域聚焦：**知识库管理 + 自动研究（auto research）**。
> 用户只做三件事：① 拖入文件（gltf/md/pdf/txt/html/图片/数据）；② 给连线写关系、给输出选类型+写软细节；③ 点开始。剩下交给通过 **ACP** 连接的 AI Agent。

## 阅读顺序

| # | 文档 | 内容 | 读者 |
| --- | --- | --- | --- |
| 00 | [产品与计划](./00-product-plan.md) | 愿景、3D 定位、核心引擎（文件理解+上下文）、受限输出、里程碑 | 所有人先读 |
| 01 | [架构](./01-architecture.md) | 系统拓扑、Monorepo、ACP 映射、数据流、时序 | 架构/后端 |
| 02 | [技术设计](./02-technical-design.md) | 节点图/IR、文件理解(文档+gltf)、scene.html 生成、输出注册表、协议 | 工程实现 |
| 03 | [实施计划](./03-implementation-plan.md) | 里程碑任务、逐包逐文件、依赖、验收 | 执行落地 |
| 04 | [Scene Player](./04-player.md) | R3F 运行时：SceneSpec 契约、注入机制、组件架构、布局/热点/主题、单文件打包 | 前端/3D |
| 05 | [Agent 接入](./05-agent-integration.md) | M4 接 Claude Code（`claude-agent-acp`，官方 ACP/stdio）；M6 内置 dscode（headless `AcpBackend`，不走 MCP） | Agent/后端 |

## 一图速览

```mermaid
flowchart LR
  U[拖文件(含 gltf) + 写关系/选输出] --> W[Web 画布 Client]
  W -->|ACP over WS| H[Node Host<br/>文档解析+gltf 渲染 / 能力]
  H -->|ACP over stdio| A[AI Agent 可插拔]
  A -->|SceneSpec(纯数据)| H
  P[(CI 预构建<br/>R3F Player bundle)] --> H
  H -->|注入 SceneSpec → 自包含 3D HTML| W --> U
```

## 核心理念

- **不一样的引擎**：产物是 **3D 沉浸式 HTML（WebGL）**，支持 gltf 模型——区别于普通报告/PPT 生成器。
- **输入只有文件**：核心功夫＝文档解析 + gltf 渲染/理解 + 上下文工程（分块/检索/引用）。
- **输出是受限菜单**：用户能选的＝Host 真能生产的；旗舰 `scene.html`（3D），平面 `report.html` 为降级，`app.react` 工程交付次之。
- **数据驱动、生成可靠**：运行时是我们自研、**CI 预构建并测试过的 R3F Scene Player**；**Agent 只产出 `SceneSpec` 数据，绝不写代码**。`scene.html` 能力把 SceneSpec+资产注入 Player bundle → **自包含单文件 HTML**。把"会出错的代码"留在构建期，产物一定跑得起来、可缓存。
- **过程透明**：执行态实时展示 + 仅危险操作审批（无计划预览）。
- **可复现**：工作流存为 `.flow.json`，内容寻址缓存。

## 已确认决策（v0.4）

- 名称：**DSWeave**；定位：**空间化知识引擎，3D 沉浸式 HTML 输出**。
- 运行形态：Web 前端 + 本地 Node Host（预留 Tauri）。
- Agent：可插拔（Mock / 自建 / 外部）。
- 领域：知识库管理 + auto research（用 3D 表达差异化）。
- 输入：仅文件；**gltf 与文档并列一等输入**。
- 输出：受限菜单，**MVP 首发 `scene.html`（3D）**，`report.html` 降级、`app.react` 工程次之、`custom` 隐藏。
- 运行时：**数据驱动的自研 R3F Scene Player（CI 预构建）+ Agent 只产出 SceneSpec**；默认交付**自包含单文件 HTML**；三种输出共用同一 Player。
- 核心攻坚：文件理解（文档解析 + gltf 渲染/部件）+ 上下文工程 + Scene Player + SceneSpec 生成。
- Monorepo：`core`/`protocol`/`host`/`web`/`player`/`agent`（6 包）。

## 下一步

文档评审通过后，从 [实施计划 M0](./03-implementation-plan.md) 开始搭骨架（Monorepo + 工具链 + core 类型）。
