/**
 * 解析并缓存 @google/model-viewer 的 UMD bundle 文本，供内联进产物 <head>。
 * UMD（classic script）自注册 <model-viewer> 自定义元素且自带 three，离线可用。
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

let cache: string | undefined;

/** 取 model-viewer UMD 脚本文本（首次读盘后缓存）。 */
export function getModelViewerScript(): string {
  if (cache !== undefined) return cache;
  const pkgJson = require.resolve('@google/model-viewer/package.json');
  const bundle = join(dirname(pkgJson), 'dist', 'model-viewer-umd.min.js');
  cache = readFileSync(bundle, 'utf-8');
  return cache;
}
