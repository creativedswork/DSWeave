/** Markdown / 纯文本 provider：正文 + 标题层级大纲。 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

const HEADING = /^(#{1,6})\s+(.+?)\s*#*$/;

/** 从 markdown 提取标题层级大纲。 */
export function markdownOutline(text: string): { level: number; title: string }[] {
  const outline: { level: number; title: string }[] = [];
  let inFence = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING.exec(line);
    if (m && m[1] && m[2]) outline.push({ level: m[1].length, title: m[2].trim() });
  }
  return outline;
}

export const mdProvider: UnderstandingProvider = {
  type: 'md',
  version: '1',
  async understand(_file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const text = io.text();
    const outline = markdownOutline(text);
    return {
      text,
      outline: outline.length > 0 ? outline : undefined,
      metadata: { chars: text.length, headings: outline.length },
      ready: true,
    };
  },
};
