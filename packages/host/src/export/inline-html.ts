/**
 * 把 Agent 写的自由 HTML 转成自包含产物：
 * - injectViewerRuntime：内联 model-viewer 运行时，保证 <model-viewer> 离线可用。
 * - inlineAssets：把 asset://{nodeId} 占位替换为内联 data: URI（Agent 物理上无法吐二进制）。
 */

export interface ResolvedAsset {
  mime: string;
  bytes: Uint8Array;
}

/** nodeId → 资产字节；未登记返回 undefined。 */
export type AssetResolver = (nodeId: string) => ResolvedAsset | undefined;

const ASSET_RE = /asset:\/\/([A-Za-z0-9_-]+)/g;

function toDataUri(a: ResolvedAsset): string {
  return `data:${a.mime};base64,${Buffer.from(a.bytes).toString('base64')}`;
}

/** 替换所有 asset://{nodeId}；返回新 HTML 与无法解析的 nodeId 列表（去重）。 */
export function inlineAssets(
  html: string,
  resolve: AssetResolver,
): { html: string; missing: string[] } {
  const cache = new Map<string, string | null>();
  const missing = new Set<string>();
  const out = html.replace(ASSET_RE, (whole, nodeId: string) => {
    let uri = cache.get(nodeId);
    if (uri === undefined) {
      const asset = resolve(nodeId);
      uri = asset ? toDataUri(asset) : null;
      cache.set(nodeId, uri);
    }
    if (uri === null) {
      missing.add(nodeId);
      return whole;
    }
    return uri;
  });
  return { html: out, missing: [...missing] };
}

/** 把运行时脚本注入到 <head>（缺省退化到 <body> 前或开头）。 */
export function injectViewerRuntime(html: string, runtime: string): string {
  const safe = runtime.replace(/<\/script>/gi, '<\\/script>');
  const tag = `<script>${safe}</script>`;
  const headEnd = html.indexOf('</head>');
  if (headEnd !== -1) return html.slice(0, headEnd) + tag + html.slice(headEnd);
  const bodyStart = html.indexOf('<body');
  if (bodyStart !== -1) return html.slice(0, bodyStart) + tag + html.slice(bodyStart);
  return tag + html;
}
