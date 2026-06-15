/**
 * PDF provider：抽取正文 + 页数。
 *
 * 采用动态导入 `pdfjs-dist`（legacy 构建、禁用 worker）做文本抽取；
 * 该依赖较重（含 canvas），未安装时优雅降级为「元数据已就绪、正文待解析」，
 * 以保证构建/链路在任意环境下都不被阻断。安装后自动启用真实抽取。
 */
import type { FileRef, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

interface PdfTextItem {
  str?: string;
}

async function extractPdfText(
  bytes: Uint8Array,
): Promise<{ text: string; pages: number } | null> {
  try {
    // 动态导入（用变量 specifier 规避静态解析）：未安装则进入 catch 分支降级。
    const specifier = 'pdfjs-dist/legacy/build/pdf.mjs';
    const pdfjs = (await import(specifier)) as unknown as {
      getDocument(opts: { data: Uint8Array; useWorkerFetch?: boolean; isEvalSupported?: boolean }): {
        promise: Promise<{
          numPages: number;
          getPage(n: number): Promise<{ getTextContent(): Promise<{ items: PdfTextItem[] }> }>;
        }>;
      };
      GlobalWorkerOptions?: { workerSrc: string };
    };
    if (pdfjs.GlobalWorkerOptions) pdfjs.GlobalWorkerOptions.workerSrc = '';
    const doc = await pdfjs.getDocument({ data: bytes, isEvalSupported: false }).promise;
    const parts: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      parts.push(content.items.map((it) => it.str ?? '').join(' '));
    }
    return { text: parts.join('\n\n').replace(/[ \t]+/g, ' ').trim(), pages: doc.numPages };
  } catch {
    return null;
  }
}

export const pdfProvider: UnderstandingProvider = {
  type: 'pdf',
  version: '1',
  async understand(file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const extracted = await extractPdfText(io.bytes);
    if (!extracted) {
      return {
        metadata: {
          note: 'PDF 文本抽取未启用（缺少 pdfjs-dist）；已登记文件，安装依赖后可解析正文。',
          bytes: io.bytes.length,
          uri: file.uri,
        },
        ready: true,
      };
    }
    return {
      text: extracted.text,
      metadata: { pages: extracted.pages, chars: extracted.text.length },
      ready: true,
    };
  },
};
