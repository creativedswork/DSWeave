/**
 * 把 SceneSpec + 资产 + 文档片段注入预构建 Player 单文件 HTML。
 *
 * 关键：在 Player 的模块脚本执行前，先插入一段定义 `window.__DSWEAVE_*__` 的脚本，
 * 让运行时读取注入契约。「会出错的代码」在构建期已固化，产物保证可运行。
 */
import type { SceneSpec } from '@dsweave/core';
import type { ChunkInfo } from '../understanding-service.js';

export interface PlayerPayload {
  spec: SceneSpec;
  /** assetRef / gltf 依赖路径 → data URI。 */
  assets: Record<string, string>;
  /** chunkId → 文档片段。 */
  chunks: Record<string, ChunkInfo>;
}

/** 安全序列化为可内联进 <script> 的 JSON（转义 </script> 与 HTML 注释起始）。 */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 把注入脚本插入到 Player 模板的首个 <script> 前。 */
export function injectPlayer(template: string, payload: PlayerPayload): string {
  const dataScript =
    `<script id="dsweave-data">` +
    `window.__DSWEAVE_SCENE__=${safeJson(payload.spec)};` +
    `window.__DSWEAVE_ASSETS__=${safeJson(payload.assets)};` +
    `window.__DSWEAVE_CHUNKS__=${safeJson(payload.chunks)};` +
    `</script>`;

  const idx = template.indexOf('<script');
  if (idx === -1) {
    // 无脚本（异常模板）：退化为追加到 </body> 前。
    const bodyEnd = template.lastIndexOf('</body>');
    if (bodyEnd === -1) return template + dataScript;
    return template.slice(0, bodyEnd) + dataScript + template.slice(bodyEnd);
  }
  return template.slice(0, idx) + dataScript + '\n' + template.slice(idx);
}
