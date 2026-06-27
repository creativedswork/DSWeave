/**
 * Agent 侧纯文本校验：在 Agent 回灌重试循环里跑（不依赖 Host 资产服务）。
 * 失败项会拼成回灌追问，触发 Agent 重写 index.html。
 */

const ASSET_RE = /asset:\/\/([A-Za-z0-9_-]+)/g;
const EXTERNAL_SCRIPT_RE = /<script[^>]+\bsrc\s*=\s*["']https?:/i;
const EXTERNAL_LINK_RE = /<link[^>]+\bhref\s*=\s*["']https?:/i;

/** 返回错误列表（空数组=通过）。knownNodeIds 来自 prompt 上下文里的真实节点。 */
export function validateHtml(html: string, knownNodeIds: Set<string>): string[] {
  const errors: string[] = [];

  if (!html || html.trim().length === 0) {
    errors.push('产物为空：必须写出非空的 index.html。');
    return errors;
  }

  for (const m of html.matchAll(ASSET_RE)) {
    const id = m[1]!;
    if (!knownNodeIds.has(id)) {
      errors.push(`asset://${id} 指向未知节点；只能引用上下文里列出的 nodeId。`);
    }
  }

  if (EXTERNAL_SCRIPT_RE.test(html)) {
    errors.push('禁止外链脚本（<script src="http...">）：产物必须离线自包含。');
  }
  if (EXTERNAL_LINK_RE.test(html)) {
    errors.push('禁止外链样式（<link href="http...">）：产物必须离线自包含。');
  }

  // 去重（同一 nodeId 多处引用只报一次）
  return [...new Set(errors)];
}
