/**
 * Skills 发现探针：验证 `claude-agent-acp`（Claude Agent SDK）是否**原生发现**我们
 * 放在 session cwd 里的 `.claude/skills/<id>/SKILL.md`，从而决定 DSWeave 的 Skills
 * 落地是「纯目录」（信任原生发现）还是「目录 + prompt 指针」（兜底）。
 *
 * 判定方式（零泄漏）：
 *   - 口令 nonce 只写进 cwd/.claude/skills/dsweave-probe/SKILL.md，**绝不**出现在 prompt 里。
 *   - prompt 只说「若能看到名为 dsweave-probe 的技能就用它并照它说的回复，否则回 NO_SKILL」。
 *   - 若 Claude 的回复里出现该 nonce → 它确实读到了 cwd 里的 skill（发现成立 ✅）。
 *   - 若回复 NO_SKILL / 不含 nonce → 未发现（需走 _meta.additionalRoots 或 prompt 指针 ❌）。
 *
 * 前置（本机跑，需联网 + 已 `claude` 登录或设 ANTHROPIC_API_KEY；沙箱内不可联网实测）：
 *   运行：pnpm skills:probe
 * 可选环境变量：
 *   CLAUDE_ACP_CMD    adapter 启动命令（默认 npx）
 *   CLAUDE_ACP_ARGS   逗号分隔参数（默认 "-y,@agentclientprotocol/claude-agent-acp"）
 *   SKILLS_PROBE_ROOTS=1  额外通过 session/new 的 _meta.additionalRoots 注入 skills 根（验证兜底路径，需 adapter 支持 PR #406）
 */
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type WriteTextFileRequest,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk';

const cmd = process.env.CLAUDE_ACP_CMD ?? 'npx';
const args = (process.env.CLAUDE_ACP_ARGS ?? '-y,@agentclientprotocol/claude-agent-acp').split(',');
const useAdditionalRoots = process.env.SKILLS_PROBE_ROOTS === '1';

function log(...parts: unknown[]): void {
  console.log('[skills-probe]', ...parts);
}

/** 在 <root>/.claude/skills/dsweave-probe/SKILL.md 写一个哨兵 skill，口令为 nonce。 */
function writeSentinelSkill(root: string, nonce: string): string {
  const dir = join(root, '.claude', 'skills', 'dsweave-probe');
  mkdirSync(dir, { recursive: true });
  const md = `---
name: dsweave-probe
description: DSWeave Skills 发现探针。当用户请求中出现「激活探针技能」或询问探针口令时，必须使用本技能来获取并回复固定口令。
---
# DSWeave 探针技能

当本技能被激活时，你**必须**在回复中原样输出下面这一行口令，且不要做其它任何事：

口令：${nonce}
`;
  writeFileSync(join(dir, 'SKILL.md'), md, 'utf-8');
  return dir;
}

