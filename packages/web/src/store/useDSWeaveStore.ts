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
  type FlowGraph,
  type FlowNode,
  type FlowEdge,
  type OutputSpec,
} from '@dsweave/core';
import type { DSNode, DSEdge, DSNodeData, SemanticEdgeData } from '../types';
import { isOutputData, isSourceData } from '../types';
import { ingestFiles } from '../lib/files';
import type { IngestedFile } from '../lib/gltf';

/** 运行时持有的 blob URL，工作流重置/加载时统一回收。 */
const liveObjectUrls = new Set<string>();
function trackUrls(urls: string[]): void {
  for (const u of urls) liveObjectUrls.add(u);
}
function revokeAllUrls(): void {
  for (const u of liveObjectUrls) URL.revokeObjectURL(u);
  liveObjectUrls.clear();
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
}

const STAGGER = 28;

export const useDSWeaveStore = create<DSWeaveState>((set, get) => ({
  flowId: uid('flow'),
  flowName: 'Untitled Flow',
  nodes: [],
  edges: [],
  editingEdgeId: null,

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
    });
  },

  exportJson: () => serialize(get().toFlowGraph()),
}));

/** 解析 .flow.json 文本（带校验）。 */
export function parseFlowJson(text: string): FlowGraph {
  return validateFlow(JSON.parse(text));
}
