/**
 * ACP 形态的方法与负载类型（自包含实现，方法名/语义对齐 ACP）。
 *
 * 之所以自研而非直接依赖外部 SDK：M2 目标是「用 Mock Agent 验证可插拔抽象」，
 * 自研层让 AcpTransport / Client / AgentSideConnection 抽象成立且零外部风险；
 * 待 M4 接真实 Agent 时，可在 stdio 边界换上官方 SDK 而不影响上层。
 */
import type { ExecStatus, FlowGraph, OutputSpec } from '@dsweave/core';
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
} as const;

export interface NewSessionParams {
  workingDir: string;
  capabilities: string[];
}

export interface NewSessionResult {
  sessionId: string;
}

/** 编码后的提示输入（图 → prompt），随 session/prompt 发送。 */
export interface PromptInput {
  /** 角色 + 能力约束（系统指令）。 */
  instructions: string;
  /** 结构（已剥离运行时字段）。 */
  graph: FlowGraph;
  /** Host 声明的可用能力清单。 */
  capabilities: string[];
  /** 沙箱工作目录。 */
  workingDir: string;
  /** 输出目标（受限类型 + 软细节）。 */
  outputs: OutputSpec[];
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
