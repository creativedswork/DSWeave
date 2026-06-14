import type { Node, Edge } from '@xyflow/react';
import type { FileRef, OutputSpec } from '@dsweave/core';

/** source 节点：用户拖入的文件。 */
export interface SourceNodeData extends Record<string, unknown> {
  kind: 'source';
  label: string;
  file: FileRef;
  /** 运行时预览：object URL（刷新失效）。 */
  previewUrl?: string;
  /** 运行时预览：文本内容。 */
  previewText?: string;
  /** 摄入告警（如 gltf 缺失依赖）。 */
  warning?: string;
}

/** output 节点：从受限菜单选类型 + 自然语言软细节。 */
export interface OutputNodeData extends Record<string, unknown> {
  kind: 'output';
  output: OutputSpec;
}

export type DSNodeData = SourceNodeData | OutputNodeData;
export type DSNode = Node<DSNodeData>;

export interface SemanticEdgeData extends Record<string, unknown> {
  semantics: string;
  params?: Record<string, unknown>;
}

export type DSEdge = Edge<SemanticEdgeData>;

export function isSourceData(data: DSNodeData): data is SourceNodeData {
  return data.kind === 'source';
}

export function isOutputData(data: DSNodeData): data is OutputNodeData {
  return data.kind === 'output';
}
