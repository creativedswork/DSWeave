# Agent 自由写 HTML 主链路改造 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把主链路从「Agent 产 SceneSpec → Player 渲染」翻转为「Agent 直接写自包含 `index.html` → Host 注入 `<model-viewer>` 运行时 + 内联资产字节 + 轻量校验」，让 Agent 能自由输出含自撰长文（如边语义要求的 ≥500 字模型说明）+ 模型预览 + 自定义风格的产物。

**Architecture:** Agent 经 ACP 写 `<cwd>/index.html`，HTML 里用 `asset://{nodeId}` 占位引用源文件、用 `<model-viewer>` 预览模型。Host 侧能力 `scene.html` 负责注入 vendored model-viewer UMD 运行时、把 `asset://` 替换为内联 `data:` URI、content-address 后落盘。校验（非空 / 无外链 / asset 引用均指向已知 nodeId）放在 Agent 回灌重试循环里（纯文本检查），资产内联放在能力里。

**Tech Stack:** TypeScript (ESM / NodeNext)、pnpm workspace、`@google/model-viewer`（新增，UMD bundle 内联）、`@agentclientprotocol/sdk`；验证沿用仓库既有的 `tsx` + `node:assert` 检查脚本与 `*-smoke.ts` 端到端脚本（无 vitest）。

---

## 背景与根因（来自 spec）

`docs/superpowers/specs/2026-06-27-agent-freeform-html-design.md`。当前文字链路只读引用式：`ScenePanel/SceneHotspot` 只能引用既有文档 chunkId（`packages/host/src/capabilities/scene-html.ts:66`、`packages/host/src/claude/prompt.ts:41`），Agent 自撰文字无处可放。只拖一个 glb（无 chunk）时，要求生成的 500 字描述被丢弃。

## 文件结构（创建 / 修改 / 删除）

**新建：**
- `packages/host/src/export/inline-html.ts` — `asset://{nodeId}` → data URI 内联 + model-viewer 运行时注入（纯函数）。
- `packages/host/src/export/inline-html.check.ts` — 上面的 node:assert 检查脚本。
- `packages/host/src/export/validate-html.ts` — Agent 侧纯文本校验（非空 / 无外链 / asset 引用合法）。
- `packages/host/src/export/validate-html.check.ts` — 校验检查脚本。
- `packages/host/src/export/model-viewer-runtime.ts` — 解析并缓存 `@google/model-viewer` UMD bundle 文本。

**修改：**
- `packages/protocol/src/messages.ts:172-175` — `SceneHtmlInput { spec }` → `HtmlPageInput { html: string }`。
- `packages/host/src/capabilities/scene-html.ts` — 能力体改为消费 `{ html }`：注入运行时 + 内联资产 + content-address。
- `packages/host/src/claude/prompt.ts` — 重写 prompt（自由 HTML 指令 + 上下文给真实分块文本 + `knownNodeIds`）；改 `buildRetryPrompt`；导出 `OUTPUT_FILENAME`。
- `packages/host/src/acp/acp-agent.ts` — 读 `index.html`（非 `scene.spec.json`），改用 `validateHtml` 文本校验回灌重试，调用能力传 `{ html }`。
- `packages/agent/src/scene-agent.ts` — 启发式 Agent 改为产出 HTML 字符串（不再 SceneSpec），调用能力传 `{ html }`。
- `packages/host/src/claude/fake-adapter.ts` — 假 adapter 写 `index.html`（含 `asset://` 与 ≥500 字文本）。
- `packages/host/package.json` — 新增依赖 `@google/model-viewer`。
- `packages/web/src/store/useDSWeaveStore.ts:34` — `CAPABILITIES` 注释/不变（仍含 `scene.html`），无需改逻辑。
- `README.md` / `docs/04-player.md` 等 — 改写理念段落。

**删除（清理任务，最后做）：**
- `packages/player/`（整包）、`packages/core/src/scene-spec.ts`、`packages/host/src/export/inject-player.ts`、依赖 SceneSpec 的旧 smoke（`m4-smoke.ts`/`m4b-smoke.ts` 等）按需改造或删。

---

## Task 1: 资产内联 + 运行时注入纯函数

**Files:**
- Create: `packages/host/src/export/inline-html.ts`
- Create: `packages/host/src/export/inline-html.check.ts`

- [ ] **Step 1: 写检查脚本（先失败）**

创建 `packages/host/src/export/inline-html.check.ts`：

