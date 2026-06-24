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

/** 放进场景的一张图片（以贴图平面呈现）。 */
export interface SceneImage {
  /** 对应来源 source 节点的 id（image 类型）。 */
  nodeId: string;
  /** 资产引用（产物内的相对路径或内联 id）。 */
  assetRef: string;
  placement?: Transform;
  /** 世界单位下的平面宽度（高度按图片宽高比自动）。默认 2.4。 */
  width?: number;
  /** 平面下方显示的说明文字。 */
  label?: string;
}

/** 两个场景元素（模型/图片）之间的有向连接（箭头 + 标注），通常由连线语义驱动。 */
export interface SceneConnector {
  /** 起点元素的来源节点 id（models[].nodeId 或 images[].nodeId）。 */
  fromNodeId: string;
  /** 终点元素的来源节点 id。 */
  toNodeId: string;
  /** 连接线上的标注文字（如「生成」）。 */
  label?: string;
  /** 'arrow'=带箭头（默认）；'line'=无箭头。 */
  style?: 'arrow' | 'line';
}

/** Scene Player 的输入契约。 */
export interface SceneSpec {
  version: 1;
  theme: SceneTheme;
  layout: SceneLayout;
  models: SceneModel[];
  /** 图片平面（png/jpg/webp 等图片源）。可选，缺省为空。 */
  images?: SceneImage[];
  hotspots: SceneHotspot[];
  panels: ScenePanel[];
  /** 元素间的有向连接（箭头 + 标注）。可选，缺省为空。 */
  connectors?: SceneConnector[];
  /** 是否在产物中呈现来源引用。 */
  citations: boolean;
}
