/**
 * Skills 端到端冒烟（沙箱内，不联网）：验证 S1+S2+S3 的后端链路：
 *   - skills/list 发现内置 html-output（builtin，默认激活）
 *   - 激活集经 bridge 注入 prompt.skills → acp-agent 物化进 cwd/<skillsDir>/<id>/
 *     → 假 ACP adapter「原生发现」该 skill（在产物里回写 <!-- dsweave-skills: ... -->）
 *   - skills/setActive 停用后，下一轮不再物化（marker 为空）
 *   - skills/install（folder 载荷）装一个新 skill → 出现在 list；激活后被物化发现；删除
 *
 * 用隔离的 SkillsService（userDir/activeFile 落临时目录），不污染真实 ~/.dsweave。
 * 运行：pnpm skills:smoke
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
import { SkillsService } from './skills/index.js';
import { NodeWsTransport } from './ws-transport.js';

const GLTF = JSON.stringify({
  asset: { version: '2.0' },
  scenes: [{ nodes: [0] }],
  nodes: [{ name: 'Body', mesh: 0 }],
  meshes: [{ name: 'BodyMesh', primitives: [{ attributes: { POSITION: 0 } }] }],
  materials: [{ name: 'Paint' }],
  accessors: [{ min: [-1, -1, -1], max: [1, 1, 1] }],
});

const b64 = (s: string) => Buffer.from(s, 'utf-8').toString('base64');

const graph: FlowGraph = {
  version: 1,
  id: 'flow_skills',
  name: 'Skills 冒烟',
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
  console.log(`\n❌ SKILLS SMOKE FAIL：${msg}`);
  process.exit(1);
}

const PORT = 8809;

/** 跑一轮并取回产物 HTML。 */
async function runAndFetch(client: DSWeaveAcpClient): Promise<string> {
  let uri = '';
  for await (const ev of client.run(graph) as AsyncIterable<DSWeaveEvent>) {
    if (ev.kind === 'permission-request') client.respondPermission(ev.id, true);
    if (ev.kind === 'artifact') uri = ev.uri;
    if (ev.kind === 'done') {
      if (ev.reason !== 'end_turn') fail(`异常结束：${ev.reason}`);
      break;
    }
  }
  if (!uri.startsWith('/_artifacts/')) fail(`产物 uri 异常：${uri}`);
  return (await fetch(`http://localhost:${PORT}${uri}`)).text();
}