```ts
import assert from 'node:assert/strict';
import { inlineAssets, injectViewerRuntime } from './inline-html.js';

// 1) asset:// 替换为 data URI，并报告无法解析的引用
{
  const html = '<model-viewer src="asset://n1"></model-viewer><img src="asset://nX">';
  const { html: out, missing } = inlineAssets(html, (id) =>
    id === 'n1' ? { mime: 'model/gltf-binary', bytes: new Uint8Array([1, 2, 3]) } : undefined,
  );
  assert.ok(out.includes('data:model/gltf-binary;base64,'), '应内联 data URI');
  assert.ok(!out.includes('asset://n1'), 'n1 占位应被替换');
  assert.deepEqual(missing, ['nX'], '未解析引用应报告');
  assert.ok(out.includes('asset://nX'), '未解析引用保持原样');
}

// 2) 同一 nodeId 多次引用只编码一次且都被替换
{
  let calls = 0;
  const html = 'a asset://n1 b asset://n1 c';
  const { html: out } = inlineAssets(html, () => {
    calls++;
    return { mime: 'image/png', bytes: new Uint8Array([9]) };
  });
  assert.equal(calls, 1, '同一 nodeId 只解析一次');
  assert.equal(out.match(/data:image\/png/g)?.length, 2, '两处都被替换');
}

// 3) 运行时注入到 <head>
{
  const out = injectViewerRuntime('<html><head></head><body>x</body></html>', 'CONSOLE_LOG');
  assert.ok(out.includes('<script>CONSOLE_LOG</script>'), '应注入运行时脚本');
  assert.ok(out.indexOf('CONSOLE_LOG') < out.indexOf('</head>'), '运行时应在 head 内');
}

// 4) 无 <head> 时退化注入到 <body> 前 / 开头
{
  const out = injectViewerRuntime('<body>x</body>', 'RT');
  assert.ok(out.includes('<script>RT</script>'), '无 head 也应注入');
}

console.log('✓ inline-html.check 通过');
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @dsweave/host exec tsx src/export/inline-html.check.ts`
Expected: FAIL（`Cannot find module './inline-html.js'`）

- [ ] **Step 3: 实现 `inline-html.ts`**

创建 `packages/host/src/export/inline-html.ts`：

```ts
/**
 * 把 Agent 写的自由 HTML 转成自包含产物：
 * - injectViewerRuntime：内联 model-viewer 运行时，保证 <model-viewer> 离线可用。
 * - inlineAssets：把 asset://{nodeId} 占位替换为内联 data: URI（Agent 物理上无法吐二进制）。
 */

export interface ResolvedAsset {
  mime: string;
  bytes: Uint8Array;
}

/** nodeId → 资产字节；未登记返回 undefined。 */
export type AssetResolver = (nodeId: string) => ResolvedAsset | undefined;

const ASSET_RE = /asset:\/\/([A-Za-z0-9_-]+)/g;

function toDataUri(a: ResolvedAsset): string {
  return `data:${a.mime};base64,${Buffer.from(a.bytes).toString('base64')}`;
}

/** 替换所有 asset://{nodeId}；返回新 HTML 与无法解析的 nodeId 列表（去重）。 */
export function inlineAssets(
  html: string,
  resolve: AssetResolver,
): { html: string; missing: string[] } {
  const cache = new Map<string, string | null>();
  const missing = new Set<string>();
  const out = html.replace(ASSET_RE, (whole, nodeId: string) => {
    let uri = cache.get(nodeId);
    if (uri === undefined) {
      const asset = resolve(nodeId);
      uri = asset ? toDataUri(asset) : null;
      cache.set(nodeId, uri);
    }
    if (uri === null) {
      missing.add(nodeId);
      return whole;
    }
    return uri;
  });
  return { html: out, missing: [...missing] };
}

/** 把运行时脚本注入到 <head>（缺省退化到 <body> 前或开头）。 */
export function injectViewerRuntime(html: string, runtime: string): string {
  const tag = `<script>${runtime}</script>`;
  const headEnd = html.indexOf('</head>');
  if (headEnd !== -1) return html.slice(0, headEnd) + tag + html.slice(headEnd);
  const bodyStart = html.indexOf('<body');
  if (bodyStart !== -1) return html.slice(0, bodyStart) + tag + html.slice(bodyStart);
  return tag + html;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @dsweave/host exec tsx src/export/inline-html.check.ts`
Expected: PASS（输出 `✓ inline-html.check 通过`）

- [ ] **Step 5: 提交**

```bash
git add packages/host/src/export/inline-html.ts packages/host/src/export/inline-html.check.ts
git commit -m "feat(host): asset:// 内联 + model-viewer 运行时注入纯函数"
```

---

## Task 2: Agent 侧 HTML 文本校验

**Files:**
- Create: `packages/host/src/export/validate-html.ts`
- Create: `packages/host/src/export/validate-html.check.ts`

- [ ] **Step 1: 写检查脚本（先失败）**

创建 `packages/host/src/export/validate-html.check.ts`：

```ts
import assert from 'node:assert/strict';
import { validateHtml } from './validate-html.js';

const known = new Set(['n1', 'n2']);

// 合法：引用均已知、无外链、非空
assert.deepEqual(validateHtml('<model-viewer src="asset://n1"></model-viewer>', known), []);

// 空内容
assert.ok(validateHtml('   ', known).length > 0, '空内容应报错');

// 引用未知 nodeId
{
  const errs = validateHtml('<img src="asset://zzz">', known);
  assert.ok(errs.some((e) => e.includes('zzz')), '未知 nodeId 应报错');
}

// 外链脚本（违反离线）
{
  const errs = validateHtml('<script src="https://cdn.example/x.js"></script>', known);
  assert.ok(errs.some((e) => e.includes('外链')), '外链脚本应报错');
}

// 外链样式
{
  const errs = validateHtml('<link rel="stylesheet" href="http://x/y.css">', known);
  assert.ok(errs.some((e) => e.includes('外链')), '外链样式应报错');
}

console.log('✓ validate-html.check 通过');
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @dsweave/host exec tsx src/export/validate-html.check.ts`
Expected: FAIL（找不到模块）

