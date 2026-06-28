/**
 * DSWeaveAcpClient：前端侧的 ACP 客户端封装。
 *
 * - newSession：建立会话
 * - run：发起执行，返回 DSWeaveEvent 异步流（消费 session/update，至 done 结束）
 * - respondPermission：回应 Agent 的授权请求
 * - cancel：取消当前执行
 *
 * 仅依赖 AcpTransport，因此 WS ↔ Tauri IPC、Mock ↔ 真实 Agent 切换对前端无感。
 */
import type { FlowGraph } from '@dsweave/core';
import type { AcpTransport } from './transport.js';
import { JsonRpcPeer } from './jsonrpc.js';
import { AsyncQueue } from './async-queue.js';
import { decodeUpdate } from './decode.js';
import { encodeGraphToPrompt, type SessionContext } from './encode.js';
import type { DSWeaveEvent } from './events.js';
import {
  RPC,
  type InstallSkillParams,
  type InstallSkillResult,
  type ListSkillsResult,
  type NewSessionResult,
  type PromptResult,
  type RegisterFileParams,
  type RegisterFileResult,
  type RemoveSkillParams,
  type RemoveSkillResult,
  type RequestPermissionParams,
  type RequestPermissionResult,
  type SessionUpdateNotification,
  type SetActiveSkillParams,
  type SetActiveSkillResult,
  type UnderstandingNotification,
} from './messages.js';

export interface DSWeaveAcpClientOptions {
  /**
   * 收到 Agent 授权请求时的回调；返回 true 放行、false 拒绝。
   * 不提供则默认拒绝（安全优先）。
   */
  onPermission?: (req: { requestId: string; summary: string; options: string[] }) => void;
  /** 收到 Host 文件理解流式回填时的回调。 */
  onUnderstanding?: (note: UnderstandingNotification) => void;
}

export class DSWeaveAcpClient {
  private readonly peer: JsonRpcPeer;
  private readonly options: DSWeaveAcpClientOptions;
  private sessionId: string | null = null;
  private context: SessionContext | null = null;
  private activeQueue: AsyncQueue<DSWeaveEvent> | null = null;
  private readonly pendingPermissions = new Map<
    string,
    (result: RequestPermissionResult) => void
  >();

  constructor(transport: AcpTransport, options: DSWeaveAcpClientOptions = {}) {
    this.options = options;
    this.peer = new JsonRpcPeer(transport, {
      onNotify: (method, params) => this.handleNotify(method, params),
      onRequest: (method, params) => this.handleRequest(method, params),
    });
  }

  /** 建立会话，返回 sessionId。 */
  async newSession(ctx: SessionContext): Promise<string> {
    this.context = ctx;
    const res = await this.peer.request<NewSessionResult>(RPC.sessionNew, {
      workingDir: ctx.workingDir,
      capabilities: ctx.capabilities,
    });
    this.sessionId = res.sessionId;
    return res.sessionId;
  }

  /** 发起执行，返回事件流。消费完毕（done）后流自动结束。 */
  run(graph: FlowGraph): AsyncIterable<DSWeaveEvent> {
    if (!this.sessionId || !this.context) {
      throw new Error('run() 调用前必须先 newSession()');
    }
    const queue = new AsyncQueue<DSWeaveEvent>();
    this.activeQueue = queue;
    const prompt = encodeGraphToPrompt(graph, this.context);

    this.peer
      .request<PromptResult>(RPC.sessionPrompt, { sessionId: this.sessionId, prompt })
      .then((res) => {
        queue.push({ kind: 'done', reason: res.stopReason });
        queue.close();
      })
      .catch((err: unknown) => {
        queue.push({ kind: 'log', level: 'error', text: errMessage(err) });
        queue.push({ kind: 'done', reason: 'error' });
        queue.close();
      })
      .finally(() => {
        if (this.activeQueue === queue) this.activeQueue = null;
      });

    return queue;
  }

  /**
   * 登记一个文件并触发 Host 侧文件理解。
   * 命中缓存时结果同步返回；否则经 onUnderstanding 异步回填。
   * 该请求由 Host 直接处理，不转发给 Agent。
   */
  registerFile(params: RegisterFileParams): Promise<RegisterFileResult> {
    return this.peer.request<RegisterFileResult>(RPC.understandingRegister, params);
  }

  // ---------- Skills 库管理（Host 侧处理） ----------

  /** 列出三级作用域已发现的 skill（含激活态）。 */
  listSkills(): Promise<ListSkillsResult> {
    return this.peer.request<ListSkillsResult>(RPC.skillsList, {});
  }

  /** 安装一个 skill。 */
  installSkill(params: InstallSkillParams): Promise<InstallSkillResult> {
    return this.peer.request<InstallSkillResult>(RPC.skillsInstall, params);
  }

  /** 激活/停用一个 skill。 */
  setSkillActive(params: SetActiveSkillParams): Promise<SetActiveSkillResult> {
    return this.peer.request<SetActiveSkillResult>(RPC.skillsSetActive, params);
  }

  /** 删除一个 skill。 */
  removeSkill(params: RemoveSkillParams): Promise<RemoveSkillResult> {
    return this.peer.request<RemoveSkillResult>(RPC.skillsRemove, params);
  }

  /** 回应一个授权请求。 */
  respondPermission(requestId: string, allow: boolean): void {
    const resolve = this.pendingPermissions.get(requestId);
    if (!resolve) return;
    this.pendingPermissions.delete(requestId);
    resolve({ optionIndex: allow ? 0 : null });
  }

  /** 取消当前执行。 */
  cancel(): void {
    if (!this.sessionId) return;
    this.peer.notify(RPC.sessionCancel, { sessionId: this.sessionId });
  }

  close(): void {
    this.peer.close();
  }

  private handleNotify(method: string, params: unknown): void {
    if (method === RPC.understandingUpdate) {
      this.options.onUnderstanding?.(params as UnderstandingNotification);
      return;
    }
    if (method !== RPC.sessionUpdate) return;
    const note = params as SessionUpdateNotification;
    if (!note?.update) return;
    const event = decodeUpdate(note.update);
    if (event) this.activeQueue?.push(event);
  }

  private handleRequest(method: string, params: unknown): Promise<RequestPermissionResult> {
    if (method !== RPC.requestPermission) {
      return Promise.reject(new Error(`unhandled method: ${method}`));
    }
    const req = params as RequestPermissionParams;
    // 把授权请求作为事件抛给前端，并等待 respondPermission 回应。
    this.activeQueue?.push({
      kind: 'permission-request',
      id: req.requestId,
      summary: req.summary,
      options: req.options,
    });
    this.options.onPermission?.({
      requestId: req.requestId,
      summary: req.summary,
      options: req.options,
    });
    return new Promise<RequestPermissionResult>((resolve) => {
      this.pendingPermissions.set(req.requestId, resolve);
    });
  }
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}
