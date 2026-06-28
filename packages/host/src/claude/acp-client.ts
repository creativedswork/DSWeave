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

  constructor(private readonly opts: ClaudeAcpOptions = {}) {}

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