- [ ] **Step 3: 实现 `validate-html.ts`**

创建 `packages/host/src/export/validate-html.ts`：

```ts
/**
 * Agent 侧纯文本校验：在 Agent 回灌重试循环里跑（不依赖 Host 资产服务）。
 * 失败项会拼成回灌追问，触发 Agent 重写 index.html。
 */

const ASSET_RE = /asset:\/\/([A-Za-z0-9_-]+)/g;
const EXTERNAL_SCRIPT_RE = /<script[^>]+\bsrc\s*=\s*["']https?:/i;
const EXTERNAL_LINK_RE = /<link[^>]+\bhref\s*=\s*["']https?:/i;

/** 返回错误列表（空数组=通过）。knownNodeIds 来自 prompt 上下文里的真实节点。 */
export function validateHtml(html: string, knownNodeIds: Set<string>): string[] {
  const errors: string[] = [];

  if (!html || html.trim().length === 0) {
    errors.push('产物为空：必须写出非空的 index.html。');
    return errors;
  }

  for (const m of html.matchAll(ASSET_RE)) {
    const id = m[1]!;
    if (!knownNodeIds.has(id)) {
      errors.push(`asset://${id} 指向未知节点；只能引用上下文里列出的 nodeId。`);
    }
  }

  if (EXTERNAL_SCRIPT_RE.test(html)) {
    errors.push('禁止外链脚本（<script src="http...">）：产物必须离线自包含。');
  }
  if (EXTERNAL_LINK_RE.test(html)) {
    errors.push('禁止外链样式（<link href="http...">）：产物必须离线自包含。');
  }

  // 去重（同一 nodeId 多处引用只报一次）
  return [...new Set(errors)];
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @dsweave/host exec tsx src/export/validate-html.check.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/host/src/export/validate-html.ts packages/host/src/export/validate-html.check.ts
git commit -m "feat(host): Agent 侧 HTML 文本校验（非空/无外链/asset 引用合法）"
```

---

## Task 3: vendored model-viewer 运行时

**Files:**
- Modify: `packages/host/package.json`
- Create: `packages/host/src/export/model-viewer-runtime.ts`

- [ ] **Step 1: 安装依赖**

Run: `pnpm --filter @dsweave/host add @google/model-viewer`
Expected: `packages/host/package.json` 的 dependencies 出现 `@google/model-viewer`。

- [ ] **Step 2: 确认 UMD bundle 存在**

Run: `ls node_modules/@google/model-viewer/dist/model-viewer-umd.min.js`
Expected: 文件存在（若不存在，改用 `model-viewer.min.js` 并在下一步同步路径）。

- [ ] **Step 3: 实现 `model-viewer-runtime.ts`**

创建 `packages/host/src/export/model-viewer-runtime.ts`：

```ts
/**
 * 解析并缓存 @google/model-viewer 的 UMD bundle 文本，供内联进产物 <head>。
 * UMD（classic script）自注册 <model-viewer> 自定义元素且自带 three，离线可用。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

let cache: string | undefined;

/** 取 model-viewer UMD 脚本文本（首次读盘后缓存）。 */
export function getModelViewerScript(): string {
  if (cache !== undefined) return cache;
  const pkgJson = require.resolve('@google/model-viewer/package.json');
  const bundle = join(dirname(pkgJson), 'dist', 'model-viewer-umd.min.js');
  cache = readFileSync(bundle, 'utf-8');
  return cache;
}
```

- [ ] **Step 4: 冒烟确认能读到脚本**

Run: `pnpm --filter @dsweave/host exec tsx -e "import('./src/export/model-viewer-runtime.ts').then(m=>{const s=m.getModelViewerScript();console.log('len',s.length, s.includes('model-viewer'));})"`
Expected: 打印一个较大的 `len`（数十万），且 `true`。

- [ ] **Step 5: 提交**

```bash
git add packages/host/package.json packages/host/src/export/model-viewer-runtime.ts ../../pnpm-lock.yaml
git commit -m "feat(host): vendored model-viewer UMD 运行时（离线内联）"
```

---

## Task 4: 协议输入契约 SceneHtmlInput → HtmlPageInput

**Files:**
- Modify: `packages/protocol/src/messages.ts:172-175`

- [ ] **Step 1: 改类型**

把 `packages/protocol/src/messages.ts` 中：

```ts
/** scene.html 能力的输入：Agent 唯一交付物 SceneSpec。 */
export interface SceneHtmlInput {
  spec: SceneSpec;
}
```

替换为：

```ts
/** scene.html 能力的输入：Agent 自撰的自包含 HTML（含 asset:// 占位引用）。 */
export interface HtmlPageInput {
  html: string;
}
```

- [ ] **Step 2: 处理 SceneSpec 引用**

`SceneSpec` 此前由 `messages.ts` 顶部 import。检查文件顶部 import：若 `SceneSpec` 不再被使用，从该 import 移除（保留其它仍用到的类型）。

Run: `grep -n "SceneSpec" packages/protocol/src/messages.ts`
Expected: 无残留引用（若有其它用途则保留 import）。

- [ ] **Step 3: 暂不构建**（下游 Task 5-7 会同步消费方，统一构建）

- [ ] **Step 4: 提交**

```bash
git add packages/protocol/src/messages.ts
git commit -m "refactor(protocol): scene.html 输入改为 HtmlPageInput { html }"
```

---

## Task 5: 重写 scene.html 能力（消费 HTML）

**Files:**
- Modify: `packages/host/src/capabilities/scene-html.ts`

- [ ] **Step 1: 重写能力体**

把 `packages/host/src/capabilities/scene-html.ts` 整个文件替换为：

```ts
/**
 * scene.html 能力：把 Agent 写的自由 HTML 转成自包含单文件产物。
 * 注入 model-viewer 运行时 + 把 asset://{nodeId} 内联为 data URI + content-address 落盘。
 */
