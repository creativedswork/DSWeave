import type { FileRef, FileType } from '@dsweave/core';
import { buildGltfBundle, normalizePath, type IngestedFile } from './gltf';

const EXT_TYPE: Record<string, FileType> = {
  gltf: 'gltf',
  glb: 'gltf',
  md: 'md',
  markdown: 'md',
  mdx: 'md',
  pdf: 'pdf',
  txt: 'txt',
  text: 'txt',
  log: 'txt',
  html: 'html',
  htm: 'html',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  csv: 'data',
  json: 'data',
  tsv: 'data',
};

const TEXT_TYPES: FileType[] = ['md', 'txt', 'html', 'data'];

function ext(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? '';
}

export function detectFileType(name: string, mime: string): FileType {
  const e = ext(name);
  if (EXT_TYPE[e]) return EXT_TYPE[e];
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime === 'text/html') return 'html';
  if (mime === 'text/markdown') return 'md';
  if (mime === 'application/json' || mime === 'text/csv') return 'data';
  if (mime.startsWith('text/')) return 'txt';
  if (mime.includes('gltf')) return 'gltf';
  return 'unknown';
}

export function isTextType(type: FileType): boolean {
  return TEXT_TYPES.includes(type);
}

/** 一个待创建的 source 节点的完整数据。 */
export interface SourceSpec {
  label: string;
  file: FileRef;
  /** 运行时预览 blob URL（刷新失效）。 */
  previewUrl?: string;
  /** 文本类预览内容。 */
  previewText?: string;
  /** 本节点创建的所有 blob URL，用于回收。 */
  objectUrls: string[];
  /** 摄入告警（如 gltf 缺失依赖）。 */
  warning?: string;
}

// ---------- 来源采集：把拖放/选择转成带相对路径的文件列表 ----------

async function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  const out: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      reader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: IngestedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await entryFile(entry as FileSystemFileEntry);
    out.push({ file, path: `${prefix}${file.name}` });
  } else if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    const entries = await readAllEntries(reader);
    for (const child of entries) await walkEntry(child, `${prefix}${entry.name}/`, out);
  }
}

/** 从拖放事件采集文件（支持文件夹递归）。 */
export async function collectFromDataTransfer(dt: DataTransfer): Promise<IngestedFile[]> {
  const items = Array.from(dt.items).filter((it) => it.kind === 'file');
  const entries = items
    .map((it) => (it.webkitGetAsEntry ? it.webkitGetAsEntry() : null))
    .filter((e): e is FileSystemEntry => e != null);

  if (entries.length > 0) {
    const out: IngestedFile[] = [];
    for (const entry of entries) await walkEntry(entry, '', out);
    return out;
  }
  // 退化：不支持 entry API，按平铺文件处理。
  return Array.from(dt.files).map((file) => ({ file, path: file.name }));
}

/** 从 input.files 采集（webkitdirectory 时带相对路径）。 */
export function collectFromFileList(files: FileList): IngestedFile[] {
  return Array.from(files).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    return { file, path: rel && rel.length > 0 ? rel : file.name };
  });
}

// ---------- 摄入：把文件列表整理成 source 节点规格 ----------

async function readPreviewText(file: File): Promise<string | undefined> {
  try {
    return await file.text();
  } catch {
    return undefined;
  }
}

async function docSpec(item: IngestedFile): Promise<SourceSpec> {
  const type = detectFileType(item.file.name, item.file.type);
  const previewUrl = URL.createObjectURL(item.file);
  const file: FileRef = {
    uri: item.path,
    mime: item.file.type || 'application/octet-stream',
    type,
    size: item.file.size,
  };
  const previewText = isTextType(type) ? await readPreviewText(item.file) : undefined;
  return { label: item.file.name, file, previewUrl, previewText, objectUrls: [previewUrl] };
}

function glbSpec(item: IngestedFile): SourceSpec {
  const previewUrl = URL.createObjectURL(item.file);
  const file: FileRef = {
    uri: item.path,
    mime: item.file.type || 'model/gltf-binary',
    type: 'gltf',
    size: item.file.size,
    assets: [],
  };
  return { label: item.file.name, file, previewUrl, objectUrls: [previewUrl] };
}

async function gltfSpec(item: IngestedFile, all: IngestedFile[]): Promise<SourceSpec> {
  const bundle = await buildGltfBundle(item, all);
  const file: FileRef = {
    uri: item.path,
    mime: item.file.type || 'model/gltf+json',
    type: 'gltf',
    size: item.file.size,
    assets: bundle.assets,
  };
  const warning =
    bundle.missing.length > 0
      ? `缺失 ${bundle.missing.length} 个依赖：${bundle.missing.slice(0, 3).join(', ')}${
          bundle.missing.length > 3 ? ' …' : ''
        }`
      : undefined;
  return {
    label: item.file.name,
    file,
    previewUrl: bundle.srcUrl,
    objectUrls: bundle.objectUrls,
    warning,
  };
}

/**
 * 摄入入口：
 * - `.gltf` → 资源包（消费其依赖文件，不让纹理/bin 单独成节点）；
 * - `.glb` → 自包含模型；
 * - 其余已知文档类型 → 各自一个节点；
 * - 未被引用且类型未知的文件（如 LICENSE）→ 忽略。
 */
export async function ingestFiles(items: IngestedFile[]): Promise<SourceSpec[]> {
  const gltfRoots = items.filter((i) => ext(i.file.name) === 'gltf');
  const glbRoots = items.filter((i) => ext(i.file.name) === 'glb');

  const consumed = new Set<string>();
  for (const r of [...gltfRoots, ...glbRoots]) consumed.add(normalizePath(r.path));

  const specs: SourceSpec[] = [];

  for (const root of gltfRoots) {
    const spec = await gltfSpec(root, items);
    // 标记被该 gltf 引用的依赖为已消费。
    const rootDir = normalizePath(root.path).split('/').slice(0, -1).join('/');
    for (const a of spec.file.assets ?? []) {
      consumed.add(normalizePath(rootDir ? `${rootDir}/${a.path}` : a.path));
    }
    specs.push(spec);
  }

  for (const root of glbRoots) specs.push(glbSpec(root));

  for (const item of items) {
    const norm = normalizePath(item.path);
    if (consumed.has(norm)) continue;
    const type = detectFileType(item.file.name, item.file.type);
    if (type === 'unknown') continue;
    specs.push(await docSpec(item));
    consumed.add(norm);
  }

  return specs;
}
