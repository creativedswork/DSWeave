# DSWeave · 实施文档

> 文档版本：v0.2 ｜ 配套：`02-technical-design.md`
> 可执行落地计划：里程碑拆解、逐包逐文件、验收标准。

---

## 1. 环境与前置

- Node ≥ 20，pnpm ≥ 9。
- 文档处理：pdf 解析（pdfjs-dist/pdf-parse）、网页正文抽取（@mozilla/readability + jsdom）；向量检索（hnswlib/sqlite-vec，M3 评估）。
- 3D：three.js、`@google/model-viewer`；gltf 离屏渲染（headless-gl 或 puppeteer，M3 评估）。
- 推荐编辑器：VS Code / Cursor + TS、ESLint、Tailwind 插件。

```bash
node -v && pnpm -v
```

---

## 2. 里程碑任务拆解

### M0 · 地基（Monorepo + 工具链）

**目标**：可构建、可启动的空骨架。

- [ ] 初始化 pnpm workspace（`pnpm-workspace.yaml`、根 `package.json`、`tsconfig.base.json`）。
- [ ] 建 6 个包骨架：`core` / `protocol` / `host` / `web` / `player` / `agent`。
- [ ] 统一 lint/format（ESLint flat config + Prettier）+ `tsc --build`。
- [ ] 根脚本：`dev` / `build` / `typecheck` / `lint` / `test`。
- [ ] CI（GitHub Actions）：install → typecheck → lint → build。

**验收**：`pnpm install && pnpm build && pnpm typecheck` 全绿；`pnpm --filter web dev` 起空白页。

---

### M1 · 画布（文件拖入 + 预览 + 连线 + IR）

**目标**：纯前端即可搭出工作流并存取，无需 Agent。

`packages/core`：
- [ ] `model.ts`：`FlowNode/FlowEdge/FlowGraph/OutputSpec/Understanding` 类型。
- [ ] `schema.ts`：zod schema + `validateFlow`。
- [ ] `ir.ts`：`stripRuntime`、`hashNode`、`serialize/deserialize`。

`packages/web`：
- [ ] React Flow 画布 + Zustand store。
- [ ] `onDrop` 接收文件 → 生成 `source` 节点（M1 先本地预览）。
- [ ] 预览组件：**Gltf(model-viewer 3D)** / Markdown / PDF / Txt / HTML / Image / Data(csv-json)。
- [ ] `OutputNode`：从受限菜单选输出类型（MVP 仅 `scene.html`）+ 写软细节 spec。
- [ ] 边编辑：点击边编辑 `semantics`/`params`。
- [ ] 工具栏：新建 / 保存(.flow.json) / 加载。

**验收**：拖入 gltf + 多份 md/pdf、连带语义的边、加 `scene.html` output 节点、保存并重新加载还原。

---

### M2 · 连接（ACP 打通：前端 ↔ Host ↔ Mock Agent）

**目标**：点 Start 跑通 ACP 链路，收到流式 update（先用 Mock Agent，验证可插拔抽象）。

`packages/protocol`：
- [x] `transport.ts`：`AcpTransport` 接口 + `WebSocketTransport` + 内存传输对（进程内连 Mock）。
- [x] `jsonrpc.ts`：自包含 JSON-RPC 2.0 对等端（请求/响应 + 通知，双向）。
- [x] `messages.ts`：ACP 形态方法/负载（`session/new|prompt|update|cancel|request_permission`）。
- [x] `encode.ts`：`encodeGraphToPrompt`（系统指令 + 结构 + 能力 + 输出；`understanding` 预留 M3）。
- [x] `decode.ts`：`session/update` → `DSWeaveEvent`。
- [x] `client.ts`：`DSWeaveAcpClient`（newSession/run(异步流)/respondPermission/cancel）。
- [x] `agent-connection.ts`：`AgentSideConnection`（onNewSession/onPrompt/sessionUpdate/requestPermission）。