import { createHash } from 'node:crypto';
import type { CapabilityInvokeResult, HtmlPageInput } from '@dsweave/protocol';
import type { Capability, CapabilityInvocation, CapabilityRuntime } from './registry.js';
import { inlineAssets, injectViewerRuntime, type ResolvedAsset } from '../export/inline-html.js';
import { getModelViewerScript } from '../export/model-viewer-runtime.js';

function guessMimeFromPath(path: string): string {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.') + 1);
  switch (ext) {
    case 'glb':
      return 'model/gltf-binary';
    case 'gltf':
      return 'model/gltf+json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export const sceneHtmlCapability: Capability = {
  id: 'scene.html',
  version: '2',
  async invoke(inv: CapabilityInvocation, rt: CapabilityRuntime): Promise<CapabilityInvokeResult> {
    const input = inv.input as HtmlPageInput | undefined;
    const raw = input?.html;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error('scene.html 输入为空：需要非空的 HTML 字符串');
    }

    const withRuntime = injectViewerRuntime(raw, getModelViewerScript());
    const { html, missing } = inlineAssets(withRuntime, (nodeId): ResolvedAsset | undefined => {
      const stored = rt.understanding.getStoredFile(nodeId);
      if (!stored) return undefined;
      return { mime: stored.ref.mime || guessMimeFromPath(stored.ref.uri), bytes: stored.bytes };
    });
    if (missing.length) {
      throw new Error(`无法解析资产引用：${missing.join(', ')}`);
    }

    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
    if (rt.artifacts.has(hash)) {
      return {
        artifact: rt.artifacts.artifactFor(hash, 'index.html', 'text/html', inv.outputNodeId),
        cached: true,
      };
    }
    const artifact = rt.artifacts.write(hash, 'index.html', html, 'text/html', inv.outputNodeId);
    return { artifact, cached: false };
  },
};
```

注意：旧文件导出的 `ChunkInfo` 接口被 `understanding-service.ts` 与 `inject-player.ts` import。下一步处理。

- [ ] **Step 2: 迁移 `ChunkInfo` 定义**

`ChunkInfo` 原定义在 `scene-html.ts`，现已删除。把它移到 `packages/host/src/understanding-service.ts` 顶部（它是 chunkIndex 的返回类型），并删除该文件里 `import type { ChunkInfo } from './capabilities/scene-html.js';`：

在 `understanding-service.ts` 删除：
```ts
import type { ChunkInfo } from './capabilities/scene-html.js';
```
新增（放在 import 之后、class 之前）：
```ts
/** chunkIndex 返回的文档片段（来源可追溯）。 */
export interface ChunkInfo {
  text: string;
  loc?: string;
  nodeId: string;
  label?: string;
}
```

- [ ] **Step 3: 更新 capabilities/index.ts 的 ChunkInfo 再导出**

`packages/host/src/capabilities/index.ts` 有 `export type { ChunkInfo } from './scene-html.js';`。改为从 understanding-service 导出，或直接删除该行（若无外部消费）。

Run: `grep -rn "ChunkInfo" packages/host/src`
Expected: 仅 `understanding-service.ts` 定义 + 内部使用；修掉所有指向 `scene-html.js` 的 import。

- [ ] **Step 4: 类型检查**

Run: `pnpm --filter @dsweave/host exec tsc -b`
Expected: 仅剩「acp-agent.ts / 旧 smoke 仍引用 SceneSpec / SceneHtmlInput」的错误（Task 6-8 修复）。inline/capability 相关无错。

- [ ] **Step 5: 提交**

```bash
git add packages/host/src/capabilities/scene-html.ts packages/host/src/understanding-service.ts packages/host/src/capabilities/index.ts
git commit -m "feat(host): scene.html 能力改为消费 HTML（注入运行时+内联资产）"
```

---

## Task 6: 重写 prompt（自由 HTML 指令 + 真实分块文本）

**Files:**
- Modify: `packages/host/src/claude/prompt.ts`

- [ ] **Step 1: 替换 schema/rules/上下文与 prompt 文本**

把 `packages/host/src/claude/prompt.ts` 中 `SCENE_SPEC_FILENAME`、`SCHEMA_DOC`、`RULES`、`extractContext`、`buildClaudePrompt`、`buildRetryPrompt` 整体替换。`ClaudeContext` 的 docs 改为携带**真实文本**（不再 preview 截断），并新增 `knownNodeIds`。新文件关键片段：

```ts
export const OUTPUT_FILENAME = 'index.html';

