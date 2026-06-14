import type { FileType, OutputTypeId } from '@dsweave/core';

/**
 * 受限输出菜单（前端镜像）。
 *
 * 真正的能力注册表在 Host 侧（M4），这里只是给画布提供「可选输出类型」。
 * 关键约束：用户只能从这个列表里选，不能自由填写输出形态。
 */
export interface OutputTypeDef {
  id: OutputTypeId;
  label: string;
  /** 产物 MIME。 */
  produces: string;
  /** 一句话描述。 */
  description: string;
  /** 可接受的输入文件类型（提示用，不强制）。 */
  acceptsFileTypes: FileType[];
  /** 是否在菜单中隐藏（custom 为逃生通道，默认隐藏）。 */
  hidden?: boolean;
  /** 软细节输入框的占位提示。 */
  specPlaceholder: string;
}

export const OUTPUT_TYPES: OutputTypeDef[] = [
  {
    id: 'scene.html',
    label: '3D 沉浸场景 (scene.html)',
    produces: 'text/html',
    description: '把模型与文档编织成可旋转、可点热点的自包含 3D HTML。',
    acceptsFileTypes: ['gltf', 'md', 'pdf', 'txt', 'html', 'image', 'data'],
    specPlaceholder: '例：模型居中可自动旋转，把每个章节绑成对应部件的热点，暗色主题。',
  },
  {
    id: 'report.html',
    label: '知识报告 (report.html)',
    produces: 'text/html',
    description: '把文档汇总成带引用的 2D 知识报告页。',
    acceptsFileTypes: ['md', 'pdf', 'txt', 'html', 'image', 'data'],
    specPlaceholder: '例：按主题归纳，保留引用来源，生成目录与摘要。',
  },
  {
    id: 'app.react',
    label: 'React 应用 (app.react)',
    produces: 'application/zip',
    description: '以工程/产物形式交付的可交互 React 应用（后续里程碑）。',
    acceptsFileTypes: ['gltf', 'md', 'pdf', 'txt', 'html', 'image', 'data'],
    hidden: true,
    specPlaceholder: '描述应用的交互与页面结构。',
  },
  {
    id: 'custom',
    label: '自定义 (custom)',
    produces: 'application/octet-stream',
    description: '逃生通道：完全由自然语言描述（不保证可实现）。',
    acceptsFileTypes: ['gltf', 'md', 'pdf', 'txt', 'html', 'image', 'data', 'unknown'],
    hidden: true,
    specPlaceholder: '自由描述你想要的产物。',
  },
];

/** 菜单里可见的输出类型。 */
export const VISIBLE_OUTPUT_TYPES = OUTPUT_TYPES.filter((t) => !t.hidden);

/** 默认输出类型（首发主竖切）。 */
export const DEFAULT_OUTPUT_TYPE: OutputTypeDef = OUTPUT_TYPES[0]!;

export function getOutputType(id: OutputTypeId): OutputTypeDef {
  return OUTPUT_TYPES.find((t) => t.id === id) ?? DEFAULT_OUTPUT_TYPE;
}
