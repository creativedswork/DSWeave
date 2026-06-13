# DSWeave

**空间化知识引擎**：拖入文件 → Agent 理解 → 产出 **3D 沉浸式知识场景（HTML/WebGL）**。

- 输入只有文件（gltf / md / pdf / txt / html / 图片 / 数据）。
- 连线与输出是自然语言语义；输出是受限菜单（旗舰 `scene.html`，3D 沉浸单文件）。
- Agent 通过 **ACP** 连接，只产出 `SceneSpec` 数据；自研 R3F **Scene Player** 渲染产物。

完整设计见 [`docs/`](./docs/README.md)。

## Monorepo

| 包 | 职责 |
| --- | --- |
| `@dsweave/core` | 节点图 / IR / SceneSpec / 类型 / zod schema（前后端共享） |
| `@dsweave/protocol` | ACP 封装：图→prompt 编码、update→事件解码、transport 抽象 |
| `@dsweave/host` | Node 进程：WS 桥接、文件服务、文件理解、能力执行、Agent 管理 |
| `@dsweave/web` | 前端编辑器：画布、预览、面板 |
| `@dsweave/player` | 自研 R3F 3D 运行时，数据驱动渲染 SceneSpec → 产物 |
| `@dsweave/agent` | 参考 ACP Agent（可插拔；亦可接外部 Agent） |

## 开发

```bash
pnpm install
pnpm build         # 构建全部
pnpm typecheck     # 类型检查
pnpm lint          # 代码检查
pnpm dev:web       # 启动前端编辑器
pnpm dev:player    # 启动 Scene Player（开发用）
```

要求：Node ≥ 20，pnpm ≥ 9。