/** 从产物里抽 <!-- dsweave-skills: a,b --> 的 id 列表。 */
function skillMarker(html: string): string[] {
  const m = html.match(/<!--\s*dsweave-skills:\s*([^>]*?)\s*-->/);
  if (!m) fail('产物缺少 dsweave-skills 标记（fake-adapter 未回写？）');
  return (m![1] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function main() {
  const fakeAdapter = resolve(process.cwd(), 'packages/host/dist/claude/fake-adapter.js');
  if (!existsSync(fakeAdapter)) {
    fail(`假 adapter 未构建：${fakeAdapter}（先 pnpm --filter @dsweave/host build）`);
  }

  const workingDir = mkdtempSync(join(tmpdir(), 'dsweave-skills-smoke-'));
  // 隔离的 Skills 服务：内置走仓库 packages/host/skills；user/active 落临时目录（不污染真实 ~/.dsweave）。
  const skills = new SkillsService({
    workingDir,
    userDir: join(workingDir, 'user-skills'),
    activeFile: join(workingDir, 'skills-active.json'),
  });

  const server = await startServer({
    port: PORT,
    workingDir,
    agentConnector: inProcessClaudeAgentConnector({ command: 'node', args: [fakeAdapter] }),
    skills,
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
      if (understandings.size >= 1 && waiter) waiter();
    },
  });

  await client.newSession({ workingDir, capabilities: ['scene.html'] });

  // 1) 发现内置 html-output（builtin，默认激活）
  const listed = await client.listSkills();
  const html = listed.skills.find((s) => s.id === 'html-output');
  if (!html) fail('skills/list 未发现内置 html-output');
  if (!html!.builtin) fail('html-output 应为 builtin');
  if (!html!.active) fail('内置 skill 默认应激活');
  if (!html!.description) fail('html-output 缺少 description（frontmatter 解析失败？）');
  console.log(`✓ skills/list 发现内置 html-output（active=${html!.active}，共 ${listed.activeCount} 个激活）`);

  // 触发文件理解
  const ready = new Promise<void>((res) => {
    waiter = res;
    if (understandings.size >= 1) res();
  });
  await client.registerFile({ nodeId: 'n_gltf', ref: graph.nodes[0]!.file!, content: b64(GLTF), assets: [] });
  await Promise.race([
    ready,
    new Promise<void>((_, rej) => setTimeout(() => rej(new Error('理解超时')), 5000)),
  ]).catch((e: Error) => fail(e.message));

  // 2) 激活态下跑：html-output 应被物化进 cwd 并被 fake-adapter 原生发现
  const out1 = await runAndFetch(client);
  const ids1 = skillMarker(out1);
  if (!ids1.includes('html-output')) fail(`激活的 html-output 未被物化/发现：marker=[${ids1.join(',')}]`);
  console.log(`✓ 激活集物化进 cwd → agent 原生发现：[${ids1.join(',')}]`);

  // 3) 停用后再跑：不再物化（marker 为空）
  await client.setSkillActive({ id: 'html-output', active: false });
  const out2 = await runAndFetch(client);
  const ids2 = skillMarker(out2);
  if (ids2.includes('html-output')) fail(`停用后仍被物化：marker=[${ids2.join(',')}]`);
  console.log(`✓ 停用后不再物化：marker=[${ids2.join(',')}]`);

  // 4) install（folder 载荷）一个新 skill → 出现在 list；激活后被物化发现
  const skillMd = `---\nname: Probe Skill\ndescription: 冒烟用安装探针 skill。\noutputTypes: [scene.html]\n---\n# Probe\n仅用于验证安装链路。\n`;
  const install = await client.installSkill({
    source: 'folder',
    scope: 'project',
    files: [{ path: 'smoke-probe/SKILL.md', content: b64(skillMd) }],
  });
  if (install.skill.id !== 'smoke-probe') fail(`安装 id 异常：${install.skill.id}`);
  if (install.skill.builtin) fail('安装的 skill 不应是 builtin');
  const listed2 = await client.listSkills();
  if (!listed2.skills.some((s) => s.id === 'smoke-probe')) fail('安装后 list 未包含 smoke-probe');
  console.log('✓ install(folder) → smoke-probe 出现在 list（project 作用域）');

  await client.setSkillActive({ id: 'smoke-probe', active: true });
  const out3 = await runAndFetch(client);
  const ids3 = skillMarker(out3);
  if (!ids3.includes('smoke-probe')) fail(`激活的 smoke-probe 未被发现：marker=[${ids3.join(',')}]`);
  console.log(`✓ 安装并激活的 skill 被物化发现：[${ids3.join(',')}]`);

  // 5) remove
  const removed = await client.removeSkill({ id: 'smoke-probe' });
  if (!removed.removed) fail('removeSkill 失败');
  const listed3 = await client.listSkills();
  if (listed3.skills.some((s) => s.id === 'smoke-probe')) fail('删除后 list 仍含 smoke-probe');
  console.log('✓ remove → smoke-probe 已删除');

  // 内置不可删校验
  let blocked = false;
  try {
    await client.removeSkill({ id: 'html-output' });
  } catch {
    blocked = true;
  }
  if (!blocked) fail('内置 skill 不应可删除');
  console.log('✓ 内置 skill 删除被拒绝');

  client.close();
  ws.close();
  await server.close();

  console.log('\n✅ SKILLS SMOKE PASS');
  process.exit(0);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : JSON.stringify(err));
});