`packages/host`：
- [x] `server.ts`：ws 服务 + 会话生命周期。
- [x] `agent-manager.ts`：连接 Agent（默认进程内 Mock；`spawnStdioConnector` 预留 stdio ACP）。
- [x] `bridge.ts`：前端 WS ↔ Agent 透明帧中继 + 文件登记旁路观测。
- [x] `fs-service.ts`：文件登记 + hash + 资源 uri（内存版）。

`packages/agent`（Mock）：
- [x] 最小 `AgentSideConnection`：收到 prompt → node/edge 状态流 + 日志 + 产物 → done；附 stdio 入口。

`packages/web`：
- [x] `acp/connect.ts` 接入 `DSWeaveAcpClient`，Start 触发 `run`，消费 `DSWeaveEvent`。
- [x] `ExecutionPanel` + `LogTimeline` 基础版；节点/边执行态可视化。

**验收**：点 Start → 节点依次 running→done → 日志滚动（Mock）。✅ `pnpm m2:smoke` 端到端通过。

> 实现说明：方案原列 `@agentclientprotocol/sdk` 依赖，但该名解析到的 npm 包（v0.25.1）与社区官方 ACP 实现（`@zed-industries/agent-client-protocol` v0.4.x）严重不符且 API 不稳。M2 目标是「用 Mock 验证可插拔抽象」，故在 `protocol` 内自研一套 ACP 形态 JSON-RPC 层，方法名/语义对齐 ACP，`AcpTransport` 抽象成立；M4 接真实 Agent 时可在 stdio 边界换上官方 SDK 而不影响上层。

---

### M3 · 文件理解 + 上下文工程（核心攻坚，含 gltf）

**目标**：让 Agent 基于文档内容准确作答/引用，并能"看懂"gltf 模型（外观 + 部件）。

`packages/host`：
- [x] `understanding/` provider 框架（`UnderstandingProvider` + `ProviderRegistry`，版本指纹参与缓存键）。
- [x] 文档 provider：`md`/`txt`/`html`/`data`(csv/json)/`pdf`/`image`。
- [x] **`gltf` provider**：解析 glTF JSON / .glb 容器取部件/材质/动画/包围盒（`model`）+ 合成「外观」caption。
- [x] `context/`：分块（按标题/段落，带来源 loc）+ 抽取式层级摘要 + 引用来源（nodeId+段/小节）。
- [x] `ContextBuilder`：按边语义/输出目标选取上下文（MVP 全量；超预算退化关键词 topk，预留向量检索）。
- [x] 表征异步生成 + 流式回填 `node.understanding`（`understanding/register` → `understanding/update`），sha256 内容寻址缓存 + in-flight 去重。

`packages/web`：
- [x] 节点"理解中/已理解"徽标；`Inspector` 展示解析结果（摘录/大纲/分块、gltf 部件/材质/动画/包围盒）。
- [x] 拖入即把文件内容登记到 Host（含 gltf 依赖），流式回填 `understanding`。

**验收**：拖入 gltf + 若干 md/pdf/csv，Host 解析出文档大纲/分块/摘要与模型部件，注入 prompt 后 Agent 能基于文档引用并描述模型部件。✅ `pnpm m3:smoke` 端到端通过。

> 实现说明：
> - **文件内容上行**：M2 的 Bridge 透明中继升级为「路由器」——拦截 `understanding/register`（Host 侧处理、不转发 Agent），转发 `session/prompt` 前把各 source 节点的 `understanding` 与 `ContextBuilder` 上下文注入图。新增协议方法 `understanding/register`（请求）与 `understanding/update`（通知），`PromptInput.context` 承载上下文。
> - **gltf 渲染（renders）后置**：离屏多角度渲染依赖 headless-gl/puppeteer，环境相关且较重；M3 先以「结构元数据 + 合成 caption」支撑「描述外观与部件名」，`renders` 字段保留为空待后置。
> - **HTML 抽取**：M3 用零依赖的轻量去噪抽取（移除 script/style/标签、解码实体、抽 title/标题），封装在 `UnderstandingProvider` 之后，后续可平滑替换为 `@mozilla/readability + jsdom`。
> - **PDF 抽取**：`pdf` provider 动态导入 `pdfjs-dist` 抽取正文，未安装时优雅降级为「已登记、正文待解析」，不阻断构建与链路。

