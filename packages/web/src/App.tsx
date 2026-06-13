import { serialize, type FlowGraph } from '@dsweave/core';

const emptyGraph: FlowGraph = {
  version: 1,
  id: 'demo',
  name: 'Untitled Flow',
  nodes: [],
  edges: [],
};

export function App() {
  return (
    <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
      <header className="flex items-center gap-3 border-b border-neutral-800 px-4 py-3">
        <span className="text-lg font-semibold tracking-tight">DSWeave</span>
        <span className="text-xs text-neutral-500">空间化知识引擎 · M0 骨架</span>
      </header>
      <main className="flex flex-1 items-center justify-center">
        <div className="text-center text-neutral-400">
          <p className="mb-2 text-sm">画布将在 M1 接入（React Flow）。</p>
          <p className="text-xs text-neutral-600">
            core 已就绪：当前空工作流 {emptyGraph.nodes.length} 节点 / {emptyGraph.edges.length} 边
          </p>
          <pre className="mt-4 max-w-md overflow-auto rounded bg-neutral-900 p-3 text-left text-[11px] text-neutral-500">
            {serialize(emptyGraph)}
          </pre>
        </div>
      </main>
    </div>
  );
}
