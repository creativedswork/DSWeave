# 设计：Agent 自由写 HTML（主链路改造）

日期：2026-06-27
状态：已通过 brainstorming，待 user review → writing-plans

## 背景与问题

当前主链路是「Agent 只产 `SceneSpec`（纯数据）→ 预构建 Player 渲染 → 自包含 HTML」。
文字内容链路是**只读引用式**的：

- `ScenePanel = { title, chunkIds }`、`SceneHotspot = { title, bodyChunkIds }`，都只能引用**已存在文档的分块 id**。
- Host 的 `collectChunks`（`packages/host/src/capabilities/scene-html.ts`）只把 `chunkIds` 拿去 `chunkIndex()` 查已有文档文本。
- prompt（`packages/host/src/claude/prompt.ts`）明令「`panels[].chunkIds` 必须取自 `docs[].chunks[].id`；不要臆造 id」。

**后果**：当用户只拖一个 `.glb`（无文档 → 无 chunk），并在边语义里要求「LLM 生成不少于 500 字的模型说明」时，Agent 即使生成了文字，`SceneSpec` 里**没有任何字段能装它**，也没有 panel/hotspot 能引用它 → 那段文字被丢弃，最终 HTML 看不到。

根因：数据模型不允许 Agent 写「自己生成的文字」，只能引用既有文档。

## 决策

把主链路**翻转**为：**Agent 直接写一个自包含 `index.html`**，Host 只做「物理兜底」（Agent 做不到的事）。
图（graph）退化为**纯 prompt 素材**；Agent 自由决定文字、排版、风格、结构、用什么标签预览模型。

### 物理约束（不可协商）

LLM 无法吐出二进制 glb 的 base64（体积大、必然出错）。因此**资产字节内联必须由 Host 完成**——
Agent 只写「引用」，Host 在产出阶段把引用替换为内联 `data:` URI。这不是限制 Agent，而是 Agent 物理上做不到。

### 取舍

- 收益：用户要的能力天然成立；Agent 发挥不再受 schema 限制；文字 + 模型 + 风格天然揉在一起。
- 代价：失去「产物 100% 可跑」的硬保证，改为「`<model-viewer>` 兜底 glb 渲染 + 轻量校验 + 一次回灌重试」的软保证。

## 新数据流

```
拖文件 → 文件理解 → 图拼成 prompt → Agent 写 index.html（含自撰文字 + asset:// 引用）
        → Host 后处理（注入 model-viewer 运行时 + 内联资产字节 + 校验/重试）→ 自包含单文件 HTML
```

首尾不变：输入仍是「图 + 文件理解」，产物仍是「自包含、可离线双击打开、content-addressed」的单文件 HTML。

## 组件设计

### 1. Agent 契约

- Agent 不再写 `scene.spec.json`，改为写 **`index.html`** 到 cwd（沿用现有 `fs/write_text_file` 通道，协议零改动）。
- 资产引用统一用占位协议 **`asset://{nodeId}`**：
  - 预览模型：`<model-viewer src="asset://n1" camera-controls auto-rotate>`（运行时由 Host 注入，Agent 不引脚本）。
  - 图片：`<img src="asset://n2">`。
- 文字、布局、配色、结构全由 Agent 决定；边语义要求的长文（如 ≥500 字描述）直接写进 HTML 正文。

### 2. Host 能力（取代现 `scene.html` 的 SceneSpec 注入逻辑，复用 id `scene.html`）

流程沿用现有模式：Agent 写 `<cwd>/index.html` → Host 读盘得到 html 字符串 → 调用能力（输入从 `{ spec: SceneSpec }` 改为 `{ html: string }`）。能力做四件事：

1. **注入运行时**：把仓库内 vendored 的 `<model-viewer>` bundle 注入 `<head>`，保证模型一定能渲染且离线可用。
2. **内联资产**：扫描 HTML 中所有 `asset://{nodeId}`，用 `understanding.getStoredFile(nodeId)` 取真实字节 → 替换为 `data:` URI（glb → `model/gltf-binary`，图片按真实 mime）。
3. **校验 + 一次回灌重试**（替代现 SceneSpec zod 校验，沿用 `acp-agent.ts` 现有重试机制）：
   - HTML 非空且基本可解析；
   - 所有 `asset://` 引用都能解析到已知 nodeId；
   - 无残留未解析占位符；
   - 无外链 `http(s)` 脚本/样式（违反离线要求）。
   - 任一失败 → 把错误信息回灌 Agent 重试（复用现有 `maxRetries`，默认 2）。
4. **content-addressed**：对最终 HTML 取 sha256 → 缓存（逻辑不变）。

### 3. Prompt 重写（`packages/host/src/claude/prompt.ts`）

- **删除** `SCHEMA_DOC` 及所有 chunkId / 禁止臆造 id 的规则。
- 新指令要点：把图当意图来源；写**一个自包含 `index.html`**；引用任何源文件用 `asset://{nodeId}`；预览 3D 模型用 `<model-viewer>`（运行时会被注入，勿自行引脚本，勿引外链 CDN）；按边语义自由撰写文字；匹配 output hint 的风格。
- `<DSWEAVE_CONTEXT>` 内容调整：**直接给文档分块真实文本**（不再只给 id），并给每个 model 的 `parts`、image 尺寸、edges 语义、output hint。

### 4. 输出类型 = 风格提示

`scene.html` / `report.html` 不再绑不同渲染器，而是作为喂给 Agent 的**风格 hint**（3D 沉浸 vs 2D 报告），背后同一能力。`packages/web/src/lib/outputs.ts` 与前端菜单基本不动。

## 删除 / 影响范围

- 作废：`@dsweave/player` 包、`SceneSpec` 类型 + zod schema、`packages/host/src/export/inject-player.ts`、`collectChunks/collectAssets`(基于 spec 的版本)、相关 scene-spec smoke 测试。
- 改写：`README.md`「Agent 只产数据、不写代码」整段理念；`docs/` 中 player / SceneSpec 相关章节。
- 新增：vendored `<model-viewer>` 运行时资源 + Host 注入逻辑；`asset://` 解析与内联模块；HTML 轻量校验模块。

## 已定的小决策

1. 资产占位协议用 `asset://{nodeId}`（正则易替换、不易冲突）。
2. 复用能力 id `scene.html`，避免动协议与前端菜单。

## 测试策略

- 单测：`asset://` 解析与内联（含多资产、glb mime、未知 nodeId 报错）；HTML 校验（外链脚本拦截、残留占位符拦截）。
- 烟测：改造 `fake-adapter` 写 `index.html`（含 `asset://` 与一段长文）→ Host 注入 + 内联 + 校验 → 验证产物含模型 data URI、含长文、可离线打开（无 http 外链）。
- 端到端：glb 单文件 + 边语义「生成 ≥500 字说明」→ 产物 HTML 同时含 `<model-viewer>` 模型预览与 ≥500 字文本。
