/**
 * HTML provider：去噪抽取正文 + 标题层级。
 *
 * M3 采用轻量、零依赖的抽取（移除脚本/样式/标签、解码实体），结构化在 provider 接口之后，
 * 后续可平滑替换为 @mozilla/readability + jsdom 而不影响上层。
 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

export function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&[a-z]+;|&#39;/gi, (m) => ENTITIES[m.toLowerCase()] ?? m);
}

function stripNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<head[\s\S]*?<\/head>/gi, ' ');
}

export function htmlTitle(html: string): string | undefined {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m && m[1] != null ? decodeEntities(m[1].trim()) : undefined;
}

export function htmlOutline(html: string): { level: number; title: string }[] {
  const outline: { level: number; title: string }[] = [];
  const re = /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const title = decodeEntities((m[2] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
    if (title) outline.push({ level: Number(m[1] ?? '1'), title });
  }
  return outline;
}

export function htmlToText(html: string): string {
  return decodeEntities(
    stripNoise(html)
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((l) => l.trim())
    .join('\n')
    .trim();
}

export const htmlProvider: UnderstandingProvider = {
  type: 'html',
  version: '1',
  async understand(_file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const html = io.text();
    const title = htmlTitle(html);
    const outline = htmlOutline(html);
    const text = htmlToText(html);
    return {
      text,
      outline: outline.length > 0 ? outline : undefined,
      metadata: { title, chars: text.length },
      ready: true,
    };
  },
};
