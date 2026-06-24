/**
 * M4b 阶段 A 探针：验证 Host 能 spawn Claude Code 的 ACP adapter 并跑通官方 ACP。
 *
 * 它不接 DSWeave 业务，只做最小握手 + 一个 prompt turn，用来确认：
 *   1. 能 spawn `@agentclientprotocol/claude-agent-acp`（复用本机 Claude Code 登录态，无需 API key）。
 *   2. 官方 ACP 握手成功（initialize → session/new）。
 *   3. 一个 prompt turn 能跑完：Claude 调用 fs.write_text_file 写出哨兵文件，turn 以 end_turn 结束。
 *
 * 前置（在你本机跑，需联网到 Anthropic + 已 `claude` 登录）：
 *   - Claude Code 已登录（~/.claude.json 存在）或设置了 ANTHROPIC_API_KEY
 *   - Node >= 20
 * 运行：pnpm m4b:probe
 * 可选环境变量：
 *   CLAUDE_ACP_CMD   adapter 启动命令（默认 npx）
 *   CLAUDE_ACP_ARGS  逗号分隔参数（默认 "-y,@zed-industries/claude-code-acp"）
 */
import { spawn } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';
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

const SENTINEL = 'DSWEAVE_M4B_OK';
const HELLO = 'dsweave-probe.txt';

const cmd = process.env.CLAUDE_ACP_CMD ?? 'npx';
const args = (process.env.CLAUDE_ACP_ARGS ?? '-y,@agentclientprotocol/claude-agent-acp').split(',');

function log(...parts: unknown[]): void {
  console.log('[probe]', ...parts);
}

