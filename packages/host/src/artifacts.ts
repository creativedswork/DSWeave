/**
 * 产物存储：内容寻址落盘 `.dsweave/artifacts/<hash>/`。
 *
 * - 单文件 HTML 直接交付（双击即看）；Host 经静态服务 `/_artifacts/<hash>/...` 供前端 iframe 预览。
 * - 缓存：以产物内容 hash 命名目录（hash 含最终 HTML 全文），存在即命中。
 */
import { existsSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, normalize } from 'node:path';
import type { Artifact } from '@dsweave/core';

const ARTIFACT_DIR = '.dsweave/artifacts';

export interface ArtifactStoreOptions {
  /** 沙箱工作目录（产物落盘根）。 */
  rootDir: string;
}

export class ArtifactStore {
  private readonly rootDir: string;

  constructor(opts: ArtifactStoreOptions) {
    this.rootDir = opts.rootDir;
  }

  private dir(hash: string): string {
    return join(this.rootDir, ARTIFACT_DIR, hash);
  }

  has(hash: string, filename = 'index.html'): boolean {
    return existsSync(join(this.dir(hash), filename));
  }

  /** 写入内容寻址产物，返回 Artifact。 */
  write(
    hash: string,
    filename: string,
    content: string,
    mime: string,
    fromNodeId?: string,
  ): Artifact {
    const dir = this.dir(hash);
    mkdirSync(dir, { recursive: true });
    const path = join(dir, filename);
    if (!existsSync(path)) writeFileSync(path, content, 'utf-8');
    return this.artifactFor(hash, filename, mime, fromNodeId);
  }

  /** 构造已存在产物的引用（缓存命中路径）。 */
  artifactFor(hash: string, filename: string, mime: string, fromNodeId?: string): Artifact {
    const path = join(this.dir(hash), filename);
    const bytes = existsSync(path) ? statSync(path).size : 0;
    return {
      uri: `/_artifacts/${hash}/${filename}`,
      mime,
      hash,
      singleFile: true,
      bytes,
      fromNodeId,
      path,
    };
  }

  /** HTTP 静态服务用：把 `/_artifacts/<hash>/<file>` 解析为安全的磁盘路径。 */
  resolveServePath(urlPath: string): string | null {
    const prefix = '/_artifacts/';
    if (!urlPath.startsWith(prefix)) return null;
    const rel = normalize(urlPath.slice(prefix.length)).replace(/^(\.\.[/\\])+/, '');
    if (rel.includes('..')) return null;
    const base = join(this.rootDir, ARTIFACT_DIR);
    const full = join(base, rel);
    if (!full.startsWith(base)) return null;
    return existsSync(full) ? full : null;
  }
}
