/**
 * 启发式 SceneSpec 生成器（M4a，无 LLM）。
 *
 * 基于图结构 + Host 注入的 understanding 直接产出合法 SceneSpec：
 *  - gltf 源 → 场景模型；
 *  - 文档分块（按 outline/来源 loc）→ 绑定到模型部件的热点 + 侧栏面板；
 *  - 输出软细节里的主题关键词 → 配色。
 * 约束：只产出 SceneSpec（数据），不写运行时代码。
 */
import type {
  FlowGraph,
  FlowNode,
  SceneHotspot,
  SceneImage,
  SceneModel,
  ScenePanel,
  SceneSpec,
  SceneTheme,
} from '@dsweave/core';

const DOC_TYPES = new Set(['md', 'pdf', 'txt', 'html']);
const MAX_HOTSPOTS = 8;

function resolveTheme(spec: string): SceneTheme {
  const s = spec.toLowerCase();
  if (/(light|亮|浅|白)/.test(s)) return { palette: 'light', style: 'minimal' };
  if (/(warm|暖|琥珀|amber)/.test(s)) return { palette: 'warm', style: 'minimal' };
  return { palette: 'dark-tech', style: 'minimal' };
}

/** 从图 + understanding 构建一个合法 SceneSpec。 */
export function buildSceneSpec(graph: FlowGraph, outputSpec: string): SceneSpec {
  const sources = graph.nodes.filter((n) => n.kind === 'source');
  const gltfNodes = sources.filter((n) => n.file?.type === 'gltf');
  const docNodes = sources.filter((n) => n.file && DOC_TYPES.has(n.file.type));
  const dataNodes = sources.filter((n) => n.file?.type === 'data');

  const imageNodes = sources.filter((n) => n.file?.type === 'image');

  const models: SceneModel[] = gltfNodes.map((n) => ({
    nodeId: n.id,
    assetRef: n.file?.uri ?? n.id,
    autoRotate: true,
  }));

  const images: SceneImage[] = imageNodes.map((n) => ({
    nodeId: n.id,
    assetRef: n.file?.uri ?? n.id,
    label: n.label ?? n.file?.uri,
  }));

  const primaryModel = models[0];
  const parts = primaryModel
    ? (gltfNodes[0]?.understanding?.model?.nodes ?? []).map((p) => p.name)
    : [];

  const hotspots: SceneHotspot[] = [];
  if (primaryModel) {
    const items = collectDocItems(docNodes);
    for (let i = 0; i < items.length && hotspots.length < MAX_HOTSPOTS; i++) {
      const item = items[i]!;
      const part = parts.length > 0 ? parts[i % parts.length]! : item.title;
      hotspots.push({
        modelNodeId: primaryModel.nodeId,
        part,
        title: item.title,
        bodyChunkIds: item.chunkIds,
      });
    }
  }

  const panels: ScenePanel[] = [];
  for (const n of [...docNodes, ...dataNodes]) {
    const chunkIds = (n.understanding?.chunks ?? []).map((c) => c.id);
    if (chunkIds.length === 0 && !n.understanding?.summary) continue;
    panels.push({ title: n.label ?? n.file?.uri ?? n.id, chunkIds });
  }
  if (panels.length === 0) {
    panels.push({ title: graph.name, chunkIds: [] });
  }

  return {
    version: 1,
    theme: resolveTheme(outputSpec),
    layout: models.length + images.length > 1 ? 'gallery' : 'single-focus',
    models,
    images,
    hotspots,
    panels,
    connectors: [],
    citations: true,
  };
}

interface DocItem {
  title: string;
  chunkIds: string[];
}

/** 把文档节点的分块按「来源小节」聚合成热点候选项。 */
function collectDocItems(docNodes: FlowNode[]): DocItem[] {
  const items: DocItem[] = [];
  for (const n of docNodes) {
    const chunks = n.understanding?.chunks ?? [];
    // 按 source.loc（小节）聚合；无 loc 时每块独立成项。
    const byLoc = new Map<string, string[]>();
    for (const c of chunks) {
      const key = c.source.loc ?? c.id;
      const arr = byLoc.get(key) ?? [];
      arr.push(c.id);
      byLoc.set(key, arr);
    }
    for (const [loc, ids] of byLoc) {
      items.push({ title: loc, chunkIds: ids });
    }
  }
  return items;
}
