/**
 * ACP 形态的方法与负载类型（自包含实现，方法名/语义对齐 ACP）。
 *
 * 之所以自研而非直接依赖外部 SDK：M2 目标是「用 Mock Agent 验证可插拔抽象」，
 * 自研层让 AcpTransport / Client / AgentSideConnection 抽象成立且零外部风险；
 * 待 M4 接真实 Agent 时，可在 stdio 边界换上官方 SDK 而不影响上层。
 */
import type {
  Artifact,
  Chunk,
  ExecStatus,
  FileRef,
  FlowGraph,
  OutputSpec,
  SceneSpec,
  Understanding,
} from '@dsweave/core';
import type { ToolCallState } from './events.js';

/** ACP 方法名常量。 */
export const RPC = {
  /** Client → Agent：新建会话。 */
  sessionNew: 'session/new',
  /** Client → Agent：发起一次执行（携带编码后的图）。 */
  sessionPrompt: 'session/prompt',
  /** Client → Agent：取消当前会话执行。 */
  sessionCancel: 'session/cancel',
  /** Agent → Client：流式执行态更新（通知）。 */
  sessionUpdate: 'session/update',
  /** Agent → Client：请求危险操作授权（请求）。 */
  requestPermission: 'session/request_permission',
  /**
   * Agent → Host：调用一项 Host 能力产出产物（Host 侧拦截处理，不转发前端）。
   * scene.html：input = { spec: SceneSpec } → 注入预构建 Player bundle → 自包含 HTML 产物。
   */
  capabilityInvoke: 'capability/invoke',
  /**
   * Client → Host：登记一个文件并触发文件理解（Host 侧能力，不转发给 Agent）。
   * 返回内容 hash；命中缓存时直接带回 Understanding，否则异步经 understandingUpdate 回填。
   */
  understandingRegister: 'understanding/register',
  /** Host → Client：文件理解就绪后的流式回填（通知）。 */
  understandingUpdate: 'understanding/update',
} as const;

export interface NewSessionParams {
  workingDir: string;
  capabilities: string[];
}

export interface NewSessionResult {
  sessionId: string;
}

/** 单个文件经上下文工程后选取的上下文。 */
export interface PromptContextFile {
  nodeId: string;
  label?: string;
  summary?: string;
  chunks: Chunk[];
}

/** 喂给 Agent 的上下文（ContextBuilder 产出，Host 注入）。 */
export interface PromptContext {
  /** 'full' = 全量喂入；'topk' = 检索式选片（规模化时）。 */
  retrieval: 'full' | 'topk';
  files: PromptContextFile[];
}

/** 编码后的提示输入（图 → prompt），随 session/prompt 发送。 */
export interface PromptInput {
  /** 角色 + 能力约束（系统指令）。 */
  instructions: string;
  /**
   * 结构（已剥离运行时字段）。Host 转发前会把各 source 节点的 `understanding` 重新注入，
   * 因此 Agent 收到的图节点带有文件理解。
   */
  graph: FlowGraph;
  /** Host 声明的可用能力清单。 */
  capabilities: string[];
  /** 沙箱工作目录。 */
  workingDir: string;
  /** 输出目标（受限类型 + 软细节）。 */
  outputs: OutputSpec[];
  /** 上下文工程产出（Host 注入；M3 起）。 */
  context?: PromptContext;
}

export interface PromptParams {
  sessionId: string;
  prompt: PromptInput;
}

export type StopReason = 'end_turn' | 'cancelled' | 'error';

export interface PromptResult {
  stopReason: StopReason;
}

export interface CancelParams {
  sessionId: string;
}

/**
 * 一次 session/update 通知里携带的更新（贴近 ACP 的 update 变体）。
 * decode.ts 负责把它归一化成前端的 DSWeaveEvent。
 */
export type SessionUpdate =
  | { type: 'node-status'; nodeId: string; status: ExecStatus; message?: string }
  | { type: 'edge-status'; edgeId: string; status: ExecStatus }
  | { type: 'tool-call'; id: string; title: string; state: ToolCallState; nodeId?: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  | { type: 'artifact'; uri: string; mime: string; fromNodeId?: string };

export interface SessionUpdateNotification {
  sessionId: string;
  update: SessionUpdate;
}

export interface RequestPermissionParams {
  sessionId: string;
  requestId: string;
  summary: string;
  options: string[];
}

export interface RequestPermissionResult {
  /** 选中的选项序号；null 表示取消/拒绝。 */
  optionIndex: number | null;
}

// ---------- 文件理解（Host 侧能力） ----------

/** 一个待登记文件的内容（base64）。 */
export interface FileContent {
  /** 相对根文件目录的路径（与 FileRef.assets[].path / gltf 内 uri 对齐）。 */
  path: string;
  /** base64 编码的字节。 */
  content: string;
}

/** understanding/register 入参：登记文件 + 内容，触发文件理解。 */
export interface RegisterFileParams {
  /** 关联的画布节点 id（Host 据此回填 understanding）。 */
  nodeId: string;
  ref: FileRef;
  /** base64 编码的根文件内容。 */
  content: string;
  /** 多文件资源（gltf 的 .bin/纹理）的依赖内容。 */
  assets?: FileContent[];
}

/** understanding/register 返回：内容 hash；命中缓存时直接带回结果。 */
export interface RegisterFileResult {
  nodeId: string;
  /** 内容寻址 hash（sha256）。 */
  hash: string;
  /** 是否命中缓存（命中即同步带回 understanding）。 */
  cached: boolean;
  understanding?: Understanding;
}

/** understanding/update 通知：文件理解就绪后的流式回填。 */
export interface UnderstandingNotification {
  nodeId: string;
  hash: string;
  understanding: Understanding;
}

// ---------- 能力调用（Agent → Host） ----------

/** scene.html 能力的输入：Agent 唯一交付物 SceneSpec。 */
export interface SceneHtmlInput {
  spec: SceneSpec;
}

/** capability/invoke 入参。 */
export interface CapabilityInvokeParams {
  sessionId: string;
  /** 能力 id（如 'scene.html'）。 */
  capability: string;
  /** 关联的输出节点 id。 */
  outputNodeId?: string;
  /** 能力输入（scene.html → SceneHtmlInput）。 */
  input: unknown;
}

/** capability/invoke 返回：产出物 + 是否命中缓存。 */
export interface CapabilityInvokeResult {
  artifact: Artifact;
  cached: boolean;
}
