/**
 * 输出类型注册表：受限输出菜单的「单一事实来源」。
 *
 * 每个输出类型绑定一项背后能力（capability）。前端输出菜单应从「未隐藏的输出类型」派生，
 * 保证用户只能选注册表里真实可产出的类型。
 */
import type { FileType, OutputTypeId } from '@dsweave/core';

export interface OutputType {
  id: OutputTypeId;
  label: string;
  /** 背后能力 id（CapabilityRegistry 必须已注册）。 */
  capability: string;
  produces: string;
  description: string;
  acceptsFileTypes: FileType[];
  hidden?: boolean;
  specPlaceholder: string;
}

const DOC_TYPES: FileType[] = ['md', 'pdf', 'txt', 'html', 'image', 'data'];

export const OUTPUT_TYPES: OutputType[] = [
  {
    id: 'scene.html',
    label: '3D 沉浸场景 (scene.html)',
    capability: 'scene.html',
    produces: 'text/html',
    description: '把模型与文档编织成可旋转、可点热点的自包含 3D HTML。',
    acceptsFileTypes: ['gltf', ...DOC_TYPES],
    specPlaceholder: '例：模型居中可自动旋转，把每个章节绑成对应部件的热点，暗色主题。',
  },
  {
    id: 'report.html',
    label: '知识报告 (report.html)',
    capability: 'scene.html',
    produces: 'text/html',
    description: '把文档汇总成带引用的 2D 知识报告页（scene.html 的 2D 模式）。',
    acceptsFileTypes: DOC_TYPES,
    specPlaceholder: '例：按主题归纳，保留引用来源，生成目录与摘要。',
  },
  {
    id: 'app.react',
    label: 'React 应用 (app.react)',
    capability: 'app.react',
    produces: 'application/zip',
    description: '以工程/产物形式交付的可交互 React 应用（后续里程碑）。',
    acceptsFileTypes: ['gltf', ...DOC_TYPES],
    hidden: true,
    specPlaceholder: '描述应用的交互与页面结构。',
  },
  {
    id: 'custom',
    label: '自定义 (custom)',
    capability: 'custom.bestEffort',
    produces: 'application/octet-stream',
    description: '逃生通道：完全由自然语言描述（不保证可实现）。',
    acceptsFileTypes: ['gltf', ...DOC_TYPES, 'unknown'],
    hidden: true,
    specPlaceholder: '自由描述你想要的产物。',
  },
];

/** 输出类型 id → 背后能力 id。 */
export function capabilityForOutput(id: OutputTypeId | string | undefined): string {
  const t = OUTPUT_TYPES.find((o) => o.id === id);
  return t?.capability ?? 'scene.html';
}

/** 菜单可见的输出类型（前端据此派生输出菜单）。 */
export function visibleOutputTypes(): OutputType[] {
  return OUTPUT_TYPES.filter((t) => !t.hidden);
}
