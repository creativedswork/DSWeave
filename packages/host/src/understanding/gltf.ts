/**
 * glTF provider：解析 glTF JSON（.gltf）/ 二进制容器（.glb）的结构元数据。
 *
 * 产出 ModelMeta（部件/材质/动画/包围盒）供 Agent 把文档绑定到具体部件做 3D 热点，
 * 并据元数据合成一段「外观」caption，让 Agent 无需离屏渲染也能描述模型概貌。
 *
 * 说明：离屏多角度渲染（renders）依赖 headless-gl / puppeteer，环境相关且较重，
 * M3 先以结构元数据 + 合成 caption 支撑「描述外观与部件名」，renders 留待后置。
 */
import type { FileRef, ModelMeta, Understanding } from '@dsweave/core';
import type { UnderstandIO, UnderstandingProvider } from './registry.js';

interface GltfAccessor {
  min?: number[];
  max?: number[];
}
interface GltfPrimitive {
  attributes?: Record<string, number>;
}
interface GltfMesh {
  name?: string;
  primitives?: GltfPrimitive[];
}
interface GltfNode {
  name?: string;
  mesh?: number;
}
interface GltfJson {
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  materials?: { name?: string }[];
  animations?: { name?: string }[];
  accessors?: GltfAccessor[];
}

const GLB_MAGIC = 0x46546c67; // 'glTF' 小端
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** 从 .glb 二进制容器中提取 JSON chunk 文本。 */
export function extractGlbJson(bytes: Uint8Array): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== GLB_MAGIC) throw new Error('不是有效的 .glb（magic 不匹配）');
  const total = view.getUint32(8, true);
  let offset = 12;
  while (offset < total) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const start = offset + 8;
    if (chunkType === CHUNK_JSON) {
      return new TextDecoder().decode(bytes.subarray(start, start + chunkLen));
    }
    offset = start + chunkLen;
  }
  throw new Error('.glb 中未找到 JSON chunk');
}

function computeBbox(gltf: GltfJson): ModelMeta['bbox'] {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let found = false;
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      const posIdx = prim.attributes?.POSITION;
      if (posIdx == null) continue;
      const acc = gltf.accessors?.[posIdx];
      if (!acc?.min || !acc?.max) continue;
      found = true;
      const amin = acc.min;
      const amax = acc.max;
      min[0] = Math.min(min[0], amin[0] ?? min[0]);
      min[1] = Math.min(min[1], amin[1] ?? min[1]);
      min[2] = Math.min(min[2], amin[2] ?? min[2]);
      max[0] = Math.max(max[0], amax[0] ?? max[0]);
      max[1] = Math.max(max[1], amax[1] ?? max[1]);
      max[2] = Math.max(max[2], amax[2] ?? max[2]);
    }
  }
  return found ? { min, max } : undefined;
}

function partNames(gltf: GltfJson): { name: string; meshIndex?: number }[] {
  const parts: { name: string; meshIndex?: number }[] = [];
  (gltf.nodes ?? []).forEach((node, i) => {
    if (node.mesh == null && !node.name) return;
    const meshName = node.mesh != null ? gltf.meshes?.[node.mesh]?.name : undefined;
    const name = node.name ?? meshName ?? `node_${i}`;
    parts.push({ name, meshIndex: node.mesh });
  });
  // 若没有任何带名节点，退化为 mesh 名。
  if (parts.length === 0) {
    (gltf.meshes ?? []).forEach((m, i) => parts.push({ name: m.name ?? `mesh_${i}`, meshIndex: i }));
  }
  return parts;
}

function analyze(gltf: GltfJson): ModelMeta {
  return {
    nodes: partNames(gltf),
    materials: (gltf.materials ?? []).map((m, i) => m.name ?? `material_${i}`),
    animations: (gltf.animations ?? []).map((a, i) => a.name ?? `animation_${i}`),
    bbox: computeBbox(gltf),
  };
}

function appearanceCaption(model: ModelMeta): string {
  const parts = model.nodes ?? [];
  const sizeNote = model.bbox
    ? `包围盒尺寸约 ${model.bbox.max
        .map((v, i) => (v - (model.bbox!.min[i] ?? 0)).toFixed(2))
        .join(' × ')}`
    : '包围盒未知';
  const partList = parts
    .slice(0, 12)
    .map((p) => p.name)
    .join('、');
  return [
    `模型包含 ${parts.length} 个部件${parts.length > 12 ? '（前 12 个）' : ''}：${partList}。`,
    `${(model.materials ?? []).length} 种材质，${(model.animations ?? []).length} 段动画。`,
    `${sizeNote}。`,
  ].join(' ');
}

export const gltfProvider: UnderstandingProvider = {
  type: 'gltf',
  version: '1',
  async understand(file: FileRef, io: UnderstandIO): Promise<Understanding> {
    const isGlb =
      file.uri.toLowerCase().endsWith('.glb') ||
      file.mime.includes('gltf-binary') ||
      (io.bytes.length >= 4 &&
        new DataView(io.bytes.buffer, io.bytes.byteOffset, 4).getUint32(0, true) === GLB_MAGIC);

    let gltf: GltfJson;
    try {
      const json = isGlb ? extractGlbJson(io.bytes) : io.text();
      gltf = JSON.parse(json) as GltfJson;
    } catch (err) {
      return {
        captions: [],
        model: {},
        metadata: { error: `glTF 解析失败：${err instanceof Error ? err.message : String(err)}` },
        ready: true,
      };
    }

    const model = analyze(gltf);
    const caption = appearanceCaption(model);
    return {
      model,
      captions: [caption],
      renders: [],
      metadata: {
        container: isGlb ? 'glb' : 'gltf',
        parts: model.nodes?.length ?? 0,
        materials: model.materials?.length ?? 0,
        animations: model.animations?.length ?? 0,
      },
      ready: true,
    };
  },
};
