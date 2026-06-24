import type { SceneSpec } from '@dsweave/core';

/**
 * 运行时注入契约（由 Host 的 scene.html 能力写入预构建 bundle）：
 *  - `__DSWEAVE_SCENE__`：SceneSpec（Agent 唯一产出物）。
 *  - `__DSWEAVE_ASSETS__`：assetRef / gltf 依赖路径 → data URI（自包含）。
 *  - `__DSWEAVE_CHUNKS__`：chunkId → 文档片段（供热点/面板呈现与引用回指）。
 * 开发态无注入时回退到 demo。
 */

/** 注入的文档片段（来源可追溯）。 */
export interface ChunkInfo {
  text: string;
  loc?: string;
  nodeId: string;
  label?: string;
}

declare global {
  interface Window {
    __DSWEAVE_SCENE__?: SceneSpec;
    __DSWEAVE_ASSETS__?: Record<string, string>;
    __DSWEAVE_CHUNKS__?: Record<string, ChunkInfo>;
  }
}

export const DEMO_SPEC: SceneSpec = {
  version: 1,
  theme: { palette: 'dark-tech', style: 'minimal' },
  layout: 'single-focus',
  models: [],
  hotspots: [],
  panels: [{ title: 'DSWeave Scene Player', chunkIds: ['demo'] }],
  citations: false,
};

const DEMO_CHUNKS: Record<string, ChunkInfo> = {
  demo: {
    text: '这是 DSWeave Scene Player 的开发态占位。拖入 gltf + 文档并运行工作流以注入真实 SceneSpec。',
    nodeId: 'demo',
  },
};

export function loadSceneSpec(): SceneSpec {
  return window.__DSWEAVE_SCENE__ ?? DEMO_SPEC;
}

export function loadAssets(): Record<string, string> {
  return window.__DSWEAVE_ASSETS__ ?? {};
}

export function loadChunks(): Record<string, ChunkInfo> {
  return window.__DSWEAVE_CHUNKS__ ?? DEMO_CHUNKS;
}
