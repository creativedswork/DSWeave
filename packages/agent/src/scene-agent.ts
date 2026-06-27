/**
 * 启发式 SceneSpec Agent（M4a）：收到 prompt → 理解源/连线 → 产出合法 SceneSpec
 * → request_permission → 调用 Host 的 scene.html 能力产出自包含 HTML → done。
 *
 * 这是「确定性、无 LLM」的可插拔 Agent：走与真实 Agent 完全相同的内部链路
 * （SceneSpec 契约 + capability/invoke + 权限流），让主竖切分步可验。
 */
import {
  AgentSideConnection,
  type AcpTransport,
  type CancelParams,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
  type HtmlPageInput,
} from '@dsweave/protocol';
import { buildHtml } from './html-builder.js';
import { capabilityForOutput } from './tools/index.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let sessionSeq = 0;

/** 创建一个启发式 SceneSpec Agent 连接。 */
export function createSceneAgent(transport: AcpTransport): AgentSideConnection {
  const cancelled = new Set<string>();
  return new AgentSideConnection(transport, {
    onNewSession(_p: NewSessionParams): NewSessionResult {
      return { sessionId: `scene_${++sessionSeq}` };
    },
    onCancel(p: CancelParams): void {
      cancelled.add(p.sessionId);
    },
    onPrompt(p: PromptParams, conn: AgentSideConnection): Promise<PromptResult> {
      return run(p, conn, cancelled);
    },
  });
}

async function run(
  params: PromptParams,
  conn: AgentSideConnection,
  cancelled: Set<string>,
): Promise<PromptResult> {
  const { sessionId, prompt } = params;
  const graph = prompt.graph;
  const isCancelled = () => cancelled.has(sessionId);
  const log = (text: string, level: 'info' | 'warn' | 'error' = 'info') =>
    conn.sessionUpdate(sessionId, { type: 'log', level, text });

  log(`收到工作流「${graph.name}」：${graph.nodes.length} 节点 / ${graph.edges.length} 连线`);

  // 1) 理解源节点
  const sources = graph.nodes.filter((n) => n.kind === 'source');
  for (const node of sources) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'running' });
    await sleep(60);
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: node.id,
      status: 'done',
      message: node.understanding?.ready ? '已理解' : '已登记',
    });
  }

  // 2) 连线生效
  for (const edge of graph.edges) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    conn.sessionUpdate(sessionId, { type: 'edge-status', edgeId: edge.id, status: 'running' });
    await sleep(40);
    conn.sessionUpdate(sessionId, { type: 'edge-status', edgeId: edge.id, status: 'done' });
  }

  // 3) 逐个输出节点：产出 SceneSpec → 校验 → 审批 → 调用能力产出
  const outputs = graph.nodes.filter((n) => n.kind === 'output');
  for (const node of outputs) {
    if (isCancelled()) return finish(conn, sessionId, 'cancelled');
    const typeId = node.output?.typeId ?? 'scene.html';
    const capability = capabilityForOutput(typeId);
    const toolId = `tool_${node.id}`;

    conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'running' });

    const html = buildHtml(graph, node.output?.spec ?? '');
    log(`HTML 就绪：${html.length} 字符`);

    // 审批：写入产物属危险操作。
    const allowed = await conn.requestPermission(
      sessionId,
      `产出 ${typeId}：把 HTML 注入运行时并写入产物文件`,
      ['允许', '拒绝'],
    );
    if (!allowed) {
      conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'error', message: '用户拒绝授权' });
      log('用户拒绝授权，跳过产出', 'warn');
      continue;
    }

    conn.sessionUpdate(sessionId, { type: 'tool-call', id: toolId, title: `${capability}`, state: 'running', nodeId: node.id });
    try {
      const input: HtmlPageInput = { html };
      const res = await conn.invokeCapability({ sessionId, capability, outputNodeId: node.id, input });
      conn.sessionUpdate(sessionId, { type: 'tool-call', id: toolId, title: `${capability}`, state: 'done', nodeId: node.id });
      conn.sessionUpdate(sessionId, {
        type: 'artifact',
        uri: res.artifact.uri,
        mime: res.artifact.mime,
        fromNodeId: node.id,
      });
      log(res.cached ? `产物命中缓存：${res.artifact.uri}` : `产物已生成：${res.artifact.uri}（${res.artifact.bytes} 字节）`);
      conn.sessionUpdate(sessionId, {
        type: 'node-status',
        nodeId: node.id,
        status: 'done',
        message: res.cached ? '产物已就绪（缓存）' : '产物已生成',
      });
    } catch (err) {
      conn.sessionUpdate(sessionId, { type: 'tool-call', id: toolId, title: `${capability}`, state: 'error', nodeId: node.id });
      conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: node.id, status: 'error', message: '产出失败' });
      log(`能力调用失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      return finish(conn, sessionId, 'error');
    }
  }

  return finish(conn, sessionId, 'end_turn');
}

function finish(
  conn: AgentSideConnection,
  sessionId: string,
  reason: PromptResult['stopReason'],
): PromptResult {
  conn.sessionUpdate(sessionId, {
    type: 'log',
    level: reason === 'end_turn' ? 'info' : 'warn',
    text: reason === 'end_turn' ? '完成' : `已停止：${reason}`,
  });
  return { stopReason: reason };
}
