/**
 * 文件服务：登记文件 → 计算 hash → 分配资源 uri。
 *
 * M2 为内存实现，主要用于会话期登记图中的文件并供日志/缓存键使用；
 * M3/M4 起承载真实落盘、内容寻址与产物目录。
 */
import { hashString, type FileRef } from '@dsweave/core';

export class FsService {
  private readonly files = new Map<string, FileRef>();

  /** 登记一个文件，缺省 hash 时按 uri+size 生成占位 hash。 */
  register(ref: FileRef): FileRef {
    const hash = ref.hash ?? hashString(`${ref.uri}:${ref.size ?? 0}`);
    const withHash: FileRef = { ...ref, hash };
    this.files.set(withHash.uri, withHash);
    return withHash;
  }

  get(uri: string): FileRef | undefined {
    return this.files.get(uri);
  }

  list(): FileRef[] {
    return [...this.files.values()];
  }

  clear(): void {
    this.files.clear();
  }
}
