/**
 * Mock Agent：收到 prompt → 按图发出 node/edge 状态流 + 日志 + 产物 → done。
 *
 * 目的（M2）：用最小可插拔 Agent 验证 ACP 全链路与 AcpTransport 抽象，
 * 不做真实理解/生成。真实 Agent（M4）替换本实现而前端无需改动。
 */
import {
  AgentSideConnection,
  type AcpTransport,
  type CancelParams,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
} from '@dsweave/protocol';
import type { FlowNode, Understanding } from '@dsweave/core';
import { backingCapability } from './tools/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sessionSeq = 0;

/** 创建一个基于给定传输的 Mock Agent 连接。 */
export function createMockAgent(transport: AcpTransport): AgentSideConnection {
  const cancelled = new Set<string>();

  return new AgentSideConnection(transport, {
    onNewSession(_params: NewSessionParams): NewSessionResult {
      return { sessionId: `mock_${++sessionSeq}` };
    },
    onCancel(params: CancelParams): void {
      cancelled.add(params.sessionId);
    },
    onPrompt(params: PromptParams, conn: AgentSideConnection): Promise<PromptResult> {
      return runMock(params, conn, cancelled);
    },
  });
}

async function runMock(
  params: PromptParams,
  conn: AgentSideConnection,
  cancelled: Set<string>,
): Promise<PromptResult> {
  const { sessionId, prompt } = params;
  const { graph } = prompt;
  const isCancelled = () => cancelled.has(sessionId);

  conn.sessionUpdate(sessionId, {
    type: 'log',
    level: 'info',
    text: `收到工作流「${graph.name}」：${graph.nodes.length} 个节点 / ${graph.edges.length} 条连线`,
  });

  if (prompt.context) {
    const totalChunks = prompt.context.files.reduce((acc, f) => acc + f.chunks.length, 0);
    conn.sessionUpdate(sessionId, {
      type: 'log',
      level: 'info',
      text: `上下文（${prompt.context.retrieval}）：${prompt.context.files.length} 个文件 / ${totalChunks} 个分块`,
    });
  }

  const sources = graph.nodes.filter((n) => n.kind === 'source');
  const outputs = graph.nodes.filter((n) => n.kind === 'output');

  // 1) 逐个「理解」源文件：基于 Host 注入的 understanding 做引用/部件描述
  for (const node of sources) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'running' });
    const name = node.label ?? node.file?.uri ?? node.id;
    conn.sessionUpdate(sessionId, { type: 'log', level: 'info', text: `理解文件：${name}` });
    for (const line of describeUnderstanding(node)) {
      conn.sessionUpdate(sessionId, { type: 'log', level: 'info', text: `  ${line}` });
    }
    await sleep(220);
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: node.id,
      status: 'done',
      message: node.understanding?.ready ? '已理解' : '已登记（无表征）',
    });
  }

  // 2) 逐条「连线」生效
  for (const edge of graph.edges) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    conn.sessionUpdate(sessionId, { type: 'edge-status', edgeId: edge.id, status: 'running' });
    await sleep(150);
    conn.sessionUpdate(sessionId, { type: 'edge-status', edgeId: edge.id, status: 'done' });
  }

  // 3) 逐个输出节点「产出」（工具卡片 + 产物）
  for (const node of outputs) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    const typeId = node.output?.typeId ?? 'scene.html';
    const cap = backingCapability(typeId);
    const toolId = `tool_${node.id}`;

    conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'running' });
    conn.sessionUpdate(sessionId, {
      type: 'tool-call',
      id: toolId,
      title: `${cap}（mock）`,
      state: 'running',
      nodeId: node.id,
    });
    conn.sessionUpdate(sessionId, {
      type: 'log',
      level: 'info',
      text: `调用能力 ${cap} 产出 ${typeId} …`,
    });
    await sleep(420);
    conn.sessionUpdate(sessionId, {
      type: 'tool-call',
      id: toolId,
      title: `${cap}（mock）`,
      state: 'done',
      nodeId: node.id,
    });
    conn.sessionUpdate(sessionId, {
      type: 'artifact',
      uri: `mock://artifacts/${node.id}.html`,
      mime: 'text/html',
      fromNodeId: node.id,
    });
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: node.id,
      status: 'done',
      message: '产物已生成（mock）',
    });
  }

  return finish(conn, sessionId, 'end_turn');
}

/**
 * 把一个 source 节点的 understanding 转成可读的「理解小结」日志行。
 * 体现 M3 价值：文档能被引用（带来源 loc）、gltf 能被描述（部件/外观）。
 */
function describeUnderstanding(node: FlowNode): string[] {
  const u: Understanding | undefined = node.understanding;
  if (!u || !u.ready) return ['（未收到文件理解，跳过）'];
  const lines: string[] = [];

  if (u.model) {
    const parts = (u.model.nodes ?? []).map((n) => n.name);
    if (parts.length > 0) {
      lines.push(`模型部件（${parts.length}）：${parts.slice(0, 8).join('、')}${parts.length > 8 ? ' …' : ''}`);
    }
    if (u.model.materials?.length) lines.push(`材质：${u.model.materials.join('、')}`);
    if (u.model.animations?.length) lines.push(`动画：${u.model.animations.join('、')}`);
  }
  for (const cap of u.captions ?? []) lines.push(`外观：${cap}`);

  if (u.outline?.length) {
    lines.push(`大纲：${u.outline.slice(0, 5).map((o) => o.title).join(' / ')}`);
  }
  if (u.summary) lines.push(`摘要：${u.summary.slice(0, 120)}${u.summary.length > 120 ? '…' : ''}`);

  const firstChunk = u.chunks?.[0];
  if (firstChunk) {
    const loc = firstChunk.source.loc ? `〔${firstChunk.source.loc}〕` : '';
    lines.push(`引用${loc}：「${firstChunk.text.slice(0, 80).replace(/\s+/g, ' ')}…」`);
  }
  if (u.schema && typeof u.schema.format === 'string') {
    lines.push(`数据：${String(u.schema.format)}（已解析字段/结构）`);
  }
  return lines.length > 0 ? lines : ['（表征为空）'];
}

function finish(
  conn: AgentSideConnection,
  sessionId: string,
  reason: PromptResult['stopReason'],
): PromptResult {
  conn.sessionUpdate(sessionId, {
    type: 'log',
    level: reason === 'end_turn' ? 'info' : 'warn',
    text: reason === 'end_turn' ? '完成（mock）' : `已停止：${reason}`,
  });
  return { stopReason: reason };
}
