import { create } from 'zustand';
import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type NodeChange,
  type EdgeChange,
  type Connection,
  type XYPosition,
} from '@xyflow/react';
import {
  serialize,
  validateFlow,
  type ExecStatus,
  type FlowGraph,
  type FlowNode,
  type FlowEdge,
  type OutputSpec,
} from '@dsweave/core';
import type { DSWeaveAcpClient, DSWeaveEvent, ToolCallState } from '@dsweave/protocol';
import type { DSNode, DSEdge, DSNodeData, SemanticEdgeData } from '../types';
import { isOutputData, isSourceData } from '../types';
import { ingestFiles } from '../lib/files';
import type { IngestedFile } from '../lib/gltf';
import { getClient } from '../acp/connect';

/** Host 能力清单（前端镜像，约束与展示用）。 */
const CAPABILITIES = ['scene.html', 'report.html', 'gltf.render', 'fs.write'];

export interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  text: string;
  ts: number;
}

export interface ToolCard {
  id: string;
  title: string;
  state: ToolCallState;
}

export interface ArtifactEntry {
  uri: string;
  mime: string;
  fromNodeId?: string;
}

/** 运行时持有的 blob URL，工作流重置/加载时统一回收。 */
const liveObjectUrls = new Set<string>();
function trackUrls(urls: string[]): void {
  for (const u of urls) liveObjectUrls.add(u);
}
function revokeAllUrls(): void {
  for (const u of liveObjectUrls) URL.revokeObjectURL(u);
  liveObjectUrls.clear();
}

