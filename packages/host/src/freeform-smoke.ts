/**
 * Freeform 端到端冒烟：用「假 ACP Agent」替身验证自由 HTML 全链路：
 *   Host(官方 ACP client) → spawn 假 adapter（说官方 ACP）→ prompt turn（update/permission 透传）
 *   → 假 adapter 写 index.html → Host 读盘 + 文本校验 → scene.html 能力（注入 model-viewer 运行时
 *   + 内联 asset:// 为 data URI）→ 自包含 HTML 产物。
 *
 * Agent 直接交付自由 HTML（不依赖预构建 Player / 数据 schema）。
 * 运行：pnpm freeform:smoke
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
import { inProcessClaudeAgentConnector } from './agent-manager.js';
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

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

const graph: FlowGraph = {
  version: 1,
  id: 'flow_freeform',
  name: 'Freeform 自由 HTML 竖切',
  nodes: [
    {
      id: 'n_gltf',
      kind: 'source',
      position: { x: 0, y: 0 },
      label: 'car.gltf',
      file: { uri: 'car.gltf', mime: 'model/gltf+json', type: 'gltf', assets: [] },
    },
    {
      id: 'out',
      kind: 'output',
      position: { x: 320, y: 0 },
      output: { typeId: 'scene.html', spec: '以模型为主视觉，配一段长说明' },
    },
  ],
  edges: [{ id: 'e1', source: 'n_gltf', target: 'out', semantics: '生成一段不少于 500 字的模型说明' }],
};

function fail(msg: string): never {
  console.log(`\n❌ FREEFORM SMOKE FAIL：${msg}`);
  process.exit(1);
}

const PORT = 8807;

async function runOnce(
  client: DSWeaveAcpClient,
): Promise<{ uri: string; logs: string[]; perms: number }> {
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

/** 提取 <section>…</section> 内的纯文本（无标签）；缺失时退化为整页去标签。 */
function extractProse(html: string): string {
  const m = html.match(/<section[\s\S]*?>([\s\S]*?)<\/section>/i);
  const inner = m?.[1] ?? html;
  return inner.replace(/<[^>]+>/g, '').trim();
}

async function main() {
  const fakeAdapter = resolve(process.cwd(), 'packages/host/dist/claude/fake-adapter.js');
  if (!existsSync(fakeAdapter)) {
    fail(`假 adapter 未构建：${fakeAdapter}（先 pnpm --filter @dsweave/host build）`);
  }

  const workingDir = mkdtempSync(join(tmpdir(), 'dsweave-freeform-'));
  const server = await startServer({
    port: PORT,
    workingDir,
    agentConnector: inProcessClaudeAgentConnector({ command: 'node', args: [fakeAdapter] }),
    verbose: false,
  });

  const ws = new WebSocket(`ws://localhost:${PORT}`);
  await new Promise<void>((res, rej) => {
    ws.on('open', () => res());
    ws.on('error', rej);
  });

  const understandings = new Map<string, UnderstandingNotification>();
  let waiter: (() => void) | null = null;
  const sourceCount = graph.nodes.filter((n) => n.kind === 'source').length;
  const client = new DSWeaveAcpClient(new NodeWsTransport(ws), {
    onUnderstanding: (note) => {
      understandings.set(note.nodeId, note);
      if (understandings.size >= sourceCount && waiter) waiter();
    },
  });

  await client.newSession({ workingDir, capabilities: ['scene.html'] });

  const ready = new Promise<void>((res) => {
    waiter = res;
    if (understandings.size >= sourceCount) res();
  });
  await client.registerFile({ nodeId: 'n_gltf', ref: graph.nodes[0]!.file!, content: b64(GLTF), assets: [] });
  await Promise.race([
    ready,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('理解超时')), 5000)),
  ]).catch((e: Error) => fail(e.message));

  // 第一次运行：经官方 ACP 假替身产出自由 HTML 产物
  const first = await runOnce(client);
  if (!first.uri.startsWith('/_artifacts/')) fail(`产物 uri 异常：${first.uri}`);
  if (first.perms < 1) fail('未收到来自官方 ACP 的权限请求（permission 翻译缺失）');
  if (!first.logs.some((l) => /HTML 就绪/.test(l))) fail('未完成 index.html 读取/校验');
  console.log('✓ 官方 ACP 假替身 → index.html → 校验 → 产物：', first.uri, `（权限请求 ${first.perms} 次）`);

  // 取回产物，校验运行时注入 + 资产内联 + 长文
  const html = await (await fetch(`http://localhost:${PORT}${first.uri}`)).text();
  if (!html.includes('<model-viewer')) fail('产物缺少 <model-viewer>');
  if (!html.includes('data:model/gltf') || !html.includes(';base64,')) {
    fail('模型字节未内联为 data URI');
  }
  if (html.includes('asset://')) fail('仍残留未解析的 asset:// 占位');
  if (/src=["']https?:/.test(html)) fail('产物含外链资源（非离线自包含）');
  const prose = extractProse(html);
  if (prose.length < 500) fail(`正文长度不足 500 字：实际 ${prose.length}`);
  if (html.length <= 200_000) fail(`产物体积异常（model-viewer 运行时未注入？）：${html.length}`);
  console.log(
    `✓ 产物自包含可运行：${html.length} 字节，含 model-viewer 运行时 + 内联模型 + ${prose.length} 字正文`,
  );

  // 二次运行：命中产物缓存
  const second = await runOnce(client);
  if (second.uri !== first.uri) fail(`缓存命中应返回同一产物：${second.uri} != ${first.uri}`);
  if (!second.logs.some((l) => /命中缓存/.test(l))) fail('二次运行未命中产物缓存');
  console.log('✓ 二次运行命中产物缓存：', second.uri);

  client.close();
  ws.close();
  await server.close();

  console.log('\n✅ FREEFORM SMOKE PASS');
  process.exit(0);
}

void main();
