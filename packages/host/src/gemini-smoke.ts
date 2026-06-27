/**
 * Gemini ACP 后端端到端冒烟（无真实模型）：与 m4b-smoke 同构，但走 inProcessGeminiAgentConnector。
 *
 * 用「假 ACP Agent」替身（agent 中立，说官方 ACP，复用 claude/fake-adapter.js）验证 Gemini 后端全链路：
 *   Host(官方 ACP client) → spawn 假 adapter（说官方 ACP）→ prompt turn（update/permission 透传）
 *   → 假 adapter 写 scene.spec.json → Host 读盘 + zod 校验 → scene.html 能力 → 自包含 HTML 产物。
 *
 * 这证明：新增 Gemini 后端不改前端 / 内部协议 / bridge / 能力，与 Claude 后端同构、可热插拔。
 * 前置：先构建 Player bundle 与 host。运行：pnpm gemini:smoke
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
import { inProcessGeminiAgentConnector } from './agent-manager.js';
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

const MD = `# 产品概述\n\n这是一辆示例小车，核心部件包括车身与车轮。\n\n## 安装说明\n\n先固定车身，再装上车轮即可运行。\n`;

// 最小合法 PNG（1x1，用于走通图片资产收集与渲染链路）。
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==',
  'base64',
);

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');
const b64b = (b: Buffer) => b.toString('base64');

const graph: FlowGraph = {
  version: 1,
  id: 'flow_gemini',
  name: 'Gemini 主竖切',
  nodes: [
    { id: 'n_gltf', kind: 'source', position: { x: 0, y: 0 }, label: 'car.gltf', file: { uri: 'car.gltf', mime: 'model/gltf+json', type: 'gltf', assets: [] } },
    { id: 'n_md', kind: 'source', position: { x: 0, y: 120 }, label: 'guide.md', file: { uri: 'guide.md', mime: 'text/markdown', type: 'md' } },
    { id: 'n_img', kind: 'source', position: { x: 0, y: 240 }, label: 'thumb.png', file: { uri: 'thumb.png', mime: 'image/png', type: 'image' } },
    { id: 'out', kind: 'output', position: { x: 320, y: 60 }, output: { typeId: 'scene.html', spec: '图片在左、模型在右，箭头从图片指向模型标注“生成”' } },
  ],
  edges: [
    { id: 'e1', source: 'n_gltf', target: 'out', semantics: '模型作为主体可旋转' },
    { id: 'e2', source: 'n_md', target: 'out', semantics: '把安装说明绑成部件热点' },
    { id: 'e3', source: 'n_img', target: 'out', semantics: '图片在左，箭头从图片指向模型，标注“生成”' },
  ],
};

function fail(msg: string): never {
  console.log(`\n❌ GEMINI SMOKE FAIL：${msg}`);
  process.exit(1);
}

const PORT = 8804;

async function runOnce(client: DSWeaveAcpClient): Promise<{ uri: string; logs: string[]; perms: number }> {
  const logs: string[] = [];
  let uri = '';
  let perms = 0;
  for await (const ev of client.run(graph) as AsyncIterable<DSWeaveEvent>) {
    if (ev.kind === 'log') logs.push(ev.text);
    if (ev.kind === 'permission-request') {
      perms++;
      client.respondPermission(ev.id, true);
    }
    if (ev.kind === 'artifact') uri = ev.uri;
    if (ev.kind === 'done') {
      if (ev.reason !== 'end_turn') fail(`异常结束：${ev.reason}（${logs.join(' | ')}）`);
      break;
    }
  }
  return { uri, logs, perms };
}

async function main() {
  const playerDist = resolve(process.cwd(), 'packages/player/dist/index.html');
  if (!existsSync(playerDist)) fail(`Player bundle 未构建：${playerDist}`);

  // 假 adapter 与 agent 无关（说官方 ACP），复用 Claude 后端的替身即可验证 Gemini 后端链路。
  const fakeAdapter = resolve(process.cwd(), 'packages/host/dist/claude/fake-adapter.js');
  if (!existsSync(fakeAdapter)) fail(`假 adapter 未构建：${fakeAdapter}（先 pnpm --filter @dsweave/host build）`);

  const workingDir = mkdtempSync(join(tmpdir(), 'dsweave-gemini-'));
  const server = await startServer({
    port: PORT,
    workingDir,
    playerDistPath: playerDist,
    // Gemini 连接器，但 adapter 指向假替身（说官方 ACP），无需真实模型/外网。
    agentConnector: inProcessGeminiAgentConnector({ command: 'node', args: [fakeAdapter] }),
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
  await client.registerFile({ nodeId: 'n_img', ref: graph.nodes[2]!.file!, content: b64b(PNG_BYTES) });
  await Promise.race([
    ready,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('理解超时')), 5000)),
  ]).catch((e: Error) => fail(e.message));

  // 第一次运行：经官方 ACP 假替身产出产物
  const first = await runOnce(client);
  if (!first.uri.startsWith('/_artifacts/')) fail(`产物 uri 异常：${first.uri}`);
  if (first.perms < 1) fail('未收到来自官方 ACP 的权限请求（permission 翻译缺失）');
  if (!first.logs.some((l) => /SceneSpec 就绪/.test(l))) fail('未完成 scene.spec.json 读取/校验');
  if (!first.logs.some((l) => /Gemini/.test(l))) fail('日志未体现 Gemini 后端（label 未生效）');
  console.log('✓ Gemini 后端 → 官方 ACP 假替身 → scene.spec.json → 校验 → 产物：', first.uri, `（权限请求 ${first.perms} 次）`);

  // 取回产物，校验注入契约 + 模型部件 + 文档片段 + Player 运行时
  const html = await (await fetch(`http://localhost:${PORT}${first.uri}`)).text();
  if (!html.includes('__DSWEAVE_SCENE__')) fail('产物未注入 SceneSpec');
  if (!html.includes('__DSWEAVE_ASSETS__') || !html.includes('__DSWEAVE_CHUNKS__')) fail('产物未注入资产/片段');
  if (!html.includes('Body')) fail('SceneSpec 未把热点绑到模型部件');
  if (!html.includes('安装说明')) fail('文档片段未注入产物');
  if (!html.includes('data:image/png')) fail('图片资产未注入产物（images 链路缺失）');
  if (!html.includes('"connectors"') || !html.includes('生成')) fail('连接器/标注未注入产物（connectors 链路缺失）');
  if (!html.includes('"images"')) fail('images 字段未注入产物');
  if (!/<script/.test(html) || html.length < 20_000) fail('产物缺少 Player 运行时');
  console.log(`✓ 产物自包含可运行：${html.length} 字节，含部件热点 + 文档 + 图片平面 + 箭头标注 + Player bundle`);

  // 二次运行：命中产物缓存
  const second = await runOnce(client);
  if (second.uri !== first.uri) fail(`缓存命中应返回同一产物：${second.uri} != ${first.uri}`);
  if (!second.logs.some((l) => /命中缓存/.test(l))) fail('二次运行未命中产物缓存');
  console.log('✓ 二次运行命中产物缓存：', second.uri);

  client.close();
  ws.close();
  await server.close();

  console.log('\n✅ GEMINI SMOKE PASS：Gemini 后端官方 ACP client + bridge + scene.spec.json 收口 + 能力出物 + 权限 + 缓存 全部通过（与 Claude 后端同构、前端零改动）');
  process.exit(0);
}

void main();
