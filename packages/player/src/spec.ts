import type { SceneSpec } from '@dsweave/core';

/**
 * 运行时通过 `window.__DSWEAVE_SCENE__` 注入 SceneSpec（由 Host 的 scene.html 能力写入）。
 * 开发态无注入时回退到 demo spec。
 */
declare global {
  interface Window {
    __DSWEAVE_SCENE__?: SceneSpec;
  }
}

export const DEMO_SPEC: SceneSpec = {
  version: 1,
  theme: { palette: 'dark-tech', style: 'minimal' },
  layout: 'single-focus',
  models: [],
  hotspots: [],
  panels: [{ title: 'DSWeave Scene Player', chunkIds: [] }],
  citations: false,
};

export function loadSceneSpec(): SceneSpec {
  return window.__DSWEAVE_SCENE__ ?? DEMO_SPEC;
}
