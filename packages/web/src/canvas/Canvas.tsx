import { useCallback, useState, type DragEvent } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  useReactFlow,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { collectFromDataTransfer } from '../lib/files';
import { SourceNode } from './SourceNode';
import { OutputNode } from './OutputNode';
import { SemanticEdge } from './SemanticEdge';

const nodeTypes: NodeTypes = { source: SourceNode, output: OutputNode };
const edgeTypes: EdgeTypes = { semantic: SemanticEdge };

export function Canvas() {
  const rf = useReactFlow();
  const nodes = useDSWeaveStore((s) => s.nodes);
  const edges = useDSWeaveStore((s) => s.edges);
  const onNodesChange = useDSWeaveStore((s) => s.onNodesChange);
  const onEdgesChange = useDSWeaveStore((s) => s.onEdgesChange);
  const onConnect = useDSWeaveStore((s) => s.onConnect);
  const addIngested = useDSWeaveStore((s) => s.addIngested);
  const setEditingEdge = useDSWeaveStore((s) => s.setEditingEdge);

  const [dragOver, setDragOver] = useState(false);

  const onDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    setDragOver(true);
  }, []);

  const onDragLeave = useCallback((e: DragEvent) => {
    if (e.currentTarget === e.target) setDragOver(false);
  }, []);

  const onDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const position = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY });
      const items = await collectFromDataTransfer(e.dataTransfer);
      if (!items.length) return;
      const { warnings } = await addIngested(items, position);
      if (warnings.length) alert(warnings.join('\n'));
    },
    [rf, addIngested],
  );

  return (
    <div className="relative h-full w-full" onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(_, edge) => setEditingEdge(edge.id)}
        onPaneClick={() => setEditingEdge(null)}
        fitView
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: 'semantic' }}
        className="bg-neutral-900"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#27272a" />
        <Controls className="!border-neutral-700 !bg-neutral-900 [&_button]:!border-neutral-700 [&_button]:!bg-neutral-800 [&_button]:!fill-neutral-300" />
        <MiniMap
          pannable
          zoomable
          className="!bg-neutral-900"
          maskColor="rgba(0,0,0,0.6)"
          nodeColor={(n) => (n.type === 'output' ? '#d946ef' : '#0ea5e9')}
        />
      </ReactFlow>

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 z-20 m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-sky-500/70 bg-sky-500/5">
          <span className="rounded-lg bg-neutral-950/80 px-4 py-2 text-sm text-sky-300">
            松开以加入文件
          </span>
        </div>
      )}

      {nodes.length === 0 && !dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-neutral-600">
            <p className="text-sm">把文件拖到这里开始</p>
            <p className="mt-1 text-xs">gltf / md / pdf / txt / html / 图片 / csv·json</p>
          </div>
        </div>
      )}
    </div>
  );
}
