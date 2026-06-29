/**
 * 官方 ACP client 封装：spawn 一个说官方 ACP 的 Agent（默认 claude-agent-acp），
 * 用 @agentclientprotocol/sdk 的 ClientSideConnection 对接，对外暴露最小 API：
 *   - init(cwd)：spawn + initialize + session/new
 *   - prompt(text, handlers)：发一轮 prompt，把 ACP 的 update/permission 回调出去
 *   - dispose()：杀子进程
 *
 * 这是 DSWeave Host 在 stdio 边界「说官方 ACP」的那一层（M4b 关键决策一）。
 */
import { type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { spawnCross } from '../util/spawn.js';
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Client,
  type ReadTextFileRequest,
  type ReadTextFileResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
  type WriteTextFileRequest,
} from '@agentclientprotocol/sdk';

export interface ClaudeAcpOptions {
  /** adapter 启动命令（默认 npx）。 */
  command?: string;
  /** adapter 启动参数（默认 -y @agentclientprotocol/claude-agent-acp）。 */
  args?: string[];
  /** 透传给子进程的环境变量（默认继承 process.env）。 */
  env?: NodeJS.ProcessEnv;
  /**
   * 会话级日志回调（init 期间的诊断信息，如 session modes / 模式切换）。
   * 不提供时回退到 stderr，确保 dev:host 终端可见。
   */
  onLog?: (text: string, level?: 'info' | 'warn' | 'error') => void;
  /**
   * 期望的 session mode：
   *   - 具体 modeId：强制切到该模式（须在 availableModes 内）。
   *   - 'off'：不自动切换，保持 agent 默认模式。
   *   - 未设置（undefined）：启发式选一个「自动批准/yolo」类模式（若存在）。
   * 也可经环境变量 ACP_SESSION_MODE 覆盖。
   */
  sessionMode?: string;
}

/** ACP session mode 快照（来自 session/new 的 modes 字段）。 */
export interface AcpSessionModes {
  currentModeId: string;
  availableModes: { id: string; name: string }[];
}

export interface PromptHandlers {
  /** Agent 文本增量（agent_message_chunk）。 */
  onText?: (text: string) => void;
  /** Agent 思考增量（agent_thought_chunk）。 */
  onThought?: (text: string) => void;
  /** 工具调用起止。 */
  onToolCall?: (info: { id: string; title: string; status: string }) => void;
  /** 权限请求 → 返回是否放行（true=允许）。 */
  onPermission?: (summary: string) => Promise<boolean>;
}

export interface PromptOutcome {
  stopReason: string;
  agentText: string;
}

export function defaultAdapterCommand(opts: ClaudeAcpOptions = {}): { command: string; args: string[] } {
  const command = opts.command ?? process.env.CLAUDE_ACP_CMD ?? 'npx';
  const args =
    opts.args ??
    (process.env.CLAUDE_ACP_ARGS ?? '-y,@agentclientprotocol/claude-agent-acp').split(',');
  return { command, args };
}

/**
 * Gemini CLI 的 ACP adapter 默认启动方式：`gemini --acp`（stdio 上说官方 ACP）。
 * 可经 GEMINI_ACP_CMD / GEMINI_ACP_ARGS 覆盖（测试可指向假替身）。
 * 详见 https://geminicli.com/docs/cli/acp-mode/
 */
export function defaultGeminiAdapterCommand(opts: ClaudeAcpOptions = {}): {
  command: string;
  args: string[];
} {
  const command = opts.command ?? process.env.GEMINI_ACP_CMD ?? 'gemini';
  const args = opts.args ?? (process.env.GEMINI_ACP_ARGS ?? '--acp').split(',');
  return { command, args };
}

/** 一个 spawn 的官方 ACP Agent 会话。 */
export class ClaudeAcpSession {
  private child?: ChildProcess;
  private conn?: ClientSideConnection;
  private sessionId?: string;
  private cwd = '';
  private handlers: PromptHandlers = {};
  private modes?: AcpSessionModes;

