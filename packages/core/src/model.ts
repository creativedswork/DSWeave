/**
 * DSWeave 节点图模型。
 *
 * 概念澄清：节点 = 文件（用户拖入），边 = 语义文字，输出 = 受限类型 + 软细节。
 * 没有隐藏算子，结构之外的一切由 Agent 理解并执行。
 */

/** MVP 聚焦：gltf 模型 + 文档类；video/audio 后置。 */
export type FileType = 'gltf' | 'md' | 'pdf' | 'txt' | 'html' | 'image' | 'data' | 'unknown';

/**
 * gltf 等多文件资源的一个依赖项（相对根文件目录的路径）。
 * 典型：`.gltf` 引用的 `.bin` 缓冲与纹理图片。
 */
export interface FileAsset {
  /** 相对根文件目录的路径（与 gltf 内 uri 一致，已 decode）。 */
  path: string;
  mime?: string;
  size?: number;
  hash?: string;
  /** 资源种类，便于 Host/Agent 归类。 */
  role?: 'buffer' | 'image' | 'other';
}

/** 一个文件的引用（内容寻址）。 */
export interface FileRef {
  /** 逻辑标识：原始文件名或工作目录内相对路径（可持久化；非运行时 blob）。 */
  uri: string;
  mime: string;
  type: FileType;
  size?: number;
  /** 内容 hash，缓存键的一部分。 */
  hash?: string;
  /**
   * 多文件资源的依赖清单（如 gltf 的 .bin/纹理）。
   * 为空或缺省表示自包含单文件（如 .glb 或内嵌 data: 的 gltf）。
   */
  assets?: FileAsset[];
}

/** 给人看的预览元数据（运行时回填，不入持久化 IR）。 */
export interface PreviewMeta {
  thumbnail?: string;
  excerpt?: string;
  pageCount?: number;
  rows?: number;
}

/** 文档分块，携带来源以支持引用追溯。 */
export interface Chunk {
  id: string;
  text: string;
  source: { nodeId: string; loc?: string };
  embedding?: number[];
}

/** gltf 模型的结构元数据。 */
export interface ModelMeta {
  nodes?: { name: string; meshIndex?: number }[];
  materials?: string[];
  animations?: string[];
  bbox?: { min: [number, number, number]; max: [number, number, number] };
}

/**
 * 给 Agent "读懂"的表征（运行时回填）。这是 DSWeave 的核心攻坚产物。
 */
export interface Understanding {
  text?: string;
  summary?: string;
  chunks?: Chunk[];
  outline?: { level: number; title: string }[];
  schema?: Record<string, unknown>;
  captions?: string[];
  /** gltf 多角度渲染图 uri（喂多模态）。 */
  renders?: string[];
  /** gltf 结构元数据。 */
  model?: ModelMeta;
  metadata?: Record<string, unknown>;
  ready: boolean;
}

export type NodeKind = 'source' | 'output';

export type ExecStatus = 'idle' | 'running' | 'done' | 'error';

/** 受限输出菜单中的输出类型 id。 */
export type OutputTypeId = 'scene.html' | 'report.html' | 'app.react' | 'custom';

/** 输出节点的规格：选一种受限类型 + 自然语言软细节。 */
export interface OutputSpec {
  typeId: OutputTypeId;
  /** 自然语言软细节（风格 / 布局 / 文案）。 */
  spec: string;
  /** 受输出类型 schema 约束的硬参数。 */
  params?: Record<string, unknown>;
}

export interface FlowNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  label?: string;
  /** kind === 'source' */
  file?: FileRef;
  /** kind === 'output' */
  output?: OutputSpec;
  // ---- 运行时字段（序列化时剥离） ----
  preview?: PreviewMeta;
  understanding?: Understanding;
  status?: ExecStatus;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  /** 自然语言：这条连线代表什么关系/操作。 */
  semantics: string;
  params?: Record<string, unknown>;
  // ---- 运行时字段 ----
  status?: ExecStatus;
}

/** 持久化为 .flow.json 的工作流图。 */
export interface FlowGraph {
  version: 1;
  id: string;
  name: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  meta?: { createdAt: string; updatedAt: string };
}
