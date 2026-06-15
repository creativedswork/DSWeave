/**
 * 文件服务：登记文件字节 → 内容寻址 hash（sha256）→ 供文件理解与缓存使用。
 *
 * M3 起承载真实字节存储与内容寻址；产物落盘（.dsweave/artifacts）在 M4 引入。
 */
import { createHash } from 'node:crypto';
import type { FileRef } from '@dsweave/core';

/** 已登记的文件（根字节 + 依赖资源字节）。 */
export interface StoredFile {
  /** 带内容 hash 的 FileRef。 */
  ref: FileRef;
  bytes: Uint8Array;
  /** 依赖资源：相对根目录路径 → 字节。 */
  assets: Map<string, Uint8Array>;
}

/** 对根字节 + 依赖资源做确定性内容寻址 hash。 */
export function contentHash(bytes: Uint8Array, assets?: { path: string; bytes: Uint8Array }[]): string {
  const h = createHash('sha256');
  h.update(bytes);
  for (const a of [...(assets ?? [])].sort((x, y) => x.path.localeCompare(y.path))) {
    h.update('\0');
    h.update(a.path);
    h.update('\0');
    h.update(a.bytes);
  }
  return h.digest('hex');
}

export class FsService {
  /** uri → 存储文件。 */
  private readonly byUri = new Map<string, StoredFile>();
  /** 内容 hash → 存储文件（内容寻址）。 */
  private readonly byHash = new Map<string, StoredFile>();

  /** 存入文件字节，计算内容 hash 并返回 StoredFile。 */
  store(
    ref: FileRef,
    bytes: Uint8Array,
    assets: { path: string; bytes: Uint8Array }[] = [],
  ): StoredFile {
    const hash = contentHash(bytes, assets);
    const assetMap = new Map<string, Uint8Array>();
    for (const a of assets) assetMap.set(a.path, a.bytes);
    const stored: StoredFile = { ref: { ...ref, hash }, bytes, assets: assetMap };
    this.byUri.set(ref.uri, stored);
    this.byHash.set(hash, stored);
    return stored;
  }

  getByHash(hash: string): StoredFile | undefined {
    return this.byHash.get(hash);
  }

  get(uri: string): StoredFile | undefined {
    return this.byUri.get(uri);
  }

  list(): StoredFile[] {
    return [...this.byUri.values()];
  }

  clear(): void {
    this.byUri.clear();
    this.byHash.clear();
  }
}
