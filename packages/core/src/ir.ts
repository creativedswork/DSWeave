import type { FlowEdge, FlowGraph, FlowNode } from './model.js';

/** 运行时字段，序列化为 IR 时剥离（只存结构，不存执行态/理解/预览）。 */
const NODE_RUNTIME_KEYS = ['preview', 'understanding', 'status'] as const;
const EDGE_RUNTIME_KEYS = ['status'] as const;

function stripNodeRuntime(node: FlowNode): FlowNode {
  const clone = { ...node };
  for (const key of NODE_RUNTIME_KEYS) delete clone[key];
  return clone;
}

function stripEdgeRuntime(edge: FlowEdge): FlowEdge {
  const clone = { ...edge };
  for (const key of EDGE_RUNTIME_KEYS) delete clone[key];
  return clone;
}

/** 返回剥离运行时字段后的图，用于持久化与发送给 Agent。 */
export function stripRuntime(graph: FlowGraph): FlowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(stripNodeRuntime),
    edges: graph.edges.map(stripEdgeRuntime),
  };
}

/** 确定性 JSON 序列化（键排序），用于哈希与缓存键。 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = sortValue(obj[key]);
    return sorted;
  }
  return value;
}

/**
 * 轻量内容哈希（FNV-1a，32 位，hex）。浏览器/Node 通用、零依赖。
 * 用于 M0/M1 的缓存键与节点指纹；如需抗碰撞可在 Host 侧换 sha256。
 */
export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** 对节点的稳定内容求指纹（基于其结构，不含运行时字段）。 */
export function hashNode(node: FlowNode): string {
  return hashString(stableStringify(stripNodeRuntimeForHash(node)));
}

function stripNodeRuntimeForHash(node: FlowNode): Partial<FlowNode> {
  const clone = { ...node };
  for (const key of NODE_RUNTIME_KEYS) delete clone[key];
  return clone;
}

/** 序列化为 .flow.json 字符串（已剥离运行时字段）。 */
export function serialize(graph: FlowGraph): string {
  return JSON.stringify(stripRuntime(graph), null, 2);
}

/** 反序列化（不校验；如需校验请用 schema.validateFlow）。 */
export function deserialize(json: string): FlowGraph {
  return JSON.parse(json) as FlowGraph;
}
