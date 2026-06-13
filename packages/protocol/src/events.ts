import type { ExecStatus } from '@dsweave/core';

/** 把 ACP `session/update` 流解码成的前端领域事件。 */
export type DSWeaveEvent =
  | { kind: 'node-status'; nodeId: string; status: ExecStatus; message?: string }
  | { kind: 'edge-status'; edgeId: string; status: ExecStatus }
  | { kind: 'tool-call'; id: string; title: string; state: ToolCallState }
  | { kind: 'log'; level: 'info' | 'warn' | 'error'; text: string }
  | { kind: 'artifact'; uri: string; mime: string; fromNodeId?: string }
  | { kind: 'permission-request'; id: string; summary: string; options: string[] }
  | { kind: 'done'; reason: string };

export type ToolCallState = 'pending' | 'running' | 'done' | 'error';