---

### M4 · 主竖切（gltf + 文档 → `scene.html` 3D 沉浸页）

> 已确认的**首条主竖切用例**。运行时＝数据驱动的自研 R3F Player；Agent 只产出 SceneSpec；交付自包含单文件 HTML。

`packages/core`：
- [ ] `SceneSpec` 类型 + zod schema（Agent 产出物的契约）。

`packages/player`（自研 R3F 运行时，**本里程碑重点**）：
- [ ] R3F 场景骨架：相机/光照/OrbitControls、gltf 加载（drei `useGLTF`/model-viewer）。
- [ ] 热点系统：按 `SceneSpec.hotspots` 把文档片段绑到模型部件，点击弹解说。
- [ ] 文档面板/浮窗、配色主题、引用回指。
- [ ] `single-focus` 与 `gallery` 两种 `layout`。
- [ ] 以 `SceneSpec`(+资产) 为唯一输入；vite 构建为可内联的 bundle；单文件导出验证。

`packages/host`：
- [ ] 输出类型注册表 `OutputType` + 能力注册表对齐（输出菜单从能力派生）。
- [ ] **`scene.html` 能力**：把 `SceneSpec + 资产` 注入**预构建 Player bundle** → 导出自包含单文件 HTML（Player JS 内联、SceneSpec 内联、glb base64）。2D 模式即 `report.html`。
- [ ] `gltf.render`、`fs.write` 能力；缓存命中标识（key 含 Player 版本）。
- [ ] **产物处理与交付**（详见技术设计 §5.4）：`Artifact`(core) 类型；内容寻址落盘 `.dsweave/artifacts/<hash>/`；单文件直接交付，多文件 dist 起本地静态服务 `/_artifacts/<hash>/` 预览 + zip 下载；产物可「提升」为新 source 节点（复用 `FileRef.assets`）。

`packages/agent`（真实/可插拔）：
- [ ] `tools/`：把 Host 能力暴露为 tool_call；约束 Agent **只产出 SceneSpec**，不写代码。
- [ ] 执行循环 + SceneSpec 校验/重试 + `request_permission`。

`packages/web`：
- [ ] `PermissionDialog` 审批弹窗。
- [ ] `ArtifactViewer`：3D HTML 用 iframe 预览（可旋转/漫游/点热点）+ 下载；热点/引用可回指来源节点。
- [ ] 产物"提升"为新 `source` 节点。

**验收**：拖入 `model.gltf + 若干文档`，边写"模型居中可旋转、把章节绑成部件热点"，输出 `scene.html` + 软细节，点 Start → Agent 产出 SceneSpec → 审批 → 产出**自包含单文件 3D HTML**（双击即看、可交互、带文档热点与来源引用）；二次运行命中缓存秒出。

---

### M5 · 拓展 + 打磨

- [ ] `app.react` 输出能力：把同一 Player 以**工程/dist**形式交付（复杂交互场景）。
- [ ] 更多文件类型 + 向量检索（应对大知识库）。
- [ ] `fetch.web` 联网检索能力（auto research，受 permission 约束）。
- [ ] Tauri 套壳：`WebSocketTransport` → IPC Transport（前端零改）；three.js 依赖本地化。
- [ ] 错误恢复 + 用户文档 + 示例 `.flow.json` 与素材。

**验收**：`app.react` 3D 输出可用；典型场景逐步通过；桌面包可运行。

---

## 3. 逐包文件清单（目标态）

