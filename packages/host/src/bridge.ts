/**
 * Bridge：前端传输 ↔ Agent 传输的中继。
 *
 * 由于前端与 Agent 说同一套 ACP JSON-RPC，Host 在 M2 做透明帧中继即可：
 * 一对一连接下，双向转发消息帧，id 空间天然隔离。
 * 同时提供 observe 钩子，便于 Host 旁路观测（登记文件、日志、未来注入能力）。
 */
import { hashString, type FlowGraph } from '@dsweave/core';
import { RPC, type AcpTransport, type PromptParams } from '@dsweave/protocol';
import type { FsService } from './fs-service.js';

export interface BridgeOptions {
  fs?: FsService;
  /** 帧观测回调（仅旁路，不改变转发）。 */
  onFrame?: (direction: 'client->agent' | 'agent->client', message: unknown) => void;
}

export interface BridgeHandle {
  close(): void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

/** 把 client 与 agent 两个传输互联，返回可关闭句柄。 */
export function bridge(
  client: AcpTransport,
  agent: AcpTransport,
  options: BridgeOptions = {},
): BridgeHandle {
  let closed = false;

  client.onMessage((msg) => {
    observeClientFrame(msg, options);
    options.onFrame?.('client->agent', msg);
    agent.send(msg);
  });

  agent.onMessage((msg) => {
    options.onFrame?.('agent->client', msg);
    client.send(msg);
  });

  const closeBoth = () => {
    if (closed) return;
    closed = true;
    client.close();
    agent.close();
  };

  client.onClose?.(closeBoth);
  agent.onClose?.(closeBoth);

  return { close: closeBoth };
}

/** 旁路观测：在 session/prompt 帧里登记图中的文件。 */
function observeClientFrame(msg: unknown, options: BridgeOptions): void {
  if (!options.fs || !isObject(msg)) return;
  if (msg.method !== RPC.sessionPrompt) return;
  const params = msg.params as PromptParams | undefined;
  const graph = params?.prompt?.graph as FlowGraph | undefined;
  if (!graph) return;
  for (const node of graph.nodes) {
    if (node.kind === 'source' && node.file) {
      options.fs.register({
        ...node.file,
        hash: node.file.hash ?? hashString(node.file.uri),
      });
    }
  }
}