export interface SceneContext {
  outputNodeId: string;
  outputTypeId: string;
  hint: string;
  models: { nodeId: string; label: string; parts: string[] }[];
  images: { nodeId: string; label: string }[];
  docs: { nodeId: string; label: string; chunks: { id: string; text: string }[] }[];
  edges: { from: string; to: string; semantics: string }[];
  /** 所有可被 asset:// 引用的节点 id（models ∪ images ∪ docs）。 */
  knownNodeIds: string[];
}

const RULES = `规则：
1. 你唯一的交付物是把一个完整、自包含的 HTML 写入当前工作目录的 ${OUTPUT_FILENAME}；不要创建其它文件。
2. 要嵌入某个源文件（模型/图片），用占位 src：asset://{nodeId}，nodeId 取自下方上下文。Host 会把它替换为内联 data URI——不要自己写 base64，不要写真实路径。
3. 预览 3D 模型：用 <model-viewer src="asset://{nodeId}" camera-controls auto-rotate style="width:100%;height:480px"></model-viewer>。运行时由 Host 注入，不要自己引入任何 <script src>。
4. 禁止任何外链资源（http/https 的 script/link/字体/CDN）：产物必须离线双击可打开。样式写进 <style>，脚本写进内联 <script>。
5. 充分按连线语义撰写文字：语义要求「生成一段不少于 N 字的说明」时，你必须真的写出 ≥N 字的中文正文放进 HTML，可参考下方 docs 的真实内容，但缺文档时要自行生成。
6. 结合输出诉求（hint）决定整体风格/排版/配色。
7. 写完 ${OUTPUT_FILENAME} 后用一句话确认即可。`;

export function extractContext(prompt: PromptInput): SceneContext {
  const graph = prompt.graph;
  const outputNode = graph.nodes.find((n) => n.kind === 'output');
  const models = graph.nodes
    .filter((n) => n.kind === 'source' && n.understanding?.model)
    .map((n) => ({
      nodeId: n.id,
      label: n.label ?? n.id,
      parts: (n.understanding?.model?.nodes ?? []).map((p) => p.name).filter(Boolean),
    }));
  const images = graph.nodes
    .filter((n) => n.kind === 'source' && n.file?.type === 'image')
    .map((n) => ({ nodeId: n.id, label: n.label ?? n.file?.uri ?? n.id }));
  const docs = (prompt.context?.files ?? [])
    .map((f) => ({
      nodeId: f.nodeId,
      label: f.label ?? f.nodeId,
      chunks: (f.chunks ?? []).map((c) => ({ id: c.id, text: c.text })),
    }))
    .filter((d) => d.chunks.length > 0);
  const edges = graph.edges.map((e) => ({
    from: e.source,
    to: e.target,
    semantics: e.semantics ?? '',
  }));
  const knownNodeIds = [
    ...models.map((m) => m.nodeId),
    ...images.map((i) => i.nodeId),
    ...docs.map((d) => d.nodeId),
  ];
  return {
    outputNodeId: outputNode?.id ?? 'out',
    outputTypeId: outputNode?.output?.typeId ?? 'scene.html',
    hint: outputNode?.output?.spec ?? '',
    models,
    images,
    docs,
    edges,
    knownNodeIds,
  };
}

export function buildScenePrompt(prompt: PromptInput): { text: string; context: SceneContext } {
  const context = extractContext(prompt);
  const graph = prompt.graph;
  const edgeLines = graph.edges
    .map((e) => `  - ${e.source} → ${e.target}${e.semantics ? `：${e.semantics}` : ''}`)
    .join('\n');
  const styleHint =
    context.outputTypeId === 'report.html'
      ? '风格基调：偏 2D 知识报告（目录+正文+引用），但仍可用 <model-viewer> 预览模型。'
      : '风格基调：偏 3D 沉浸（以 <model-viewer> 为主视觉），辅以文字说明。';
  const text = [
    `你是 DSWeave 的产出 Agent。把下面的工作流编排成一个自包含的 ${OUTPUT_FILENAME}。`,
    ``,
    `工作流「${graph.name}」的连线意图：`,
    edgeLines || '  （无显式连线）',
    ``,
    `用户对输出（${context.outputTypeId}）的诉求：${context.hint || '（未指定，自行决定合理风格）'}`,
    styleHint,
    ``,
    RULES,
    ``,
    `<DSWEAVE_CONTEXT>`,
    JSON.stringify(context),
    `</DSWEAVE_CONTEXT>`,
  ].join('\n');
  return { text, context };
}