  constructor(private readonly opts: ClaudeAcpOptions = {}) {}

  /** 会话级日志：优先回调，否则落到 stderr（dev:host 终端可见）。 */
  private slog(text: string, level: 'info' | 'warn' | 'error' = 'info'): void {
    if (this.opts.onLog) this.opts.onLog(text, level);
    else console.error(`[acp]${level === 'info' ? '' : `[${level}]`} ${text}`);
  }

  /** session/new 返回的 modes 快照（无则 undefined）。 */
  getModes(): AcpSessionModes | undefined {
    return this.modes;
  }

  /**
   * 按 opts.sessionMode / ACP_SESSION_MODE 解析并切换到目标模式。
   *
   * 背景：部分 agent（典型如 Gemini CLI `--acp`）的默认模式不会主动执行写文件工具，
   * 表现为「只回一段文字就 end_turn、一个工具都不调」。官方 ACP 提供 session/set_mode
   * 切到 auto-approve / yolo 类模式即可让其真正动手。我们本就自动放行 permission，
   * 切到更宽松的模式不改变安全姿态。详见 https://geminicli.com/docs/cli/acp-mode/
   */
  private async applyPreferredMode(): Promise<void> {
    if (!this.conn || !this.sessionId) return;
    const modes = this.modes;
    if (!modes?.availableModes?.length) return;
    const current = modes.currentModeId;
    const available = modes.availableModes;
    this.slog(
      `session modes：current=${current}，available=[${available
        .map((m) => `${m.id}${m.name && m.name !== m.id ? `(${m.name})` : ''}`)
        .join(', ')}]`,
    );

    const pref = this.opts.sessionMode ?? process.env.ACP_SESSION_MODE;
    if (pref === 'off') return;

    let target: string | undefined;
    if (pref) {
      if (available.some((m) => m.id === pref)) target = pref;
      else this.slog(`期望的 session mode「${pref}」不在 availableModes 中，已忽略`, 'warn');
    } else {
      // 启发式：挑一个「自动批准/全权」类模式（id 或 name 命中关键词），且不同于当前。
      const re = /yolo|auto|accept|bypass|full|all[-_ ]?access|自动|全部|允许/i;
      const cand = available.find((m) => m.id !== current && (re.test(m.id) || re.test(m.name)));
      if (cand) target = cand.id;
    }

    if (!target || target === current) return;
    try {
      await this.conn.setSessionMode({ sessionId: this.sessionId, modeId: target });
      this.slog(`已切换 session mode → ${target}（自动批准工具，确保 agent 真正写文件）`);
    } catch (err) {
      this.slog(`切换 session mode 失败（${target}）：${(err as Error)?.message ?? err}`, 'warn');
    }
  }

