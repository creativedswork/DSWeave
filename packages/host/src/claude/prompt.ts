/**
 * 把内部 PromptInput（图 + 理解 + 上下文 + 输出）编成给编码 Agent 的一段 ACP prompt 文本。
 *
 * 约束 Agent 的唯一交付物：把一个自包含的 HTML 写到 `<cwd>/index.html`——用 asset://{nodeId}
 * 引用源文件、用 <model-viewer> 预览模型（运行时与资产字节由 Host 注入/内联）。文本里同时附一段
 * 机器可读的 <DSWEAVE_CONTEXT> JSON，列出可引用的 nodeId 与文档真实文本。
 */
import type { PromptInput } from '@dsweave/protocol';

export const OUTPUT_FILENAME = 'index.html';

/** 机器可读上下文（同时供真实模型与测试用的假 adapter 消费）。 */
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

/** 从 PromptInput 抽取机器可读上下文。 */
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

/** 编出最终发给编码 Agent 的 prompt 文本。 */
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

/** 校验失败时的回灌追问。 */
export function buildRetryPrompt(errors: string): string {
  return [
    `${OUTPUT_FILENAME} 未通过校验：`,
    errors,
    `请修正后重新写入 ${OUTPUT_FILENAME}（保持自包含、无外链、asset:// 只引用上下文里的 nodeId）。`,
  ].join('\n');
}
