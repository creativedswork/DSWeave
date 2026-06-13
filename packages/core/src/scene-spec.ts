/**
 * SceneSpec —— Agent 唯一的产出物（纯数据，零代码）。
 *
 * Host 的 `scene.html` 能力把 SceneSpec + 资产注入预构建的 R3F Scene Player bundle，
 * 导出自包含单文件 HTML。把"会出错的代码"留在构建期，产物一定可运行。
 */

export interface Transform {
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
}

/** 场景主题（软细节）。 */
export interface SceneTheme {
  palette: string;
  style: string;
}

/** 放进场景的一个模型。 */
export interface SceneModel {
  /** 对应来源 source 节点的 id。 */
  nodeId: string;
  /** 资产引用（产物内的相对路径或内联 id）。 */
  assetRef: string;
  placement?: Transform;
  autoRotate?: boolean;
}

/** 把文档片段绑定到模型部件的热点。 */
export interface SceneHotspot {
  /** 对应模型的来源节点 id。 */
  modelNodeId: string;
  /** 部件名，取自 ModelMeta.nodes[].name。 */
  part: string;
  title: string;
  /** 绑定的文档分块 id。 */
  bodyChunkIds: string[];
}

/** 文档面板/浮窗。 */
export interface ScenePanel {
  title: string;
  chunkIds: string[];
}

export type SceneLayout = 'single-focus' | 'gallery';

/** Scene Player 的输入契约。 */
export interface SceneSpec {
  version: 1;
  theme: SceneTheme;
  layout: SceneLayout;
  models: SceneModel[];
  hotspots: SceneHotspot[];
  panels: ScenePanel[];
  /** 是否在产物中呈现来源引用。 */
  citations: boolean;
}
