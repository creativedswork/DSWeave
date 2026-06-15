/**
 * 分块：把正文按标题/段落切成带来源的 Chunk[]，支持引用追溯。
 *
 * 策略：
 * - 有 markdown 风格大纲时，按标题切段，loc = 标题路径；
 * - 否则按空行分段，loc = 段落序号；
 * - 过长的段再按字符上限二次切分（保持 loc 标注）。
 */
import { hashString, type Chunk } from '@dsweave/core';

export interface ChunkOptions {
  /** 单块字符上限（超出则二次切分）。 */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 800;

function chunkId(nodeId: string, seq: number, text: string): string {
  return `${nodeId}:c${seq}:${hashString(text).slice(0, 6)}`;
}

function splitLong(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text];
  const out: string[] = [];
  const sentences = text.split(/(?<=[。！？.!?])\s+/);
  let buf = '';
  for (const s of sentences) {
    if (buf.length + s.length > maxChars && buf.length > 0) {
      out.push(buf.trim());
      buf = '';
    }
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) out.push(s.slice(i, i + maxChars));
    } else {
      buf += (buf ? ' ' : '') + s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

interface Section {
  loc: string;
  text: string;
}

/** 按 markdown 标题把正文切成带 loc 的小节。 */
function sectionsByHeading(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let currentTitle = '前言';
  let buf: string[] = [];
  let inFence = false;
  const flush = () => {
    const body = buf.join('\n').trim();
    if (body) sections.push({ loc: currentTitle, text: body });
    buf = [];
  };
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const m = !inFence ? /^(#{1,6})\s+(.+?)\s*#*$/.exec(line) : null;
    if (m) {
      flush();
      currentTitle = (m[2] ?? '').trim() || currentTitle;
    } else {
      buf.push(line);
    }
  }
  flush();
  return sections;
}

/** 按空行把正文切成段落。 */
function paragraphs(text: string): Section[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p, i) => ({ loc: `¶${i + 1}`, text: p }));
}

/**
 * 把一个文件的正文切块。
 * @param nodeId 来源节点 id（写入 chunk.source）
 * @param text 正文
 * @param hasOutline 是否存在标题大纲（决定切分策略）
 */
export function chunkText(
  nodeId: string,
  text: string,
  hasOutline: boolean,
  opts: ChunkOptions = {},
): Chunk[] {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const trimmed = text.trim();
  if (!trimmed) return [];
  const sections = hasOutline ? sectionsByHeading(trimmed) : paragraphs(trimmed);
  const base = sections.length > 0 ? sections : [{ loc: '全文', text: trimmed }];
  const chunks: Chunk[] = [];
  let seq = 0;
  for (const section of base) {
    for (const piece of splitLong(section.text, maxChars)) {
      chunks.push({
        id: chunkId(nodeId, seq++, piece),
        text: piece,
        source: { nodeId, loc: section.loc },
      });
    }
  }
  return chunks;
}
