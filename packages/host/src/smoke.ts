/**
 * M2 端到端冒烟：前端 Client → ws → Host 中继 → 进程内 Mock Agent。
 * 运行：pnpm --filter @dsweave/host exec tsx src/smoke.ts
 */
import { WebSocket } from 'ws';
import { DSWeaveAcpClient, type DSWeaveEvent } from '@dsweave/protocol';
import type { FlowGraph } from '@dsweave/core';
import { startServer } from './server.js';
import { NodeWsTransport } from './ws-transport.js';

const graph: FlowGraph = {
  version: 1,
  id: 'flow_smoke',
  name: '冒烟工作流',
  nodes: [
    { id: 'n1', kind: 'source', position: { x: 0, y: 0 }, label: 'model.glb', file: { uri: 'model.glb', mime: 'model/gltf-binary', type: 'gltf' } },
    { id: 'n2', kind: 'source', position: { x: 0, y: 100 }, label: 'intro.md', file: { uri: 'intro.md', mime: 'text/markdown', type: 'md' } },
    { id: 'out', kind: 'output', position: { x: 300, y: 50 }, output: { typeId: 'scene.html', spec: '模型居中，章节绑成热点' } },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'out', semantics: '把模型作为主体' },
    { id: 'e2', source: 'n2', target: 'out', semantics: '把文档绑成部件热点' },
  ],
};

async function main() {
  const server = await startServer({ port: 8799, verbose: false });
  const ws = new WebSocket('ws://localhost:8799');
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  const client = new DSWeaveAcpClient(new NodeWsTransport(ws));
  const sessionId = await client.newSession({ workingDir: '.', capabilities: ['scene.html'] });
  console.log('session:', sessionId);

  const events: DSWeaveEvent[] = [];
  for await (const ev of client.run(graph)) {
    events.push(ev);
    console.log('event:', JSON.stringify(ev));
    if (ev.kind === 'done') break;
  }

  const nodeDone = new Set(
    events.filter((e) => e.kind === 'node-status' && e.status === 'done').map((e) => (e as { nodeId: string }).nodeId),
  );
  const ok =
    nodeDone.has('n1') &&
    nodeDone.has('n2') &&
    nodeDone.has('out') &&
    events.some((e) => e.kind === 'artifact') &&
    events.some((e) => e.kind === 'done' && e.reason === 'end_turn');

  client.close();
  ws.close();
  await server.close();

  console.log(ok ? '\n✅ SMOKE PASS：节点 running→done，产物与 done 均收到' : '\n❌ SMOKE FAIL');
  process.exit(ok ? 0 : 1);
}

void main();
