import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './panels/Toolbar';
import { EdgeEditor } from './panels/EdgeEditor';
import { ExecutionPanel } from './panels/ExecutionPanel';
import { LogTimeline } from './panels/LogTimeline';

export function App() {
  return (
    <ReactFlowProvider>
      <div className="flex h-full flex-col bg-neutral-950 text-neutral-100">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            <Canvas />
            <EdgeEditor />
          </main>
          <ExecutionPanel />
        </div>
        <LogTimeline />
      </div>
    </ReactFlowProvider>
  );
}