```
packages/core/src/        model.ts schema.ts ir.ts index.ts
packages/protocol/src/    transport.ts encode.ts decode.ts client.ts index.ts
packages/host/src/        server.ts bridge.ts agent-manager.ts fs-service.ts
                          understanding/{registry,gltf,md,txt,pdf,html,data,image}.ts
                          context/{chunker,summarize,retrieve,builder}.ts
                          capabilities/{registry,output-types,scene-html,gltf-render,fs}.ts
                          export/{inject-player,singlefile}.ts    # 注入 SceneSpec→单文件 HTML
                          cache.ts index.ts
packages/player/src/      Player.tsx main.tsx spec.ts             # 自研 R3F 运行时
                          scene/{Stage,ModelLoader,Camera}.tsx
                          hotspots/Hotspot.tsx panels/DocPanel.tsx
packages/web/src/         App.tsx main.tsx store/useDSWeaveStore.ts
                          canvas/{Canvas,SourceNode,OutputNode,EdgeEditor}.tsx
                          previews/{Gltf,Markdown,Pdf,Txt,Html,Image,Data}.tsx
                          panels/{Execution,LogTimeline,Inspector,PermissionDialog,ArtifactViewer}.tsx
                          acp/connect.ts
packages/agent/src/       agent.ts tools/index.ts index.ts
```

---

## 4. 关键依赖清单（首批）

| 包 | 依赖 |
| --- | --- |
| core | `zod` |
| protocol | `core`、`@agentclientprotocol/sdk`、`zod` |
| host | `core`、`protocol`、`@agentclientprotocol/sdk`、`ws`、`pdfjs-dist`/`pdf-parse`、`@mozilla/readability`、`jsdom`、`three`、`gltf` 渲染（`gl`/`puppeteer` 评估）、（向量检索 `hnswlib-node`/`sqlite-vec` 评估） |
| web | `core`、`protocol`、`react`、`react-dom`、`@xyflow/react`、`zustand`、`tailwindcss`、`react-markdown`、`remark-gfm`、`pdfjs-dist`、`@google/model-viewer`、`three`、`vite` |
| player | `core`、`react`、`react-dom`、`three`、`@react-three/fiber`、`@react-three/drei`、`vite`、`vite-plugin-singlefile` |
| agent | `core`、`protocol`、`@agentclientprotocol/sdk` |

> 安装时用包管理器拉取最新版本，不手写版本号。

---

## 5. 验收清单（Definition of Done · MVP）

- [ ] `pnpm build && pnpm typecheck && pnpm lint && pnpm test` 全绿。
- [ ] 主竖切（gltf+文档→`scene.html` 3D）端到端通过：产物可加载模型、可交互、带文档热点与引用。
- [ ] 文件理解：文档解析+分块+摘要 与 gltf 渲染/部件提取 正确并喂给 Agent。
- [ ] `scene.html` 由 CI 预构建的 R3F Player + Agent 产出的 SceneSpec 注入生成，**保证可运行**（Agent 不写代码）。
- [ ] 产物为**自包含单文件 HTML**，双击即可在浏览器打开。
- [ ] 输出菜单严格等于注册表里未隐藏的 OutputType。
- [ ] 工作流可保存/加载/复跑，缓存命中生效。
- [ ] 切换 Agent 实现（Mock ↔ 真实 ↔ 外部）前端无需改代码。
- [ ] 危险操作均经审批；工作目录沙箱生效。
- [ ] 关键路径有测试：core/protocol 单测、host 集成测、web E2E。

---

## 6. 首批落地路径

> 决策已确认（§`00-product-plan.md` §10）：**DSWeave / 空间化知识引擎(3D 输出) / Web+Host / 可插拔 Agent / 知识库+auto research / 受限输出(首发 `scene.html` 3D) / 数据驱动 R3F Player + Agent 只产出 SceneSpec / 交付自包含单文件 HTML / 无计划预览 / 文件理解(文档+gltf)+Player 为核心攻坚**。

1. **M0** Monorepo 骨架（6 包，立即可见绿色构建）。
2. **M1** `core` + 画布 + 预览（gltf 3D + 文档类）。
3. **M2** Mock Agent 打通 ACP 全链路。
4. **M3** 文件理解 + 上下文工程（文档 + gltf 渲染/部件）——核心攻坚。
5. **M4** 自研 R3F Player + `scene.html` 注入，跑通"gltf+文档→自包含 3D HTML"主竖切。

---

## 7. 协作约定

- 分支：`main` 保护，功能走 `feat/*`，每个里程碑一组 PR。
- 提交：Conventional Commits（`feat: / fix: / docs: / refactor:`）。
- 评审：架构相关改动需更新对应 `docs/`。