export function buildRetryPrompt(errors: string): string {
  return [
    `${OUTPUT_FILENAME} 未通过校验：`,
    errors,
    `请修正后重新写入 ${OUTPUT_FILENAME}（保持自包含、无外链、asset:// 只引用上下文里的 nodeId）。`,
  ].join('\n');
}
```

同时删除文件顶部对 `SCENE_SPEC_FILENAME` 的导出与旧 `buildClaudePrompt`/`ClaudeContext` 别名（若有引用方，下一步统一改名）。保留向后兼容别名可选：`export { buildScenePrompt as buildClaudePrompt };`。

- [ ] **Step 2: 修复 fake-adapter 的 Ctx 类型（doc.chunks 现含 text 而非 preview）**

见 Task 8（fake-adapter 同步重写）。此处先不动。

- [ ] **Step 3: 类型检查**

Run: `pnpm --filter @dsweave/host exec tsc -b`
Expected: 仅剩 acp-agent / smoke 的 SceneSpec 相关错误。

- [ ] **Step 4: 提交**

```bash
git add packages/host/src/claude/prompt.ts
git commit -m "feat(host): 重写 prompt 为自由 HTML 指令，上下文带真实分块文本"
```

---

## Task 7: 重写 Agent 主循环（读 index.html + 文本校验重试）

**Files:**
- Modify: `packages/host/src/acp/acp-agent.ts`

- [ ] **Step 1: 改 import**

把顶部：
```ts
import { safeValidateSceneSpec, type SceneSpec } from '@dsweave/core';
import { buildScenePrompt, buildRetryPrompt, SCENE_SPEC_FILENAME } from '../claude/prompt.js';
```
改为：
```ts
import type { HtmlPageInput } from '@dsweave/protocol';
import { buildScenePrompt, buildRetryPrompt, OUTPUT_FILENAME } from '../claude/prompt.js';
import { validateHtml } from '../export/validate-html.js';
```
并把 `import { ..., type SceneHtmlInput } from '@dsweave/protocol';` 中的 `SceneHtmlInput` 移除（用上面的 `HtmlPageInput`）。

- [ ] **Step 2: 改产出文件路径**

把 `const specPath = join(cwd, SCENE_SPEC_FILENAME);` 改为：
```ts
const htmlPath = join(cwd, OUTPUT_FILENAME);
const knownNodeIds = new Set(context.knownNodeIds);
```

- [ ] **Step 3: 替换校验回灌重试循环**

把 `// prompt turn + 校验回灌重试` 到 `if (!spec) { ... }` 之间整段（约 acp-agent.ts:157-209）替换为：

```ts
    // prompt turn + 文本校验回灌重试
    let html: string | undefined;
    let promptText = text;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isCancelled()) return finish(conn, sessionId, 'cancelled', session, cwd);
      const outcome = await session.prompt(promptText, handlers);
      flush(true);
      if (outcome.stopReason !== 'end_turn') {
        log(`${backend.label} turn 异常结束：${outcome.stopReason}`, 'warn');
      }
      if (!existsSync(htmlPath)) {
        if (attempt < maxRetries) {
          log(`未发现 ${OUTPUT_FILENAME}，回灌重试（${attempt + 1}/${maxRetries}）`, 'warn');
          promptText = buildRetryPrompt(`未找到 ${OUTPUT_FILENAME}`);
          continue;
        }
        break;
      }
      const candidate = readFileSync(htmlPath, 'utf-8');
      const errors = validateHtml(candidate, knownNodeIds);
      if (errors.length === 0) {
        html = candidate;
        break;
      }
      const msg = errors.join('；');
      log(`HTML 校验失败：${msg}`, 'warn');
      if (attempt < maxRetries) promptText = buildRetryPrompt(msg);
    }

    if (!html) {
      conn.sessionUpdate(sessionId, {
        type: 'node-status',
        nodeId: outputNodeId,
        status: 'error',
        message: 'HTML 未产出/未通过校验',
      });
      return finish(conn, sessionId, 'error', session, cwd);
    }
    log(`HTML 就绪：${html.length} 字符`);
```

- [ ] **Step 4: 改能力调用入参**

把 `const input: SceneHtmlInput = { spec };` 改为 `const input: HtmlPageInput = { html };`。

- [ ] **Step 5: 类型检查**

Run: `pnpm --filter @dsweave/host exec tsc -b`
Expected: 仅剩 agent 包 scene-agent.ts 与 smoke 的 SceneSpec 相关错误（Task 8 修复）。

- [ ] **Step 6: 提交**

```bash
git add packages/host/src/acp/acp-agent.ts
git commit -m "feat(host): Agent 主循环改读 index.html + 文本校验回灌重试"
```

---

## Task 8: 启发式 Agent + 假 adapter 产出 HTML + 端到端 smoke

