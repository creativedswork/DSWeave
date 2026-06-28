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
  type CapabilityInvokeParams,
  type CapabilityInvokeResult,
  type InstallSkillParams,
  type PromptParams,
  type RegisterFileParams,
  type RegisterFileResult,
  type RemoveSkillParams,
  type SetActiveSkillParams,
  type UnderstandingNotification,
} from '@dsweave/protocol';
import type { UnderstandingService } from './understanding-service.js';
import type { SkillsService } from './skills/index.js';
import { buildContext } from './context/builder.js';

export type CapabilityInvoker = (
  params: CapabilityInvokeParams,
) => Promise<CapabilityInvokeResult>;

export interface BridgeOptions {
  understanding?: UnderstandingService;
  /** Skills 库管理 + 激活集解析（Host 侧拦截 skills/* + 注入 prompt.skills）。 */
  skills?: SkillsService;
  /** Agent 侧 capability/invoke 的处理器（Host 能力执行）。 */
  onCapabilityInvoke?: CapabilityInvoker;
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
  const { understanding, skills, onCapabilityInvoke } = options;

  client.onMessage((msg) => {
    if (isObject(msg)) {
      // 1) Host 拦截：文件理解登记。
      if (isRequest(msg) && msg.method === RPC.understandingRegister && understanding) {
        handleRegister(client, understanding, msg.id as number, msg.params as RegisterFileParams);
        return;
      }
      // 2) Host 拦截：Skills 库管理（不转发给 Agent）。
      if (isRequest(msg) && skills && isSkillsMethod(msg.method as string)) {
        handleSkills(client, skills, msg.id as number, msg.method as string, msg.params);
        return;
      }
      // 3) prompt 注入：转发前补全 understanding + context + 激活 skills。
      if (isRequest(msg) && msg.method === RPC.sessionPrompt) {
        enrichPrompt(msg.params as PromptParams, understanding, skills);
      }
    }
    options.onFrame?.('client->agent', msg);
    agent.send(msg);
  });

  agent.onMessage((msg) => {
    // Host 拦截：Agent 调用 Host 能力（capability/invoke），就地执行不转发前端。
    if (
      isObject(msg) &&
      isRequest(msg) &&
      msg.method === RPC.capabilityInvoke &&
      onCapabilityInvoke
    ) {
      handleCapability(agent, onCapabilityInvoke, msg.id as number, msg.params as CapabilityInvokeParams);
      return;
    }
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

/** 处理 Agent 的 capability/invoke：执行 Host 能力，把产物结果回给 Agent。 */
function handleCapability(
  agent: AcpTransport,
  invoke: CapabilityInvoker,
  id: number,
  params: CapabilityInvokeParams,
): void {
  invoke(params)
    .then((result) => {
      agent.send({ jsonrpc: '2.0', id, result });
    })
    .catch((err: unknown) => {
      agent.send({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    });
}

/**
 * 在转发给 Agent 前：给图注入 understanding + ContextBuilder 上下文（M3）；
 * 并把当前 flow 的激活 skill 集（元数据 + 源目录）注入 prompt.skills（S2）。
 */
function enrichPrompt(
  params: PromptParams,
  understanding?: UnderstandingService,
  skills?: SkillsService,
): void {
  const prompt = params?.prompt;
  const graph = prompt?.graph as FlowGraph | undefined;
  if (!graph) return;
  if (understanding) {
    for (const node of graph.nodes) {
      if (node.kind !== 'source') continue;
      const u = understanding.getForNode(node.id);
      if (u) node.understanding = u;
    }
    prompt.context = buildContext(graph, understanding.snapshot());
  }
  if (skills) {
    const active = skills.resolveActive(graph.id);
    if (active.length) prompt.skills = active;
  }
}

const SKILLS_METHODS = new Set<string>([
  RPC.skillsList,
  RPC.skillsInstall,
  RPC.skillsSetActive,
  RPC.skillsRemove,
]);

function isSkillsMethod(method: string): boolean {
  return SKILLS_METHODS.has(method);
}

/** 处理 skills/* 请求：调用 SkillsService，把结果直接回给前端（不转发 Agent）。 */
function handleSkills(
  client: AcpTransport,
  skills: SkillsService,
  id: number,
  method: string,
  params: unknown,
): void {
  try {
    let result: unknown;
    switch (method) {
      case RPC.skillsList:
        result = skills.list((params as { flowId?: string } | undefined)?.flowId);
        break;
      case RPC.skillsInstall:
        result = skills.install(params as InstallSkillParams);
        break;
      case RPC.skillsSetActive:
        result = skills.setActive(params as SetActiveSkillParams);
        break;
      case RPC.skillsRemove:
        result = skills.remove(params as RemoveSkillParams);
        break;
      default:
        throw new Error(`unhandled skills method: ${method}`);
    }
    client.send({ jsonrpc: '2.0', id, result });
  } catch (err) {
    client.send({
      jsonrpc: '2.0',
      id,
      error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
    });
  }
}
