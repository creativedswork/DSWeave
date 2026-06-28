# DSWeave

**空间化知识引擎**：把文件拖进画布 → 用自然语言连线表达意图 → Agent 理解后产出一份**自包含的 3D 沉浸式知识场景（单文件 HTML/WebGL）**。

> 你只提供「素材 + 关系」，DSWeave 负责把它编排成一个可旋转、可点击、可离线打开的 3D 网页——无需写一行渲染代码。

https://github.com/user-attachments/assets/40e478af-dd00-4e43-a6fb-d57453b05be6

上面的视频是一次真实体验：把素材（如 3D 模型与配图）拖进画布，连线写下它们之间的关系，输出节点选 **3D 沉浸场景（`scene.html`）**，点 **Start**，Agent 便理解素材与意图，产出一个把它们空间化编排、可旋转可交互的自包含 3D 页面。

---

## 核心理念：Agent 直接写自包含 HTML

DSWeave 把渲染交还给 Agent，让产物天然离线自包含：

```
拖文件 → 文件理解 → Agent 直接写自包含 HTML → Host 注入 model-viewer 运行时 + 内联资产字节 → 自包含单文件 HTML
```

- **Agent 直接产出自包含 HTML**（含 `<model-viewer>` 标签与 `asset://` 占位引用），无需走预定义的数据 schema。
- **Host 在产物后处理阶段做兜底**：注入 model-viewer 运行时、把 `asset://` 引用内联为 data URI 字节，确保产物离线可运行、无外链。
- 因此产物**离线自包含、内容寻址可缓存**（hash 含最终 HTML 全文），双击即看。

这也意味着 Agent 是**可插拔**的：`web → Host(内部协议) → Agent(官方 ACP over stdio)`。换 Agent，前端零改动。

---

## Agent 能表达什么

产物是 Agent 自由撰写的 HTML，因此表达力由 Agent + 上下文决定，而非固定 schema。Host 提供这些可靠的底座能力：

| 能力 | 含义 | 来源文件 |
| --- | --- | --- |
| 3D 模型预览 | `<model-viewer asset://{nodeId}>`（可旋转、相机控制），运行时由 Host 注入 | `.gltf` `.glb` |
| 图片内联 | `<img asset://{nodeId}>`，Host 内联为 data URI | `.png` `.jpg` `.webp` |
| 文档正文 | Agent 按连线语义撰写文字（可参考文档真实分块） | `.md` `.pdf` `.txt` `.html` |
| 风格 / 排版 | 配色、布局、交互由 Agent 依输出诉求与连线语义自行决定 | 由连线语义 + 输出诉求驱动 |

> Host 只负责 LLM 物理上做不到的兜底：注入 model-viewer 运行时、把 `asset://` 引用内联为字节。其余的结构、文字、风格全部交给 Agent 自由发挥——无需扩展任何数据 schema。

---

## 工作流

1. **拖入文件**：画布上每个文件成为一个 source 节点，自动生成预览与「文件理解」（gltf 部件/材质、文档分块摘要、图片尺寸等）。
2. **连线表达意图**：在节点间连线并写自然语言语义（如「图片在左，箭头从图片指向模型，标注‘生成’」）。
3. **选输出类型**：输出节点选受限菜单中的类型（旗舰：`scene.html`）。
4. **Start**：Host 把「图 + 文件理解 + 上下文」喂给 Agent；Agent 直接写自包含 HTML；Host 注入 model-viewer 运行时并内联 `asset://` 资产 → 产出自包含 HTML，iframe 实时预览，也可单独下载离线打开。

执行过程（节点状态、工具调用、权限请求、日志）实时回流到右侧执行面板。

---

## Monorepo

| 包 | 职责 |
| --- | --- |
| `@dsweave/core` | 节点图 / IR / 类型 / zod schema（前后端共享） |
| `@dsweave/protocol` | 内部 ACP 封装：图→prompt 编码、update→事件解码、transport 抽象、`capability/invoke` |
| `@dsweave/host` | Node 进程：WS 桥接、文件服务、文件理解、上下文工程、能力执行（`scene.html` HTML 后处理：注入 model-viewer 运行时 + 内联 `asset://` 资产）、Agent 管理（含官方 ACP 接入 Claude） |
| `@dsweave/agent` | 参考 ACP Agent（启发式 / Mock，直接产出自包含 HTML，可插拔） |
| `@dsweave/web` | 前端编辑器：画布、文件预览、执行/产物/权限面板 |

---

## 可插拔 Agent（基于 ACP）

[ACP（Agent Client Protocol）](https://agentclientprotocol.com) 是 Agent 与编辑器之间的**通用开放协议**，并非 Claude 独有。DSWeave 的 Host 作为 ACP Client，任何遵循 ACP 的 Agent 都能经 stdio 接入——你完全可以**接入自定义 Agent**（只需实现 ACP 的 `initialize` / `session/new` / `session/prompt`，并通过 `fs/write_text_file` 产出自包含的 `index.html`），前端与协议/能力链路零改动。

通过 `DSWEAVE_AGENT` 选择内置 Agent：

| 值 | Agent | 说明 |
| --- | --- | --- |
| `scene`（默认） | 启发式 HTML Agent | 确定性、无 LLM、无外网；用于打通与验证主链路 |
| `claude` | Claude Code | 经官方 ACP 适配器（`@agentclientprotocol/claude-agent-acp`）spawn 真实 LLM；产出 `index.html` 后由 Host 读取校验、失败回灌重试 |
| `mock` | 占位 Agent | 早期状态流验证 |

> 接入自定义 Agent：实现一个 ACP Agent（可参考 `@dsweave/agent`），用 ACP adapter 经 stdio 暴露，即可作为新的 `DSWEAVE_AGENT` 接入。

---

## 快速开始

```bash
pnpm install
pnpm build                         # 构建全部

# 起前端编辑器 + Host（两个终端）
pnpm dev:host                      # 默认启发式 Agent，ACP WS + 产物 HTTP，:8787
pnpm dev:web                       # 前端编辑器

# 用真实 Claude（需本机 Claude 登录态 / ANTHROPIC_API_KEY / 兼容网关）
DSWEAVE_AGENT=claude pnpm dev:host
```

打开前端后：拖入 `.glb`/图片/文档 → 连线写语义 → 输出节点选 `scene.html` → **Start**。

完整设计与里程碑见 [`docs/`](./docs/README.md)。

---

要求：**Node ≥ 20，pnpm ≥ 9**。
