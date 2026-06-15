/**
 * 文件理解 provider 框架。
 *
 * 每种 FileType 对应一个 UnderstandingProvider，负责把文件字节解析成 Understanding
 * （正文/大纲/结构/部件等）。上层（understanding-service）在 provider 产出之上再做
 * 上下文工程（分块/摘要），并做内容寻址缓存与流式回填。
 */
import type { FileRef, FileType, Understanding } from '@dsweave/core';

/** provider 解析时可用的 IO：根文件字节 + 依赖资源 + 关联节点。 */
export interface UnderstandIO {
  /** 关联的画布节点 id（用于 chunk 来源追溯）。 */
  nodeId: string;
  /** 根文件字节。 */
  bytes: Uint8Array;
  /** 以 utf-8 解码根文件为文本。 */
  text(): string;
  /** 取一个依赖资源的字节（key 为相对根目录路径，gltf 的 .bin/纹理）。 */
  asset(path: string): Uint8Array | undefined;
  /** 依赖资源路径清单。 */
  assetPaths(): string[];
}

export interface UnderstandingProvider {
  readonly type: FileType;
  /** provider 版本，参与缓存键（解析逻辑变更后自动失效）。 */
  readonly version: string;
  understand(file: FileRef, io: UnderstandIO): Promise<Understanding>;
}

/** FileType → provider 的注册表。 */
export class ProviderRegistry {
  private readonly providers = new Map<FileType, UnderstandingProvider>();

  register(provider: UnderstandingProvider): this {
    this.providers.set(provider.type, provider);
    return this;
  }

  get(type: FileType): UnderstandingProvider | undefined {
    return this.providers.get(type);
  }

  has(type: FileType): boolean {
    return this.providers.has(type);
  }

  /** 注册表整体版本指纹（各 provider 版本拼接），参与缓存键。 */
  fingerprint(): string {
    return [...this.providers.entries()]
      .map(([type, p]) => `${type}@${p.version}`)
      .sort()
      .join(',');
  }
}