/** 当前活动的 ACP 客户端（用于 cancel）。 */
let activeClient: DSWeaveAcpClient | null = null;
let logSeq = 0;

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function uid(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${rand}`;
}

interface DSWeaveState {
  flowId: string;
  flowName: string;
  nodes: DSNode[];
  edges: DSEdge[];
  /** 当前选中用于编辑的边 id（驱动 EdgeEditor）。 */
  editingEdgeId: string | null;

  // ---- 运行时态（执行 ACP 时回填）----
  running: boolean;
  /** nodeId / edgeId → 执行状态。 */
  runtime: Record<string, ExecStatus>;
  logs: LogEntry[];
  toolCalls: ToolCard[];
  artifacts: ArtifactEntry[];
  runError: string | null;

  setFlowName: (name: string) => void;
  onNodesChange: (changes: NodeChange<DSNode>[]) => void;
  onEdgesChange: (changes: EdgeChange<DSEdge>[]) => void;
  onConnect: (connection: Connection) => void;

  addIngested: (items: IngestedFile[], at: XYPosition) => Promise<{ warnings: string[] }>;
  addOutputNode: (at: XYPosition) => void;
  updateNodeData: (id: string, patch: Partial<DSNodeData>) => void;
  updateOutput: (id: string, patch: Partial<OutputSpec>) => void;
  updateEdgeData: (id: string, patch: Partial<SemanticEdgeData>) => void;
  removeEdge: (id: string) => void;
  setEditingEdge: (id: string | null) => void;

  newFlow: () => void;
  toFlowGraph: () => FlowGraph;
  loadFlowGraph: (graph: FlowGraph) => void;
  exportJson: () => string;

  // ---- 执行 ----
  start: () => Promise<void>;
  cancel: () => void;
  clearRun: () => void;
}

const STAGGER = 28;

export const useDSWeaveStore = create<DSWeaveState>((set, get) => ({
  flowId: uid('flow'),
  flowName: 'Untitled Flow',
  nodes: [],
  edges: [],
  editingEdgeId: null,

  running: false,
  runtime: {},
  logs: [],
  toolCalls: [],
  artifacts: [],
  runError: null,

  setFlowName: (name) => set({ flowName: name }),

  onNodesChange: (changes) =>
    set((s) => ({ nodes: applyNodeChanges(changes, s.nodes) })),

  onEdgesChange: (changes) =>
    set((s) => ({ edges: applyEdgeChanges(changes, s.edges) })),

  onConnect: (connection) =>
    set((s) => {
      const id = uid('edge');
      const edge: DSEdge = {
        id,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
        type: 'semantic',
        data: { semantics: '' },
      };
      return { edges: addEdge(edge, s.edges), editingEdgeId: id };
    }),

  addIngested: async (items, at) => {
    const specs = await ingestFiles(items);
    const warnings: string[] = [];
    set((s) => {
      const newNodes: DSNode[] = specs.map((spec, i) => {
        trackUrls(spec.objectUrls);
        if (spec.warning) warnings.push(`${spec.label}：${spec.warning}`);
        return {
          id: uid('node'),
          type: 'source',
          position: { x: at.x + i * STAGGER, y: at.y + i * STAGGER },
          data: {
            kind: 'source',
            label: spec.label,
            file: spec.file,
            previewUrl: spec.previewUrl,
            previewText: spec.previewText,
            warning: spec.warning,
          },
        };
      });
      return { nodes: [...s.nodes, ...newNodes] };
    });
    return { warnings };
  },

  addOutputNode: (at) =>
    set((s) => {
      const node: DSNode = {
        id: uid('out'),
        type: 'output',
        position: at,
        data: {
          kind: 'output',
          output: { typeId: 'scene.html', spec: '' },
        },
      };
      return { nodes: [...s.nodes, node] };
    }),

  updateNodeData: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } as DSNodeData } : n,
      ),
    })),

  updateOutput: (id, patch) =>
    set((s) => ({
      nodes: s.nodes.map((n) => {
        if (n.id !== id || !isOutputData(n.data)) return n;
        return { ...n, data: { ...n.data, output: { ...n.data.output, ...patch } } };
      }),
    })),

  updateEdgeData: (id, patch) =>
    set((s) => ({
      edges: s.edges.map((e) =>
        e.id === id ? { ...e, data: { ...(e.data ?? { semantics: '' }), ...patch } } : e,
      ),
    })),

  removeEdge: (id) =>
    set((s) => ({
      edges: s.edges.filter((e) => e.id !== id),
      editingEdgeId: s.editingEdgeId === id ? null : s.editingEdgeId,
    })),

  setEditingEdge: (id) => set({ editingEdgeId: id }),

  newFlow: () => {
    revokeAllUrls();
    set({
      flowId: uid('flow'),
      flowName: 'Untitled Flow',
      nodes: [],
      edges: [],
      editingEdgeId: null,
      runtime: {},
      logs: [],
      toolCalls: [],
      artifacts: [],
      runError: null,
    });
  },

  toFlowGraph: () => {
    const { flowId, flowName, nodes, edges } = get();
    const flowNodes: FlowNode[] = nodes.map((n) => {
      if (isSourceData(n.data)) {
        return {
          id: n.id,
          kind: 'source',
          position: n.position,
          label: n.data.label,
          file: n.data.file,
        };
      }
      const out = n.data as Extract<DSNodeData, { kind: 'output' }>;
      return {
        id: n.id,
        kind: 'output',
        position: n.position,
        output: out.output,
      };
    });
    const flowEdges: FlowEdge[] = edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      semantics: e.data?.semantics ?? '',
      params: e.data?.params,
    }));
    const now = new Date().toISOString();
    return {
      version: 1,
      id: flowId,
      name: flowName,
      nodes: flowNodes,
      edges: flowEdges,
      meta: { createdAt: now, updatedAt: now },
    };
  },

  loadFlowGraph: (graph) => {
    revokeAllUrls();
    const nodes: DSNode[] = graph.nodes.map((n) => {
      if (n.kind === 'source') {
        return {
          id: n.id,
          type: 'source',
          position: n.position,
          data: {
            kind: 'source',
            label: n.label ?? n.file?.uri ?? 'file',
            file: n.file!,
          },
        };
      }
      return {
        id: n.id,
        type: 'output',
        position: n.position,
        data: {
          kind: 'output',
          output: n.output ?? { typeId: 'scene.html', spec: '' },
        },
      };
    });
    const edges: DSEdge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      type: 'semantic',
      data: { semantics: e.semantics, params: e.params },
    }));
    set({
      flowId: graph.id,
      flowName: graph.name,
      nodes,
      edges,
      editingEdgeId: null,
      runtime: {},
      logs: [],
      toolCalls: [],
      artifacts: [],
      runError: null,
    });
  },

  exportJson: () => serialize(get().toFlowGraph()),

  clearRun: () =>
    set({ runtime: {}, logs: [], toolCalls: [], artifacts: [], runError: null }),

  cancel: () => {
    activeClient?.cancel();
    set((s) => ({
      logs: [...s.logs, { id: ++logSeq, level: 'warn', text: '已请求取消…', ts: Date.now() }],
    }));
  },

  start: async () => {
    if (get().running) return;
    if (get().nodes.length === 0) {
      set({ runError: '画布为空：先拖入文件并添加一个输出节点。' });
      return;
    }

    const log = (level: LogEntry['level'], text: string) =>
      set((s) => ({ logs: [...s.logs, { id: ++logSeq, level, text, ts: Date.now() }] }));

    set({ running: true, runtime: {}, logs: [], toolCalls: [], artifacts: [], runError: null });

    let client: DSWeaveAcpClient;
    try {
      client = await getClient();
    } catch (err) {
      log('error', errText(err));
      set({ running: false, runError: errText(err) });
      return;
    }
    activeClient = client;

    try {
      await client.newSession({ workingDir: '.', capabilities: CAPABILITIES });
      const graph = get().toFlowGraph();
      for await (const ev of client.run(graph)) {
        applyEvent(set, client, ev);
        if (ev.kind === 'done') break;
      }
    } catch (err) {
      log('error', errText(err));
      set({ runError: errText(err) });
    } finally {
      activeClient = null;
      set({ running: false });
    }
  },
}));

type SetState = (
  partial:
    | Partial<DSWeaveState>
    | ((state: DSWeaveState) => Partial<DSWeaveState>),
) => void;

/** 把一个 DSWeaveEvent 应用到 store。 */
function applyEvent(set: SetState, client: DSWeaveAcpClient, ev: DSWeaveEvent): void {
  const pushLog = (level: LogEntry['level'], text: string) =>
    set((s) => ({ logs: [...s.logs, { id: ++logSeq, level, text, ts: Date.now() }] }));

  switch (ev.kind) {
    case 'node-status':
      set((s) => ({ runtime: { ...s.runtime, [ev.nodeId]: ev.status } }));
      if (ev.message) pushLog('info', `${ev.nodeId}：${ev.message}`);
      break;
    case 'edge-status':
      set((s) => ({ runtime: { ...s.runtime, [ev.edgeId]: ev.status } }));
      break;
    case 'tool-call':
      set((s) => {
        const card: ToolCard = { id: ev.id, title: ev.title, state: ev.state };
        const exists = s.toolCalls.some((t) => t.id === ev.id);
        return {
          toolCalls: exists
            ? s.toolCalls.map((t) => (t.id === ev.id ? card : t))
            : [...s.toolCalls, card],
        };
      });
      break;
    case 'log':
      pushLog(ev.level, ev.text);
      break;
    case 'artifact':
      set((s) => ({
        artifacts: [...s.artifacts, { uri: ev.uri, mime: ev.mime, fromNodeId: ev.fromNodeId }],
      }));
      pushLog('info', `产物：${ev.uri}`);
      break;
    case 'permission-request':
      // M2：自动放行（M4 接入 PermissionDialog 审批）。
      pushLog('warn', `授权请求：${ev.summary}（M2 自动放行）`);
      client.respondPermission(ev.id, true);
      break;
    case 'done':
      pushLog(ev.reason === 'end_turn' ? 'info' : 'warn', `结束：${ev.reason}`);
      break;
  }
}

/** 解析 .flow.json 文本（带校验）。 */
export function parseFlowJson(text: string): FlowGraph {
  return validateFlow(JSON.parse(text));
}