**Files:**
- Create: `packages/agent/src/html-builder.ts`
- Modify: `packages/agent/src/scene-agent.ts`
- Modify: `packages/host/src/claude/fake-adapter.ts`
- Create: `packages/host/src/freeform-smoke.ts`
- Modify: `package.json`（新增 `freeform:smoke` 脚本）

- [ ] **Step 1: 写启发式 HTML 生成器**

创建 `packages/agent/src/html-builder.ts`（确定性产出，含 model-viewer + ≥500 字占位说明）：

```ts
import type { FlowGraph } from '@dsweave/core';

/** 从图确定性生成一个自包含 HTML 草稿（asset:// 引用 + 长文说明）。 */
export function buildHtml(graph: FlowGraph, hint: string): string {
  const models = graph.nodes.filter((n) => n.kind === 'source' && n.understanding?.model);
  const images = graph.nodes.filter((n) => n.kind === 'source' && n.file?.type === 'image');
  const semantics = graph.edges.map((e) => e.semantics).filter(Boolean).join('；');

  const viewers = models
    .map(
      (m) =>
        `<model-viewer src="asset://${m.id}" camera-controls auto-rotate style="width:100%;height:480px"></model-viewer>`,
    )
    .join('\n');
  const imgs = images
    .map((i) => `<img src="asset://${i.id}" style="max-width:100%" alt="${i.label ?? i.id}">`)
    .join('\n');

  const base = `本场景由 DSWeave 依据连线语义编排。${hint ? `输出诉求：${hint}。` : ''}${
    semantics ? `连线意图：${semantics}。` : ''
  }`;
  // 确保 ≥500 字（启发式：重复扩写填充，真实 LLM 会写实质内容）。
  let body = base;
  while (body.length < 520) body += `该模型可旋转查看细节，配合说明文字帮助理解其结构与用途。`;

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>${graph.name}</title>
<style>body{font-family:system-ui;max-width:880px;margin:40px auto;padding:0 16px;background:#0b0d12;color:#e7e9ee}</style>
</head><body>
<h1>${graph.name}</h1>
${viewers}
${imgs}
<section><p>${body}</p></section>
</body></html>`;
}
```

- [ ] **Step 2: 改 `scene-agent.ts` 产出 HTML**

`packages/agent/src/scene-agent.ts`：
- import：删 `safeValidateSceneSpec` / `buildSceneSpec` / `type SceneHtmlInput`；加 `import type { HtmlPageInput } from '@dsweave/protocol';` 与 `import { buildHtml } from './html-builder.js';`。
- 把「产出 SceneSpec（启发式）…」整段（约 89-101 行）替换为：
```ts
    const html = buildHtml(graph, node.output?.spec ?? '');
    log(`HTML 就绪：${html.length} 字符`);
