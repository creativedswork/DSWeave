/**
 * scene.html 能力：把 Agent 写的自由 HTML 转成自包含单文件产物。
 * 注入 model-viewer 运行时 + 把 asset://{nodeId} 内联为 data URI + content-address 落盘。
 */
import { createHash } from 'node:crypto';
import type { CapabilityInvokeResult, HtmlPageInput } from '@dsweave/protocol';
import type { Capability, CapabilityInvocation, CapabilityRuntime } from './registry.js';
import { inlineAssets, injectViewerRuntime, type ResolvedAsset } from '../export/inline-html.js';
import { getModelViewerScript } from '../export/model-viewer-runtime.js';

function guessMimeFromPath(path: string): string {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.') + 1);
  switch (ext) {
    case 'glb':
      return 'model/gltf-binary';
    case 'gltf':
      return 'model/gltf+json';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

export const sceneHtmlCapability: Capability = {
  id: 'scene.html',
  version: '2',
  async invoke(inv: CapabilityInvocation, rt: CapabilityRuntime): Promise<CapabilityInvokeResult> {
    const input = inv.input as HtmlPageInput | undefined;
    const raw = input?.html;
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new Error('scene.html 输入为空：需要非空的 HTML 字符串');
    }

    const withRuntime = injectViewerRuntime(raw, getModelViewerScript());
    const { html, missing } = inlineAssets(withRuntime, (nodeId): ResolvedAsset | undefined => {
      const stored = rt.understanding.getStoredFile(nodeId);
      if (!stored) return undefined;
      return { mime: stored.ref.mime || guessMimeFromPath(stored.ref.uri), bytes: stored.bytes };
    });
    if (missing.length) {
      throw new Error(`无法解析资产引用：${missing.join(', ')}`);
    }

    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);
    if (rt.artifacts.has(hash)) {
      return {
        artifact: rt.artifacts.artifactFor(hash, 'index.html', 'text/html', inv.outputNodeId),
        cached: true,
      };
    }
    const artifact = rt.artifacts.write(hash, 'index.html', html, 'text/html', inv.outputNodeId);
    return { artifact, cached: false };
  },
};
