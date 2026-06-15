/**
 * Bridge：前端传输 ↔ Agent 传输的路由器。
 *
 * 多数 ACP 帧（session/*）在前端与 Agent 间透明中继；但两类 Host 侧职责由 Bridge 就地处理：
 *  1. `understanding/register`：登记文件并触发文件理解（不转发给 Agent）；理解就绪后用
 *     `understanding/update` 通知回填前端。
 *  2. `session/prompt`：转发前把各 source 节点的 `understanding` 注入图，并附上 ContextBuilder
 *     产出的上下文，让 Agent 拿到「解析+分块+摘要+检索」后的高质量上下文。
 */
import type { FlowGraph } from '@dsweave/core';
import {
  RPC,
  type AcpTransport,
  type PromptParams,
  type RegisterFileParams,
  type RegisterFileResult,
  type UnderstandingNotification,
} from '@dsweave/protocol';
import type { UnderstandingService } from './understanding-service.js';
import { buildContext } from './context/builder.js';

export interface BridgeOptions {
  understanding?: UnderstandingService;
  /** 帧观测回调（仅旁路，不改变转发）。 */
  onFrame?: (direction: 'client->agent' | 'agent->client', message: unknown) => void;
}

export interface BridgeHandle {
  close(): void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isRequest(msg: Record<string, unknown>): boolean {
  return typeof msg.method === 'string' && 'id' in msg && typeof msg.id === 'number';
}

/** 把 client 与 agent 两个传输互联（带 Host 侧拦截），返回可关闭句柄。 */
export function bridge(
  client: AcpTransport,
  agent: AcpTransport,
  options: BridgeOptions = {},
): BridgeHandle {
  let closed = false;
  const { understanding } = options;

  client.onMessage((msg) => {
    if (isObject(msg)) {
      // 1) Host 拦截：文件理解登记。
      if (isRequest(msg) && msg.method === RPC.understandingRegister && understanding) {
        handleRegister(client, understanding, msg.id as number, msg.params as RegisterFileParams);
        return;
      }
      // 2) prompt 注入：转发前补全 understanding + context。
      if (isRequest(msg) && msg.method === RPC.sessionPrompt && understanding) {
        enrichPrompt(msg.params as PromptParams, understanding);
      }
    }
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

/** 处理 understanding/register：登记 + 触发理解，立即回响应，就绪后推 understanding/update。 */
function handleRegister(
  client: AcpTransport,
  understanding: UnderstandingService,
  id: number,
  params: RegisterFileParams,
): void {
  const onReady = (note: UnderstandingNotification) => {
    client.send({ jsonrpc: '2.0', method: RPC.understandingUpdate, params: note });
  };
  let result: RegisterFileResult;
  try {
    result = understanding.register(params, onReady);
  } catch (err) {
    client.send({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    });
    return;
  }
  client.send({ jsonrpc: '2.0', id, result });
}

/** 在转发给 Agent 前，给 prompt 的图注入 understanding，并附 ContextBuilder 上下文。 */
function enrichPrompt(params: PromptParams, understanding: UnderstandingService): void {
  const prompt = params?.prompt;
  const graph = prompt?.graph as FlowGraph | undefined;
  if (!graph) return;
  for (const node of graph.nodes) {
    if (node.kind !== 'source') continue;
    const u = understanding.getForNode(node.id);
    if (u) node.understanding = u;
  }
  prompt.context = buildContext(graph, understanding.snapshot());
}
