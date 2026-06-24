/**
 * 把内部 PromptInput（图 + 理解 + 上下文 + 输出）编成给 Claude 的一段 ACP prompt 文本。
 *
 * 约束 Claude 的唯一交付物：把一个符合 SceneSpec schema 的 JSON 写到 `<cwd>/scene.spec.json`，
 * 不写任何运行时代码（Player 已预构建）。文本里同时附一段机器可读的 <DSWEAVE_CONTEXT> JSON，
 * 列出可引用的 nodeId / 部件名 / 分块 id，避免模型臆造引用。
 */
import type { PromptInput } from '@dsweave/protocol';

export const SCENE_SPEC_FILENAME = 'scene.spec.json';

/** 机器可读上下文（同时供真实模型与测试用的假 adapter 消费）。 */
export interface ClaudeContext {
  outputNodeId: string;
  outputTypeId: string;
  hint: string;
  models: { nodeId: string; label: string; parts: string[] }[];
  images: { nodeId: string; label: string }[];
  docs: { nodeId: string; label: string; chunks: { id: string; preview: string }[] }[];
  /** 节点间连线及其语义（驱动 connectors 的来源）。 */
  edges: { from: string; to: string; semantics: string }[];
}

const SCHEMA_DOC = `SceneSpec（写入 ${SCENE_SPEC_FILENAME} 的 JSON，字段如下）：
{
  "version": 1,
  "theme": { "palette": string, "style": string },   // 如 palette:"dark"/"light"，style 自由描述
  "layout": "single-focus" | "gallery",
  "models": [ { "nodeId": string, "assetRef": string, "placement"?: {position?:[x,y,z],rotation?:[x,y,z],scale?:number}, "autoRotate"?: boolean } ],
  "images": [ { "nodeId": string, "assetRef": string, "placement"?: {position?:[x,y,z],scale?:number}, "width"?: number, "label"?: string } ],
  "hotspots": [ { "modelNodeId": string, "part": string, "title": string, "bodyChunkIds": string[] } ],
  "panels": [ { "title": string, "chunkIds": string[] } ],
  "connectors": [ { "fromNodeId": string, "toNodeId": string, "label"?: string, "style"?: "arrow"|"line" } ],
  "citations": boolean
}`;

const RULES = `规则：
1. 你唯一的交付物是把上面 schema 的 JSON 写入当前工作目录的 ${SCENE_SPEC_FILENAME}。不要写任何代码、不要创建其它文件。
2. models[].nodeId 必须取自下方上下文块（DSWEAVE_CONTEXT）里的 models[].nodeId；images[].nodeId 取自 images[].nodeId；assetRef 直接用同一个 nodeId 即可。**上下文里出现的每个 model 和 image 都要放进场景，不要遗漏。**
3. hotspots[].modelNodeId 取自 models[].nodeId；part 必须是该模型 parts[] 里的真实部件名。
4. hotspots[].bodyChunkIds 与 panels[].chunkIds 必须取自 docs[].chunks[].id；不要臆造 id。
5. **connectors 来自 edges**：当一条连线（edge）的语义在描述两个元素之间的关系（如"箭头从 A 指向 B"、"A 生成 B"），就产出一个 connector，fromNodeId/toNodeId 取自 edge 的 from/to，label 用语义里的关键词（如"生成"）。
6. **布局**：用 placement.position（[x,y,z]，单位约等于模型尺寸）摆放元素以匹配连线语义（如"图片在左、模型在右"→ 图片 x 取负、模型 x 取正）；不确定时可省略 placement 交给默认并排布局。
7. 结合用户的输出诉求（hint）决定 theme/layout 与文档绑定方式。
8. 写完 ${SCENE_SPEC_FILENAME} 后用一句话确认即可。`;

/** 从 PromptInput 抽取机器可读上下文。 */
export function extractContext(prompt: PromptInput): ClaudeContext {
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
      chunks: (f.chunks ?? []).map((c) => ({
        id: c.id,
        preview: c.text.replace(/\s+/g, ' ').slice(0, 120),
      })),
    }))
    .filter((d) => d.chunks.length > 0);

  const edges = graph.edges.map((e) => ({
    from: e.source,
    to: e.target,
    semantics: e.semantics ?? '',
  }));

  return {
    outputNodeId: outputNode?.id ?? 'out',
    outputTypeId: outputNode?.output?.typeId ?? 'scene.html',
    hint: outputNode?.output?.spec ?? '',
    models,
    images,
    docs,
    edges,
  };
}

/** 编出最终发给 Claude 的 prompt 文本。 */
export function buildClaudePrompt(prompt: PromptInput): { text: string; context: ClaudeContext } {
  const context = extractContext(prompt);
  const graph = prompt.graph;
  const edgeLines = graph.edges
    .map((e) => `  - ${e.source} → ${e.target}${e.semantics ? `：${e.semantics}` : ''}`)
    .join('\n');

  const text = [
    `你是 DSWeave 的场景编排 Agent。根据下面的工作流，产出一个 3D 沉浸式知识场景的 SceneSpec。`,
    ``,
    `工作流「${graph.name}」的连线意图：`,
    edgeLines || '  （无显式连线）',
    ``,
    `用户对输出（${context.outputTypeId}）的诉求：${context.hint || '（未指定，自行决定合理风格）'}`,
    ``,
    SCHEMA_DOC,
    ``,
    RULES,
    ``,
    `<DSWEAVE_CONTEXT>`,
    JSON.stringify(context),
    `</DSWEAVE_CONTEXT>`,
  ].join('\n');

  return { text, context };
}

/** 校验失败时的回灌追问。 */
export function buildRetryPrompt(error: string): string {
  return [
    `${SCENE_SPEC_FILENAME} 校验未通过：`,
    error,
    `请修正后重新写入 ${SCENE_SPEC_FILENAME}（保持符合 schema、引用真实的 nodeId/part/chunkId）。`,
  ].join('\n');
}
