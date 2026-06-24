/**
 * 产物存储：内容寻址落盘 `.dsweave/artifacts/<hash>/`，并加载预构建 Player bundle 模板。
 *
 * - 单文件 HTML 直接交付（双击即看）；Host 经静态服务 `/_artifacts/<hash>/...` 供前端 iframe 预览。
 * - 缓存：以产物内容 hash 命名目录，存在即命中（key 隐含 Player 版本，因模板内联其中）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, normalize } from 'node:path';
import type { Artifact } from '@dsweave/core';

const ARTIFACT_DIR = '.dsweave/artifacts';

export interface ArtifactStoreOptions {
  /** 沙箱工作目录（产物落盘根）。 */
  rootDir: string;
  /** 预构建 Player 单文件 HTML 路径（缺省 <cwd>/packages/player/dist/index.html）。 */
  playerDistPath?: string;
}

export class ArtifactStore {
  private readonly rootDir: string;
  private readonly playerDistPath: string;
  private templateCache: string | null = null;
  private versionCache: string | null = null;

  constructor(opts: ArtifactStoreOptions) {
    this.rootDir = opts.rootDir;
    this.playerDistPath =
      opts.playerDistPath ?? resolve(process.cwd(), 'packages/player/dist/index.html');
  }

  /** 读取（并缓存）预构建 Player 模板。未构建时抛出可操作的错误。 */
  playerTemplate(): string {
    if (this.templateCache != null) return this.templateCache;
    if (!existsSync(this.playerDistPath)) {
      throw new Error(
        `Player bundle 未构建：${this.playerDistPath}。请先运行 \`pnpm --filter @dsweave/player build\`。`,
      );
    }
    this.templateCache = readFileSync(this.playerDistPath, 'utf-8');
    this.versionCache = createHash('sha256').update(this.templateCache).digest('hex').slice(0, 12);
    return this.templateCache;
  }

  /** Player 版本指纹（模板内容 hash 前 12 位）。 */
  playerVersion(): string {
    if (this.versionCache == null) this.playerTemplate();
    return this.versionCache as string;
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
