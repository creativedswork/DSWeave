/**
 * scene.html 能力：把 Agent 产出的 SceneSpec + 资产 + 文档片段注入预构建 R3F Player bundle，
 * 导出自包含单文件 HTML 产物（内容寻址、可双击直接打开）。
 */
import { createHash } from 'node:crypto';
import { safeValidateSceneSpec, type SceneSpec } from '@dsweave/core';
import type { CapabilityInvokeResult, SceneHtmlInput } from '@dsweave/protocol';
import type { Capability, CapabilityInvocation, CapabilityRuntime } from './registry.js';
import { injectPlayer } from '../export/inject-player.js';

/** 注入到 Player 的文档片段（来源可追溯）。 */
export interface ChunkInfo {
  text: string;
  loc?: string;
  nodeId: string;
  label?: string;
}

function guessMime(path: string): string {
  const ext = path.toLowerCase().slice(path.lastIndexOf('.') + 1);
  switch (ext) {
    case 'gltf':
      return 'model/gltf+json';
    case 'glb':
      return 'model/gltf-binary';
    case 'bin':
      return 'application/octet-stream';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'ktx2':
      return 'image/ktx2';
    default:
      return 'application/octet-stream';
  }
}

function toDataUri(mime: string, bytes: Uint8Array): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString('base64')}`;
}

/** 收集 SceneSpec 各模型/图片引用的资产（gltf 根 + 依赖、图片）为 data URI。 */
function collectAssets(spec: SceneSpec, rt: CapabilityRuntime): Record<string, string> {
  const assets: Record<string, string> = {};
  for (const model of spec.models) {
    const stored = rt.understanding.getStoredFile(model.nodeId);
    if (!stored) continue;
    assets[model.assetRef] = toDataUri(stored.ref.mime || guessMime(model.assetRef), stored.bytes);
    for (const [path, bytes] of stored.assets) {
      assets[path] = toDataUri(guessMime(path), bytes);
    }
  }
  for (const image of spec.images ?? []) {
    const stored = rt.understanding.getStoredFile(image.nodeId);
    if (!stored) continue;
    assets[image.assetRef] = toDataUri(stored.ref.mime || guessMime(image.assetRef), stored.bytes);
  }
  return assets;
}

/** 收集 hotspots/panels 引用到的 chunk 文本。 */
function collectChunks(spec: SceneSpec, rt: CapabilityRuntime): Record<string, ChunkInfo> {
  const ids = new Set<string>();
  for (const h of spec.hotspots) for (const id of h.bodyChunkIds) ids.add(id);
  for (const p of spec.panels) for (const id of p.chunkIds) ids.add(id);
  const index = rt.understanding.chunkIndex();
  const out: Record<string, ChunkInfo> = {};
  for (const id of ids) if (index[id]) out[id] = index[id];
  return out;
}

export const sceneHtmlCapability: Capability = {
  id: 'scene.html',
  version: '1',
  async invoke(inv: CapabilityInvocation, rt: CapabilityRuntime): Promise<CapabilityInvokeResult> {
    const input = inv.input as SceneHtmlInput | undefined;
    const parsed = safeValidateSceneSpec(input?.spec);
    if (!parsed.success) {
      throw new Error(`SceneSpec 校验失败：${parsed.error.issues.map((i) => `${i.path.join('.')}:${i.message}`).join('；')}`);
    }
    const spec = parsed.data;

    const assets = collectAssets(spec, rt);
    const chunks = collectChunks(spec, rt);
    const template = rt.artifacts.playerTemplate();
    const html = injectPlayer(template, { spec, assets, chunks });
    const hash = createHash('sha256').update(html).digest('hex').slice(0, 16);

    if (rt.artifacts.has(hash)) {
      return { artifact: rt.artifacts.artifactFor(hash, 'index.html', 'text/html', inv.outputNodeId), cached: true };
    }
    const artifact = rt.artifacts.write(hash, 'index.html', html, 'text/html', inv.outputNodeId);
    return { artifact, cached: false };
  },
};
