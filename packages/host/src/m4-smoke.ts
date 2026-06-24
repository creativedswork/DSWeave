/**
 * M4a 端到端冒烟：gltf + 文档 → 启发式 SceneSpec Agent → scene.html 能力 → 自包含 HTML 产物。
 *
 * 验证：
 *  1. 启发式 Agent 产出合法 SceneSpec（含模型 + 部件热点 + 面板），经审批后调用 Host 能力。
 *  2. Host 把 SceneSpec + gltf 资产 + 文档片段注入预构建 Player → 单文件 HTML 落盘。
 *  3. 产物经 HTTP 静态服务可取回，内含注入契约与 Player 运行时（保证可运行）。
 *  4. 二次运行命中产物缓存（cached）。
 * 前置：先构建 Player bundle（pnpm --filter @dsweave/player build）。运行：pnpm m4:smoke
 */
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { WebSocket } from 'ws';
import {
  DSWeaveAcpClient,
  type DSWeaveEvent,
  type UnderstandingNotification,
} from '@dsweave/protocol';
import type { FlowGraph } from '@dsweave/core';
import { startServer } from './server.js';
import { inProcessSceneAgentConnector } from './agent-manager.js';
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

const CSV = `name,age\nAlice,30\nBob,25\n`;

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

const graph: FlowGraph = {
  version: 1,
  id: 'flow_m4',
  name: 'M4 主竖切',
  nodes: [
    { id: 'n_gltf', kind: 'source', position: { x: 0, y: 0 }, label: 'car.gltf', file: { uri: 'car.gltf', mime: 'model/gltf+json', type: 'gltf', assets: [] } },
    { id: 'n_md', kind: 'source', position: { x: 0, y: 120 }, label: 'guide.md', file: { uri: 'guide.md', mime: 'text/markdown', type: 'md' } },
    { id: 'n_csv', kind: 'source', position: { x: 0, y: 240 }, label: 'users.csv', file: { uri: 'users.csv', mime: 'text/csv', type: 'data' } },
    { id: 'out', kind: 'output', position: { x: 320, y: 120 }, output: { typeId: 'scene.html', spec: '模型居中可旋转，把章节绑成部件热点，暗色主题' } },
  ],
  edges: [
    { id: 'e1', source: 'n_gltf', target: 'out', semantics: '模型作为主体可旋转' },
    { id: 'e2', source: 'n_md', target: 'out', semantics: '把安装说明绑成部件热点' },
    { id: 'e3', source: 'n_csv', target: 'out', semantics: '用户数据作为面板' },
  ],
};

function fail(msg: string): never {
  console.log(`\n❌ M4 SMOKE FAIL：${msg}`);
  process.exit(1);
}

const PORT = 8802;

async function runOnce(client: DSWeaveAcpClient): Promise<{ uri: string; logs: string[] }> {
  const logs: string[] = [];
  let uri = '';
  for await (const ev of client.run(graph) as AsyncIterable<DSWeaveEvent>) {
    if (ev.kind === 'log') logs.push(ev.text);
    if (ev.kind === 'permission-request') client.respondPermission(ev.id, true);
    if (ev.kind === 'artifact') uri = ev.uri;
    if (ev.kind === 'done') {
      if (ev.reason !== 'end_turn') fail(`异常结束：${ev.reason}（${logs.join(' | ')}）`);
      break;
    }
  }
  return { uri, logs };
}

async function main() {
  const playerDist = resolve(process.cwd(), 'packages/player/dist/index.html');
  if (!existsSync(playerDist)) {
    fail(`Player bundle 未构建：${playerDist}。请先运行 pnpm --filter @dsweave/player build`);
  }

  const workingDir = mkdtempSync(join(tmpdir(), 'dsweave-m4-'));
  const server = await startServer({
    port: PORT,
    workingDir,
    playerDistPath: playerDist,
    agentConnector: inProcessSceneAgentConnector,
    verbose: false,
  });

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });

  const understandings = new Map<string, UnderstandingNotification>();
  let waiter: (() => void) | null = null;
  const client = new DSWeaveAcpClient(new NodeWsTransport(ws), {
    onUnderstanding: (note) => {
      understandings.set(note.nodeId, note);
      if (understandings.size >= 3 && waiter) waiter();
    },
  });

  await client.newSession({ workingDir, capabilities: ['scene.html'] });

  const ready = new Promise<void>((res) => {
    waiter = res;
    if (understandings.size >= 3) res();
  });
  await client.registerFile({ nodeId: 'n_gltf', ref: graph.nodes[0]!.file!, content: b64(GLTF), assets: [] });
  await client.registerFile({ nodeId: 'n_md', ref: graph.nodes[1]!.file!, content: b64(MD) });
  await client.registerFile({ nodeId: 'n_csv', ref: graph.nodes[2]!.file!, content: b64(CSV) });
  await Promise.race([
    ready,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('理解超时')), 5000)),
  ]).catch((e: Error) => fail(e.message));

  // 第一次运行：产出产物
  const first = await runOnce(client);
  if (!first.uri.startsWith('/_artifacts/')) fail(`产物 uri 异常：${first.uri}`);
  if (!first.logs.some((l) => /SceneSpec 就绪/.test(l))) fail('Agent 未产出 SceneSpec');
  console.log('✓ Agent 产出 SceneSpec 并产出产物：', first.uri);

  // 经 HTTP 静态服务取回产物，校验注入契约与 Player 运行时
  const htmlRes = await fetch(`http://localhost:${PORT}${first.uri}`);
  if (!htmlRes.ok) fail(`产物 HTTP 取回失败：${htmlRes.status}`);
  const html = await htmlRes.text();
  if (!html.includes('__DSWEAVE_SCENE__')) fail('产物未注入 SceneSpec');
  if (!html.includes('__DSWEAVE_ASSETS__') || !html.includes('__DSWEAVE_CHUNKS__')) fail('产物未注入资产/片段');
  if (!html.includes('Body') || !html.includes('Wheel')) fail('SceneSpec 未把热点绑到模型部件');
  if (!html.includes('安装说明')) fail('文档片段未注入产物');
  if (!/<script/.test(html) || html.length < 20_000) fail('产物缺少 Player 运行时（bundle 过小）');
  console.log(`✓ 产物自包含可运行：${html.length} 字节，含注入契约 + Player bundle`);

  // 二次运行：命中产物缓存
  const second = await runOnce(client);
  if (second.uri !== first.uri) fail(`缓存命中应返回同一产物：${second.uri} != ${first.uri}`);
  if (!second.logs.some((l) => /命中缓存/.test(l))) fail('二次运行未命中产物缓存');
  console.log('✓ 二次运行命中产物缓存：', second.uri);

  client.close();
  ws.close();
  await server.close();

  console.log('\n✅ M4 SMOKE PASS：SceneSpec → scene.html 能力 → 自包含 3D HTML 产物 + 审批 + 缓存 全部通过');
  process.exit(0);
}

void main();
