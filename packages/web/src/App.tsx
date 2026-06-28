import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from './canvas/Canvas';
import { Toolbar } from './panels/Toolbar';
import { EdgeEditor } from './panels/EdgeEditor';
import { Inspector } from './panels/Inspector';
import { ExecutionPanel } from './panels/ExecutionPanel';
import { LogTimeline } from './panels/LogTimeline';
import { PermissionDialog } from './panels/PermissionDialog';
import { ArtifactViewer } from './panels/ArtifactViewer';
import { SkillsDrawer } from './panels/SkillsDrawer';

export function App() {
  return (
    <ReactFlowProvider>
      <div className="relative flex h-full flex-col bg-neutral-950 text-neutral-100">
        <Toolbar />
        <div className="flex min-h-0 flex-1">
          <main className="relative min-w-0 flex-1">
            <Canvas />
            <Inspector />
            <EdgeEditor />
          </main>
          <ExecutionPanel />
        </div>
        <LogTimeline />
        <PermissionDialog />
        <ArtifactViewer />
        <SkillsDrawer />
      </div>
    </ReactFlowProvider>
  );
}