  /** spawn adapter，完成 initialize + session/new，cwd 作为 Agent 文件工具的工作目录。 */
  async init(cwd: string): Promise<void> {
    this.cwd = resolve(cwd);
    mkdirSync(this.cwd, { recursive: true });
    const { command, args } = defaultAdapterCommand(this.opts);
    const child = spawnCross(command, args, {
      cwd: this.cwd,
      env: this.opts.env ?? process.env,
      stdio: ['pipe', 'pipe', 'inherit'],
    });
    this.child = child;

    if (!child.stdin || !child.stdout) throw new Error('adapter 未提供 stdio 管道');
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout) as unknown as ReadableStream<Uint8Array>,
    );

    const resolveInCwd = (p: string): string => {
      const abs = isAbsolute(p) ? p : join(this.cwd, p);
      if (!abs.startsWith(this.cwd)) throw new Error(`path escapes workspace: ${p}`);
      return abs;
    };

    const client: Client = {
      sessionUpdate: async (params: SessionNotification): Promise<void> => {
        const u = params.update;
        switch (u.sessionUpdate) {
          case 'agent_message_chunk':
            if (u.content.type === 'text') this.handlers.onText?.(u.content.text);
            break;
          case 'agent_thought_chunk':
            if (u.content.type === 'text') this.handlers.onThought?.(u.content.text);
            break;
          case 'tool_call':
            this.handlers.onToolCall?.({
              id: u.toolCallId,
              title: u.title ?? u.kind ?? 'tool',
              status: u.status ?? 'pending',
            });
            break;
          case 'tool_call_update':
            if (u.status)
              this.handlers.onToolCall?.({ id: u.toolCallId, title: u.title ?? 'tool', status: u.status });
            break;
          default:
            break;
        }
      },
      requestPermission: async (
        params: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        const allow =
          params.options.find((o) => o.kind === 'allow_always') ??
          params.options.find((o) => o.kind === 'allow_once') ??
          params.options[0];
        const summary = params.toolCall?.title ?? '工具调用';
        const ok = this.handlers.onPermission ? await this.handlers.onPermission(summary) : true;
        if (ok && allow) return { outcome: { outcome: 'selected', optionId: allow.optionId } };
        const reject = params.options.find((o) => o.kind.startsWith('reject'));
        if (!ok && reject) return { outcome: { outcome: 'selected', optionId: reject.optionId } };
        return { outcome: { outcome: 'cancelled' } };
      },
      writeTextFile: async (params: WriteTextFileRequest): Promise<Record<string, never>> => {
        const abs = resolveInCwd(params.path);
        mkdirSync(join(abs, '..'), { recursive: true });
        writeFileSync(abs, params.content, 'utf-8');
        return {};
      },
      readTextFile: async (params: ReadTextFileRequest): Promise<ReadTextFileResponse> => {
        const abs = resolveInCwd(params.path);
        return { content: existsSync(abs) ? readFileSync(abs, 'utf-8') : '' };
      },
    };

    this.conn = new ClientSideConnection(() => client, stream);
    await this.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    });
    const session = await this.conn.newSession({ cwd: this.cwd, mcpServers: [] });
    this.sessionId = session.sessionId;

    // 捕获 session modes 并按需切到「自动批准」类模式（修 Gemini「不写文件就 end_turn」）。
    const modeState = (session as { modes?: { currentModeId?: string; availableModes?: { id: string; name?: string }[] } | null }).modes;
    if (modeState?.currentModeId && modeState.availableModes?.length) {
      this.modes = {
        currentModeId: modeState.currentModeId,
        availableModes: modeState.availableModes.map((m) => ({ id: m.id, name: m.name ?? m.id })),
      };
    } else {
      this.slog('session/new 未返回 modes（该 agent 不支持模式切换或仅单一模式）', 'info');
    }
    await this.applyPreferredMode();
  }

  /** 发一轮 prompt（文本），等待 turn 结束，返回 stopReason 与累计文本。 */
  async prompt(text: string, handlers: PromptHandlers = {}): Promise<PromptOutcome> {
    if (!this.conn || !this.sessionId) throw new Error('ClaudeAcpSession 未初始化');
    this.handlers = handlers;
    let agentText = '';
    const prevOnText = handlers.onText;
    this.handlers.onText = (t) => {
      agentText += t;
      prevOnText?.(t);
    };
    const resp = await this.conn.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
    return { stopReason: resp.stopReason, agentText };
  }

  dispose(): void {
    this.child?.kill();
    this.child = undefined;
  }
}

/**
 * 中立别名：该 session 与具体 agent 无关（adapter 命令可配），既服务 Claude 也服务 Gemini
 * 等任何「说官方 ACP 的子进程」。Claude/Gemini 各自的 agent 仅在构造时传入不同 command/args。
 */
export { ClaudeAcpSession as AcpSession };
export type AcpSessionOptions = ClaudeAcpOptions;
