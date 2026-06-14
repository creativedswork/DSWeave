import type { FileAsset } from '@dsweave/core';

/** 带相对路径的待摄入文件（来自文件夹拖放或 webkitdirectory）。 */
export interface IngestedFile {
  file: File;
  /** 相对根的路径，使用 `/` 分隔，含顶层目录名（与 webkitRelativePath 对齐）。 */
  path: string;
}

/** 规范化路径：去掉 `./`、解析 `../`、统一分隔符。 */
export function normalizePath(p: string): string {
  const parts: string[] = [];
  for (const seg of p.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function joinPath(dir: string, rel: string): string {
  return normalizePath(dir ? `${dir}/${rel}` : rel);
}

interface GltfUriRef {
  uri: string;
  role: 'buffer' | 'image';
}

/** 从 glTF JSON 中收集外部引用 uri（跳过 data: 与缺省）。 */
export function collectGltfUris(gltf: unknown): GltfUriRef[] {
  const refs: GltfUriRef[] = [];
  const doc = gltf as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  for (const b of doc.buffers ?? []) {
    if (b.uri && !b.uri.startsWith('data:')) refs.push({ uri: b.uri, role: 'buffer' });
  }
  for (const im of doc.images ?? []) {
    if (im.uri && !im.uri.startsWith('data:')) refs.push({ uri: im.uri, role: 'image' });
  }
  return refs;
}

export interface GltfBundle {
  /** 改写依赖为 blob: 后、可直接喂给 model-viewer 的 src。 */
  srcUrl: string;
  /** 依赖清单（持久化用，路径为相对根文件目录）。 */
  assets: FileAsset[];
  /** 运行时创建的所有 blob URL（含 src 与各依赖），用于回收。 */
  objectUrls: string[];
  /** 未能在文件集合中找到的依赖 uri（用于提示）。 */
  missing: string[];
  /** 依赖总字节（不含根文件）。 */
  assetBytes: number;
}

/**
 * 构建一个 .gltf 资源包：
 * 1. 解析 gltf JSON，找出 .bin/纹理等外部引用；
 * 2. 在文件集合中按相对路径匹配，逐个建 blob URL；
 * 3. 把 gltf 内的相对 uri 改写为绝对 blob: URL；
 * 4. 对改写后的 JSON 建 blob 作为 src。
 *
 * 这样 model-viewer 不再依赖相对路径解析（blob: 无目录语义）。
 */
export async function buildGltfBundle(
  root: IngestedFile,
  all: IngestedFile[],
): Promise<GltfBundle> {
  const text = await root.file.text();
  const gltf = JSON.parse(text) as Record<string, unknown>;
  const rootDir = dirname(root.path);

  const byPath = new Map(all.map((f) => [normalizePath(f.path), f]));
  const refs = collectGltfUris(gltf);

  const objectUrls: string[] = [];
  const assets: FileAsset[] = [];
  const missing: string[] = [];
  let assetBytes = 0;

  // uri（原样，未 decode）→ blob URL，用于改写 JSON。
  const uriToBlob = new Map<string, string>();

  for (const ref of refs) {
    const decoded = decodeURIComponent(ref.uri);
    const targetPath = joinPath(rootDir, decoded);
    const match = byPath.get(targetPath);
    if (!match) {
      missing.push(ref.uri);
      continue;
    }
    const url = URL.createObjectURL(match.file);
    objectUrls.push(url);
    uriToBlob.set(ref.uri, url);
    assetBytes += match.file.size;
    assets.push({
      path: decoded,
      mime: match.file.type || undefined,
      size: match.file.size,
      role: ref.role,
    });
  }

  rewriteGltfUris(gltf, uriToBlob);

  const patched = new Blob([JSON.stringify(gltf)], { type: 'model/gltf+json' });
  const srcUrl = URL.createObjectURL(patched);
  objectUrls.push(srcUrl);

  return { srcUrl, assets, objectUrls, missing, assetBytes };
}

function rewriteGltfUris(gltf: Record<string, unknown>, map: Map<string, string>): void {
  const doc = gltf as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
  for (const b of doc.buffers ?? []) {
    if (b.uri && map.has(b.uri)) b.uri = map.get(b.uri);
  }
  for (const im of doc.images ?? []) {
    if (im.uri && map.has(im.uri)) im.uri = map.get(im.uri);
  }
}