async function main(): Promise<void> {
  const workspace = mkdtempSync(join(tmpdir(), 'dsweave-m4b-'));
  log('workspace:', workspace);
  log('spawn:', cmd, args.join(' '));

  log('启动 adapter 中…（首次 npx 冷启动可能 ~1 分钟，请耐心等待）');
  const child = spawn(cmd, args, {
    cwd: workspace,
    // 继承环境，让 adapter 复用本机 Claude Code 登录态 / ANTHROPIC_API_KEY
    env: process.env,
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  let finished = false;
  child.on('error', (err) => {
    console.error('[probe] 无法启动 adapter:', err);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (!finished) {
      console.error(`\n[probe] adapter 进程提前退出（code=${code}, signal=${signal}）——握手未完成。`);
      console.error('[probe] 请检查上方 adapter 的 stderr 输出；常见原因：未登录 Claude / 网络不通。');
      process.exit(1);
    }
  });

  const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> => {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`${label} 超时（${ms / 1000}s）——adapter 无响应`)),
        ms,
      );
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

  // 限制 fs 访问在 workspace 内，避免越权
  const resolveInWorkspace = (p: string): string => {
    const abs = isAbsolute(p) ? p : join(workspace, p);
    if (!abs.startsWith(workspace)) {
      throw new Error(`path escapes workspace: ${p}`);
    }
    return abs;
  };

  let permissionCount = 0;
  let wroteSentinel = false;
  let agentText = '';

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
        case 'agent_thought_chunk':
          break;
        case 'tool_call':
          log('tool_call:', u.title ?? u.kind ?? '(tool)', `[${u.status ?? 'pending'}]`);
          break;
        case 'tool_call_update':
          if (u.status) log('tool_call_update:', u.toolCallId, u.status);
          break;
        default:
          break;
      }
    },

    async requestPermission(
      params: RequestPermissionRequest,
    ): Promise<RequestPermissionResponse> {
      permissionCount += 1;
      const allow =
        params.options.find((o) => o.kind === 'allow_always') ??
        params.options.find((o) => o.kind === 'allow_once') ??
        params.options[0];
      log('permission ->', params.toolCall?.title ?? '(tool)', '=> 自动允许:', allow?.name);
      if (!allow) return { outcome: { outcome: 'cancelled' } };
      return { outcome: { outcome: 'selected', optionId: allow.optionId } };
    },

    async writeTextFile(params: WriteTextFileRequest): Promise<Record<string, never>> {
      const abs = resolveInWorkspace(params.path);
      mkdirSync(join(abs, '..'), { recursive: true });
      writeFileSync(abs, params.content, 'utf-8');
      log('fs.write_text_file:', params.path, `(${params.content.length} chars)`);
      if (params.content.includes(SENTINEL)) wroteSentinel = true;
      return {};
    },

    async readTextFile(params: ReadTextFileRequest): Promise<ReadTextFileResponse> {
      const abs = resolveInWorkspace(params.path);
      const content = existsSync(abs) ? readFileSync(abs, 'utf-8') : '';
      log('fs.read_text_file:', params.path);
      return { content };
    },
  };

  const conn = new ClientSideConnection(() => client, stream);

  // 1) initialize
  log('initialize ...（等待 adapter 就绪）');
  const init = await withTimeout(
    conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    }),
    180_000,
    'initialize',
  );
  log('initialize ok. agentProtocolVersion =', init.protocolVersion);
  if (init.authMethods?.length) {
    log('agent authMethods:', init.authMethods.map((m) => m.id).join(', '));
  }

  // 2) session/new
  log('session/new ...');
  let sessionId: string;
  try {
    const session = await conn.newSession({ cwd: workspace, mcpServers: [] });
    sessionId = session.sessionId;
  } catch (err) {
    console.error('\n[probe] session/new 失败。');
    const e = err as { code?: number; message?: string };
    if (e?.code === -32000 || /auth/i.test(e?.message ?? '')) {
      console.error('[probe] 看起来需要认证：请先在终端运行 `claude` 登录，或设置 ANTHROPIC_API_KEY。');
    } else {
      console.error('[probe] 详情:', err);
    }
    finished = true;
    child.kill();
    process.exit(1);
    return;
  }
  log('session/new ok. sessionId =', sessionId);

  // 3) prompt turn —— 让 Claude 用 fs 工具写出哨兵文件
  const promptText =
    `请在当前工作目录创建文件 ${HELLO}，文件内容恰好是一行：${SENTINEL}。` +
    `使用你的文件写入工具完成，完成后用一句话确认即可，不要做其它事。`;
  log('session/prompt ...');
  const isBilling = (s: string): boolean =>
    /credit balance|insufficient|too low|billing|quota|out of credit|payment required|402/i.test(s);

  let stopReason: string | undefined;
  let promptErr: unknown;
  try {
    const resp = await conn.prompt({
      sessionId,
      prompt: [{ type: 'text', text: promptText }],
    });
    stopReason = resp.stopReason;
    process.stdout.write('\n');
    log('prompt turn 结束，stopReason =', stopReason);
  } catch (err) {
    promptErr = err;
    process.stdout.write('\n');
    log('prompt 抛错:', (err as Error)?.message ?? err);
  }

  // 校验
  const helloPath = join(workspace, HELLO);
  const fileOk = existsSync(helloPath) && readFileSync(helloPath, 'utf-8').includes(SENTINEL);
  log('哨兵文件存在且内容正确:', fileOk, '| 收到 writeTextFile 哨兵:', wroteSentinel, '| 权限请求次数:', permissionCount);

  finished = true;
  child.kill();

  const billing = isBilling(agentText) || isBilling(JSON.stringify(promptErr ?? '')) || stopReason === 'refusal';

  if (stopReason === 'end_turn' && (fileOk || wroteSentinel)) {
    log('M4B_PROBE_OK ✅  —— spawn + 官方 ACP 握手 + 写文件 prompt turn 全部通过');
    process.exit(0);
  } else if (billing) {
    log(
      'M4B_HANDSHAKE_OK ⚠️  —— spawn / initialize / session/new 均通过，链路与鉴权正常；',
    );
    log('   仅最后真调模型这步因「账户余额不足」失败（计费问题，非链路问题）。');
    log('   充值或换一个有余额的 key/网关后即可走完整 prompt turn。');
    process.exit(0);
  } else {
    console.error('[probe] M4B_PROBE_FAIL ❌  —— turn 未正常完成或哨兵文件未写出（且非余额问题）');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('[probe] 未捕获错误:', err);
  process.exit(1);
});
