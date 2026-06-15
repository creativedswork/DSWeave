/**
 * M3 端到端冒烟：Client → ws → Host 文件理解 → 上下文工程 → Mock Agent 引用/描述。
 *
 * 验证：
 *  1. 登记 gltf/md/csv → Host 异步回填 understanding（部件、大纲/分块/摘要、数据 schema）。
 *  2. 内容寻址缓存：同内容二次登记命中（cached=true）。
 *  3. run：Agent 收到带 understanding + context 的 prompt，日志含部件名与文档引用。
 * 运行：pnpm m3:smoke
 */
import { WebSocket } from 'ws';
import {
  DSWeaveAcpClient,
  type DSWeaveEvent,
  type UnderstandingNotification,
} from '@dsweave/protocol';
import type { FlowGraph } from '@dsweave/core';
import { startServer } from './server.js';
import { NodeWsTransport } from './ws-transport.js';

const GLTF = JSON.stringify({
  asset: { version: '2.0' },
  scenes: [{ nodes: [0, 1] }],
  nodes: [
    { name: 'Body', mesh: 0 },
    { name: 'Wheel', mesh: 1 },
  ],
  meshes: [
    { name: 'BodyMesh', primitives: [{ attributes: { POSITION: 0 } }] },
    { name: 'WheelMesh', primitives: [{ attributes: { POSITION: 1 } }] },
  ],
  materials: [{ name: 'Paint' }, { name: 'Rubber' }],
  animations: [{ name: 'Spin' }],
  accessors: [
    { min: [-1, -1, -1], max: [1, 1, 1] },
    { min: [-0.5, -0.5, -0.5], max: [0.5, 0.5, 0.5] },
  ],
});

const MD = `# 产品概述

这是一辆示例小车，核心部件包括车身与车轮。

## 安装说明

先固定车身，再装上车轮即可运行。
`;

const CSV = `name,age,active
Alice,30,true
Bob,25,false
Carol,28,true
`;

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

const graph: FlowGraph = {
  version: 1,
  id: 'flow_m3',
  name: 'M3 理解工作流',
  nodes: [
    { id: 'n_gltf', kind: 'source', position: { x: 0, y: 0 }, label: 'car.gltf', file: { uri: 'car.gltf', mime: 'model/gltf+json', type: 'gltf', assets: [] } },
    { id: 'n_md', kind: 'source', position: { x: 0, y: 120 }, label: 'guide.md', file: { uri: 'guide.md', mime: 'text/markdown', type: 'md' } },
    { id: 'n_csv', kind: 'source', position: { x: 0, y: 240 }, label: 'users.csv', file: { uri: 'users.csv', mime: 'text/csv', type: 'data' } },
    { id: 'out', kind: 'output', position: { x: 320, y: 120 }, output: { typeId: 'scene.html', spec: '把章节绑成车身/车轮部件热点' } },
  ],
  edges: [
    { id: 'e1', source: 'n_gltf', target: 'out', semantics: '模型作为主体可旋转' },
    { id: 'e2', source: 'n_md', target: 'out', semantics: '把安装说明绑成部件热点' },
    { id: 'e3', source: 'n_csv', target: 'out', semantics: '用户数据作为面板' },
  ],
};

function fail(msg: string): never {
  console.log(`\n❌ M3 SMOKE FAIL：${msg}`);
  process.exit(1);
}

async function main() {
  const server = await startServer({ port: 8801, verbose: false });
  const ws = new WebSocket('ws://localhost:8801');
  await new Promise<void>((resolve, reject) => {
    ws.on('open', () => resolve());
    ws.on('error', reject);
  });

  const understandings = new Map<string, UnderstandingNotification>();
  let waiter: (() => void) | null = null;
  const client = new DSWeaveAcpClient(new NodeWsTransport(ws), {
    onUnderstanding: (note) => {
      understandings.set(note.nodeId, note);
      if (understandings.size >= 3 && waiter) waiter();
    },
  });

  await client.newSession({ workingDir: '.', capabilities: ['scene.html'] });

  // 1) 登记三个文件，触发理解
  const ready = new Promise<void>((resolve) => {
    waiter = resolve;
    if (understandings.size >= 3) resolve();
  });
  const r1 = await client.registerFile({ nodeId: 'n_gltf', ref: graph.nodes[0]!.file!, content: b64(GLTF), assets: [] });
  await client.registerFile({ nodeId: 'n_md', ref: graph.nodes[1]!.file!, content: b64(MD) });
  await client.registerFile({ nodeId: 'n_csv', ref: graph.nodes[2]!.file!, content: b64(CSV) });
  if (r1.cached) fail('首次登记不应命中缓存');

  await Promise.race([
    ready,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('理解超时')), 5000)),
  ]).catch((e: Error) => fail(e.message));

  // 校验 gltf 部件
  const g = understandings.get('n_gltf')!.understanding;
  const parts = (g.model?.nodes ?? []).map((n) => n.name);
  if (!parts.includes('Body') || !parts.includes('Wheel')) fail(`gltf 部件解析错误：${parts.join(',')}`);
  if (!g.captions?.[0]?.includes('部件')) fail('gltf 外观 caption 缺失');
  if (!g.model?.materials?.includes('Paint')) fail('gltf 材质解析错误');
  console.log('✓ gltf：部件', parts.join('、'), '| bbox', JSON.stringify(g.model?.bbox));

  // 校验 md 大纲/分块/摘要
  const md = understandings.get('n_md')!.understanding;
  if (!md.outline?.some((o) => o.title === '安装说明')) fail('md 大纲缺失');
  if (!md.chunks || md.chunks.length === 0) fail('md 未分块');
  if (!md.chunks.some((c) => c.source.loc === '安装说明')) fail('md 分块缺少来源 loc');
  if (!md.summary) fail('md 缺少摘要');
  console.log('✓ md：大纲', md.outline?.map((o) => o.title).join('/'), '| 分块', md.chunks.length);

  // 校验 csv schema
  const csv = understandings.get('n_csv')!.understanding;
  if (csv.schema?.format !== 'csv') fail('csv schema 缺失');
  console.log('✓ csv：', csv.summary);

  // 2) 内容寻址缓存：同内容二次登记应命中
  const again = await client.registerFile({ nodeId: 'n_md', ref: graph.nodes[1]!.file!, content: b64(MD) });
  if (!again.cached) fail('同内容二次登记应命中缓存');
  console.log('✓ 缓存命中：md 二次登记 cached=true');

  // 3) run：Agent 应拿到 understanding + context，并在日志中引用/描述
  const logs: string[] = [];
  let sawArtifact = false;
  let doneReason = '';
  for await (const ev of client.run(graph) as AsyncIterable<DSWeaveEvent>) {
    if (ev.kind === 'log') logs.push(ev.text);
    if (ev.kind === 'artifact') sawArtifact = true;
    if (ev.kind === 'done') {
      doneReason = ev.reason;
      break;
    }
  }
  const joined = logs.join('\n');
  if (!/上下文（(full|topk)）/.test(joined)) fail('Agent 未收到 context');
  if (!joined.includes('Body') || !joined.includes('Wheel')) fail('Agent 日志未描述模型部件');
  if (!/引用/.test(joined)) fail('Agent 日志未体现文档引用');
  if (!sawArtifact) fail('未产出产物');
  if (doneReason !== 'end_turn') fail(`异常结束：${doneReason}`);

  client.close();
  ws.close();
  await server.close();

  console.log('\n✅ M3 SMOKE PASS：文件理解 + 上下文工程 + 缓存 + Agent 引用/描述 全部通过');
  process.exit(0);
}

void main();
