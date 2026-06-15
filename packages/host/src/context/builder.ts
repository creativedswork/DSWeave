/**
 * ContextBuilder：依据图（边语义 + 输出目标）选取喂给 Agent 的上下文。
 *
 * MVP 默认全量（full）；当分块总量超出预算时退化为检索式选片（topk），
 * 用「边语义 + 输出软细节」作为查询做关键词相关性打分（预留向量检索的位置）。
 */
import type { Chunk, FlowGraph, Understanding } from '@dsweave/core';
import type { PromptContext, PromptContextFile } from '@dsweave/protocol';

export interface ContextBuildOptions {
  /** token 预算（约 4 字符/token 估算）。 */
  maxTokens?: number;
}

const DEFAULT_MAX_TOKENS = 8000;
const CHARS_PER_TOKEN = 4;

function estimateChars(files: PromptContextFile[]): number {
  let total = 0;
  for (const f of files) {
    total += (f.summary ?? '').length;
    for (const c of f.chunks) total += c.text.length;
  }
  return total;
}

/** 把查询文本切成关键词（中英混合，长度≥2）。 */
function terms(query: string): string[] {
  const out = new Set<string>();
  for (const w of query.toLowerCase().match(/[a-z0-9]+/g) ?? []) if (w.length >= 2) out.add(w);
  for (const ch of query.match(/[\u4e00-\u9fff]/g) ?? []) out.add(ch);
  return [...out];
}

function score(chunk: Chunk, queryTerms: string[]): number {
  if (queryTerms.length === 0) return 0;
  const text = chunk.text.toLowerCase();
  let s = 0;
  for (const t of queryTerms) {
    let idx = text.indexOf(t);
    while (idx !== -1) {
      s++;
      idx = text.indexOf(t, idx + t.length);
    }
  }
  return s;
}

/** 构造检索查询：所有边语义 + 输出软细节。 */
function buildQuery(graph: FlowGraph): string {
  const parts: string[] = [];
  for (const e of graph.edges) if (e.semantics) parts.push(e.semantics);
  for (const n of graph.nodes) if (n.kind === 'output' && n.output?.spec) parts.push(n.output.spec);
  return parts.join(' ');
}

/** 依据图与各节点理解，构建喂给 Agent 的上下文。 */
export function buildContext(
  graph: FlowGraph,
  understandings: Map<string, Understanding>,
  opts: ContextBuildOptions = {},
): PromptContext {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const budgetChars = maxTokens * CHARS_PER_TOKEN;

  const files: PromptContextFile[] = [];
  for (const node of graph.nodes) {
    if (node.kind !== 'source') continue;
    const u = understandings.get(node.id);
    if (!u) continue;
    files.push({
      nodeId: node.id,
      label: node.label,
      summary: u.summary,
      chunks: u.chunks ?? [],
    });
  }

  // 预算内 → 全量。
  if (estimateChars(files) <= budgetChars) {
    return { retrieval: 'full', files };
  }

  // 超预算 → 检索式选片：保留每文件首块，其余按相关性全局选取。
  const queryTerms = terms(buildQuery(graph));
  const kept = new Map<string, Chunk[]>();
  const pool: { nodeId: string; chunk: Chunk; score: number }[] = [];
  for (const f of files) {
    const first = f.chunks[0];
    kept.set(f.nodeId, first ? [first] : []);
    for (const c of f.chunks.slice(1)) {
      pool.push({ nodeId: f.nodeId, chunk: c, score: score(c, queryTerms) });
    }
  }
  pool.sort((a, b) => b.score - a.score);

  let used = files.reduce(
    (acc, f) => acc + (f.summary ?? '').length + (kept.get(f.nodeId)?.[0]?.text.length ?? 0),
    0,
  );
  for (const item of pool) {
    if (used + item.chunk.text.length > budgetChars) continue;
    kept.get(item.nodeId)?.push(item.chunk);
    used += item.chunk.text.length;
  }

  const topkFiles: PromptContextFile[] = files.map((f) => ({
    ...f,
    chunks: (kept.get(f.nodeId) ?? []).sort(
      (a, b) => f.chunks.indexOf(a) - f.chunks.indexOf(b),
    ),
  }));
  return { retrieval: 'topk', files: topkFiles };
}