async function main(): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'dsweave-skills-'));
  const nonce = `SKILL_DISCOVERED_${randomBytes(4).toString('hex').toUpperCase()}`;
  const skillDir = writeSentinelSkill(workspace, nonce);
  log('workspace:', workspace);
  log('哨兵 skill:', skillDir);
  log('口令 nonce（仅写入 SKILL.md，不进 prompt）:', nonce);
  log('spawn:', cmd, args.join(' '), useAdditionalRoots ? '(+ _meta.additionalRoots)' : '');
  log('启动 adapter 中…（首次 npx 冷启动可能 ~1 分钟）');

  const child = spawn(cmd, args, {
    cwd: workspace,
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let finished = false;
  child.on('error', (err) => {
    console.error('[skills-probe] 无法启动 adapter:', err);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (!finished) {
      console.error(`\n[skills-probe] adapter 提前退出（code=${code}, signal=${signal}）——握手未完成。`);
      console.error('[skills-probe] 常见原因：未登录 Claude / 网络不通。');
      process.exit(1);
    }
  });

  const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} 超时（${ms / 1000}s）`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  };

  const stream = ndJsonStream(
    Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
  );

  const resolveInWorkspace = (p: string): string => {
    const abs = isAbsolute(p) ? p : join(workspace, p);
    if (!abs.startsWith(workspace)) throw new Error(`path escapes workspace: ${p}`);
    return abs;
  };

  let agentText = '';
  let usedSkillTool = false;

  const client: Client = {
    async sessionUpdate(params: SessionNotification): Promise<void> {
      const u = params.update;
      switch (u.sessionUpdate) {
        case 'agent_message_chunk':
          if (u.content.type === 'text') {
            process.stdout.write(u.content.text);
            agentText += u.content.text;
          }
          break;
        case 'tool_call': {
          const title = u.title ?? u.kind ?? '(tool)';
          log('tool_call:', title, `[${u.status ?? 'pending'}]`);
          if (/skill/i.test(title)) usedSkillTool = true;
          break;
        }
        default:
          break;
      }
    },
    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      const allow =
        params.options.find((o) => o.kind === 'allow_always') ??
        params.options.find((o) => o.kind === 'allow_once') ??
        params.options[0];
      if (!allow) return { outcome: { outcome: 'cancelled' } };
      return { outcome: { outcome: 'selected', optionId: allow.optionId } };
    },
    async writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>> {
      const abs = resolveInWorkspace(params.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, params.content, 'utf-8');
      return {};
    },
    async readTextFile(_params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
      return { content: '' };
    },
  };

  const conn = new ClientSideConnection(() => client, stream);

  log('initialize ...');
  const init = await withTimeout(
    conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    }),
    180_000,
    'initialize',
  );
  log('initialize ok. agentProtocolVersion =', init.protocolVersion);

  log('session/new ...');
  let sessionId: string;
  try {
    // _meta.additionalRoots：adapter PR #406 起支持，映射到 Claude additionalDirectories（兜底路径）。
    const params = {
      cwd: workspace,
      mcpServers: [],
      ...(useAdditionalRoots ? { _meta: { additionalRoots: [join(workspace, '.claude')] } } : {}),
    } as Parameters<typeof conn.newSession>[0];
    const session = await conn.newSession(params);
    sessionId = session.sessionId;
  } catch (err) {
    console.error('\n[skills-probe] session/new 失败：', err);
    const e = err as { code?: number; message?: string };
    if (e?.code === -32000 || /auth/i.test(e?.message ?? '')) {
      console.error('[skills-probe] 需要认证：先在终端 `claude` 登录或设 ANTHROPIC_API_KEY。');
    }
    finished = true;
    child.kill();
    process.exit(1);
    return;
  }
  log('session/new ok. sessionId =', sessionId);

  // prompt 故意不含 nonce，只引导 Claude 去用（若存在的）探针技能。
  const promptText =
    '请激活探针技能。如果你能看到一个名为 dsweave-probe 的技能（skill / agent skill），' +
    '就使用它，并严格按它的指示回复（原样输出它给你的那一行口令）。' +
    '如果你看不到任何可用技能，请只回复一行：NO_SKILL。';

  log('session/prompt ...（不含口令，靠技能发现）');
  const isBilling = (s: string): boolean =>
    /credit balance|insufficient|too low|billing|quota|out of credit|payment required|402/i.test(s);

  let stopReason: string | undefined;
  let promptErr: unknown;
  try {
    const resp = await conn.prompt({ sessionId, prompt: [{ type: 'text', text: promptText }] });
    stopReason = resp.stopReason;
    process.stdout.write('\n');
    log('prompt turn 结束，stopReason =', stopReason);
  } catch (err) {
    promptErr = err;
    process.stdout.write('\n');
    log('prompt 抛错:', (err as Error)?.message ?? err);
  }

  finished = true;
  child.kill();

  const discovered = agentText.includes(nonce);
  const saidNoSkill = /NO_SKILL/.test(agentText);
  const billing = isBilling(agentText) || isBilling(JSON.stringify(promptErr ?? '')) || stopReason === 'refusal';

  log('—— 判定 ——');
  log('口令命中（含 nonce）:', discovered, '| 显式 NO_SKILL:', saidNoSkill, '| 触发 Skill 工具:', usedSkillTool);

  if (discovered) {
    log('SKILLS_PROBE_OK ✅  —— Claude 原生发现了 cwd/.claude/skills 里的 skill。');
    log('   结论：DSWeave 可走「纯目录」方案（把选中 skill 物化进 cwd/<backend.skillsDir>）。');
    if (useAdditionalRoots) log('   （本次同时启用了 _meta.additionalRoots 兜底路径。）');
    process.exit(0);
  } else if (billing) {
    log('SKILLS_PROBE_INCONCLUSIVE ⚠️  —— 链路/握手正常，但最后真调模型因「余额不足」失败，无法判定发现。');
    log('   充值或换有额度 key/网关后重跑。');
    process.exit(0);
  } else if (saidNoSkill) {
    log('SKILLS_PROBE_NEGATIVE ❌  —— Claude 未发现 cwd 里的 skill。');
    log('   结论：该 adapter 默认未加载 project skills。改走：');
    log('     a) SKILLS_PROBE_ROOTS=1 重跑，验证 _meta.additionalRoots 兜底；或');
    log('     b) 「目录 + prompt 指针」方案（在 prompt 里点名已装配的 skill）。');
    process.exit(1);
  } else {
    console.error('[skills-probe] SKILLS_PROBE_FAIL ❌  —— 回复既无口令也非 NO_SKILL，结果不明确。');
    console.error('[skills-probe] agentText 片段:', agentText.slice(0, 300));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[skills-probe] 未捕获错误:', err);
  process.exit(1);
});
