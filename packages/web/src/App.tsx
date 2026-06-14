import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './panels/Toolbar';
import { EdgeEditor } from './panels/EdgeEditor';

export function App() {
  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
        <Toolbar />
        <main className="relative flex-1">
          <Canvas />
          <EdgeEditor />
        </main>
      </div>
    </ReactFlowProvider>
  );
}
