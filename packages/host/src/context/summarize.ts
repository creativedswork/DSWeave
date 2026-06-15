/**
 * 摘要：对正文做抽取式层级摘要（零依赖、确定性）。
 *
 * 不引入 LLM：取每个小节的首句拼成全局概览，给 Agent「先看全局」。
 * 真实语义摘要可在接入模型后替换，接口不变。
 */
import type { Chunk } from '@dsweave/core';

const MAX_SUMMARY_CHARS = 600;

function firstSentence(text: string): string {
  const m = /^[\s\S]*?[。！？.!?](\s|$)/.exec(text);
  const s = (m ? m[0] : text).trim();
  return s.length > 160 ? `${s.slice(0, 157)}…` : s;
}

/** 基于分块生成抽取式摘要：取各块首句，按 loc 归并，截断到上限。 */
export function summarizeChunks(chunks: Chunk[]): string | undefined {
  if (chunks.length === 0) return undefined;
  const seenLoc = new Set<string>();
  const lines: string[] = [];
  for (const c of chunks) {
    const loc = c.source.loc ?? '';
    // 每个小节只取一条首句，避免冗余。
    if (loc && seenLoc.has(loc)) continue;
    if (loc) seenLoc.add(loc);
    const sentence = firstSentence(c.text);
    if (!sentence) continue;
    lines.push(loc && loc !== '全文' ? `${loc}：${sentence}` : sentence);
    if (lines.join(' ').length > MAX_SUMMARY_CHARS) break;
  }
  const summary = lines.join(' ');
  return summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary;
}
