import type { FlowGraph } from '@dsweave/core';

/** 从图确定性生成一个自包含 HTML 草稿（asset:// 引用 + 长文说明）。 */
export function buildHtml(graph: FlowGraph, hint: string): string {
  const models = graph.nodes.filter((n) => n.kind === 'source' && n.understanding?.model);
  const images = graph.nodes.filter((n) => n.kind === 'source' && n.file?.type === 'image');
  const semantics = graph.edges.map((e) => e.semantics).filter(Boolean).join('；');

  const viewers = models
    .map(
      (m) =>
        `<model-viewer src="asset://${m.id}" camera-controls auto-rotate style="width:100%;height:480px"></model-viewer>`,
    )
    .join('\n');
  const imgs = images
    .map((i) => `<img src="asset://${i.id}" style="max-width:100%" alt="${i.label ?? i.id}">`)
    .join('\n');

  const base = `本场景由 DSWeave 依据连线语义编排。${hint ? `输出诉求：${hint}。` : ''}${
    semantics ? `连线意图：${semantics}。` : ''
  }`;
  let body = base;
  while (body.length < 520) body += `该模型可旋转查看细节，配合说明文字帮助理解其结构与用途。`;

  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>${graph.name}</title>
<style>body{font-family:system-ui;max-width:880px;margin:40px auto;padding:0 16px;background:#0b0d12;color:#e7e9ee}</style>
</head><body>
<h1>${graph.name}</h1>
${viewers}
${imgs}
<section><p>${body}</p></section>
</body></html>`;
}