```
- 把权限提示文案 `把 SceneSpec 注入 Player 并写入产物文件` 改为 `把 HTML 注入运行时并写入产物文件`。
- 把 `const input: SceneHtmlInput = { spec };` 改为 `const input: HtmlPageInput = { html };`。

- [ ] **Step 3: 改 `fake-adapter.ts` 写 index.html**

`packages/host/src/claude/fake-adapter.ts`：
- `CtxDoc.chunks` 的元素由 `{ id; preview }` 改为 `{ id; text }`（与新 SceneContext 对齐）。
- 删除 `buildSpec`，新增 `buildHtml(ctx)`：从 ctx 取首个 model/image，产出含 `<model-viewer src="asset://{nodeId}">`、`<img src="asset://{nodeId}">` 与 ≥500 字正文的 HTML（逻辑同 Task 8 Step 1，但读 ctx 而非 graph）。
- 把 `writeFileSync(join(process.cwd(), 'scene.spec.json'), JSON.stringify(buildSpec(ctx), null, 2), 'utf-8');` 改为 `writeFileSync(join(process.cwd(), 'index.html'), buildHtml(ctx), 'utf-8');`。
- 文案里 `scene.spec.json` 改 `index.html`。

```ts
function buildHtml(ctx: Ctx): string {
  const model = ctx.models[0];
  const img = (ctx.images ?? [])[0];
  const sem = (ctx.edges ?? []).map((e) => e.semantics).filter(Boolean).join('；');
  let body = `这是模型的说明文字。${sem ? `连线意图：${sem}。` : ''}`;
  while (body.length < 520) body += `本说明用于验证 Agent 自撰长文能够进入最终产物。`;
  const viewer = model
    ? `<model-viewer src="asset://${model.nodeId}" camera-controls auto-rotate style="width:100%;height:480px"></model-viewer>`
    : '';
  const image = img ? `<img src="asset://${img.nodeId}" style="max-width:100%">` : '';
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>fake</title></head><body>${viewer}${image}<section><p>${body}</p></section></body></html>`;
}
```

- [ ] **Step 4: 写端到端 smoke 脚本**

参考既有 `packages/host/src/m4b-smoke.ts` 结构，创建 `packages/host/src/freeform-smoke.ts`：构造「一个 glb source 节点 + output(scene.html) + 边语义『生成不少于 500 字说明』」的图 → 经假 adapter 写 index.html → Host 能力注入+内联 → 断言产物：
  - 含 `<model-viewer`；
  - 含模型 data URI（`data:model/gltf-binary;base64,`）；
  - 不含残留 `asset://`；
  - 不含外链 `src="http`；
  - 正文长度（去标签后）≥ 500。

断言失败用 `process.exit(1)`，成功打印 `✅ FREEFORM SMOKE PASS`。（复用 m4b-smoke 的图/资产/会话搭建样板，仅替换断言；glb 字节可用 m4b-smoke 同款最小 glb fixture。）

- [ ] **Step 5: 加 smoke 脚本到根 package.json**

在 `package.json` scripts 加：
```json
"freeform:smoke": "pnpm --filter @dsweave/host build && node packages/host/dist/freeform-smoke.js",
```

- [ ] **Step 6: 构建并跑 smoke**

Run: `pnpm --filter @dsweave/core --filter @dsweave/protocol --filter @dsweave/agent build && pnpm freeform:smoke`
Expected: `✅ FREEFORM SMOKE PASS`

- [ ] **Step 7: 提交**

```bash
git add packages/agent/src/html-builder.ts packages/agent/src/scene-agent.ts packages/host/src/claude/fake-adapter.ts packages/host/src/freeform-smoke.ts package.json
git commit -m "feat: 启发式/假 Agent 产出自由 HTML + 端到端 freeform smoke"
```

---

## Task 9: 清理废弃物 + 文档改写

**Files:**
- Delete: `packages/player/`、`packages/core/src/scene-spec.ts`、`packages/host/src/export/inject-player.ts`、`packages/host/src/{m4-smoke,m4b-smoke,gemini-smoke}.ts`（及对应根脚本）
- Modify: `packages/core/src/index.ts`、`package.json`（build/scripts 去 player）、`README.md`、`docs/04-player.md`

- [ ] **Step 1: 删 SceneSpec 与 player 注入**

```bash
rm packages/host/src/export/inject-player.ts
rm packages/core/src/scene-spec.ts
```
`packages/core/src/index.ts` 删 `export * from './scene-spec.js';`。

- [ ] **Step 2: 删/改依赖 SceneSpec 的旧 smoke**

Run: `grep -rln "SceneSpec\|scene.spec.json\|injectPlayer\|playerTemplate" packages`
对每个命中文件：旧 smoke（`m4-smoke.ts`/`m4b-smoke.ts`/`gemini-smoke.ts`/`m3-smoke.ts` 等）若仅验证 SceneSpec 链路则删除，并从根 `package.json` 去掉对应脚本；`artifacts.ts` 删除 `playerTemplate`/`playerDistPath` 相关（若 freeform 链路不再用）。

- [ ] **Step 3: 删 player 包 + 去构建引用**

```bash
rm -rf packages/player
```
`package.json` 的 `build`/`typecheck`/`clean`/`dev:player` 去掉 `@dsweave/player`。检查 `packages/host/package.json` 等是否依赖 player（应无）。

- [ ] **Step 4: 全量构建 + smoke 回归**

Run: `pnpm install && pnpm build && pnpm freeform:smoke`
Expected: 构建通过；`✅ FREEFORM SMOKE PASS`。

- [ ] **Step 5: 文档改写**

`README.md`：把「Agent 只产数据、不写代码 / Player 渲染」段落改写为新理念「Agent 直接写自包含 HTML，Host 注入 model-viewer 运行时 + 内联资产兜底」；视觉词汇表/Player 相关行删改。`docs/04-player.md` 标注废弃或改写。

- [ ] **Step 6: 提交**

```bash
git add -A
git commit -m "chore: 移除 SceneSpec/Player 旧链路，改写文档为自由 HTML 架构"
```

---

## Self-Review（spec 覆盖核对）

- 根因「自撰文字无处放」→ Task 6（prompt 允许自由正文）+ Task 8（smoke 断言 ≥500 字进入产物）覆盖。✓
- 物理约束「Host 内联资产」→ Task 1 `inlineAssets` + Task 5 能力。✓
- model-viewer 离线兜底 → Task 3 + Task 5 注入。✓
- 校验 + 回灌重试 → Task 2（文本校验）+ Task 7（重试循环）。✓
- `asset://{nodeId}` 协议、复用 `scene.html` id → Task 1/4/5。✓
- 输出类型变风格 hint → Task 6 `styleHint`。✓
- 删除 player/SceneSpec、README 改写 → Task 9。✓
- 类型一致性：`HtmlPageInput.html`、`SceneContext.knownNodeIds`、`OUTPUT_FILENAME='index.html'`、能力 id `scene.html` v2 在 Task 4-8 间保持一致。✓

## 已知 v1 限制（非阻塞）

- `.gltf`（JSON + 外部 .bin/纹理）只内联主文件，外部依赖不解析 → 推荐用单文件 `.glb`；多文件 gltf 完整内联留作后续。
- model-viewer UMD bundle 较大（数十万字符），会增大产物体积——可接受。
