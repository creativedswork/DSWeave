/**
 * AgentSideConnection：Agent 侧的 ACP 连接封装。
 *
 * Agent 实现者只需提供 handler（onNewSession / onPrompt），
 * 并在执行过程中用 `sessionUpdate()` 推送流式更新、用 `requestPermission()` 请求授权。
 */
import type { AcpTransport } from './transport.js';
import { JsonRpcPeer } from './jsonrpc.js';
import {
  RPC,
  type CancelParams,
  type CapabilityInvokeParams,
  type CapabilityInvokeResult,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
  type RequestPermissionResult,
  type SessionUpdate,
  type SessionUpdateNotification,
} from './messages.js';

export interface AgentHandler {
  /** 新建会话：返回 sessionId（不提供则自动生成）。 */
  onNewSession?(params: NewSessionParams): Promise<NewSessionResult> | NewSessionResult;
  /** 收到 prompt：执行并返回停止原因。执行期间用 conn.sessionUpdate 推送更新。 */
  onPrompt(params: PromptParams, conn: AgentSideConnection): Promise<PromptResult> | PromptResult;
  /** 收到取消通知。 */
  onCancel?(params: CancelParams): void;
}

let sessionCounter = 0;
let permissionCounter = 0;

export class AgentSideConnection {
  private readonly peer: JsonRpcPeer;
  private readonly handler: AgentHandler;

  constructor(transport: AcpTransport, handler: AgentHandler) {
    this.handler = handler;
    this.peer = new JsonRpcPeer(transport, {
      onRequest: (method, params) => this.handleRequest(method, params),
      onNotify: (method, params) => this.handleNotify(method, params),
    });
  }

  /** 推送一次流式更新（session/update 通知）。 */
  sessionUpdate(sessionId: string, update: SessionUpdate): void {
    const params: SessionUpdateNotification = { sessionId, update };
    this.peer.notify(RPC.sessionUpdate, params);
  }

  /** 请求一次授权，等待 Client 回应；返回是否放行。 */
  async requestPermission(sessionId: string, summary: string, options: string[]): Promise<boolean> {
    const requestId = `perm_${++permissionCounter}`;
    const res = await this.peer.request<RequestPermissionResult>(RPC.requestPermission, {
      sessionId,
      requestId,
      summary,
      options,
    });
    return res.optionIndex != null;
  }

  /**
   * 调用一项 Host 能力产出产物（capability/invoke）。
   * 该请求由 Host 的 Bridge 就地处理（不转发前端），返回产出物与缓存标识。
   */
  invokeCapability(params: CapabilityInvokeParams): Promise<CapabilityInvokeResult> {
    return this.peer.request<CapabilityInvokeResult>(RPC.capabilityInvoke, params);
  }

  close(): void {
    this.peer.close();
  }

  private async handleRequest(method: string, params: unknown): Promise<unknown> {
    switch (method) {
      case RPC.sessionNew: {
        if (this.handler.onNewSession) {
          return await this.handler.onNewSession(params as NewSessionParams);
        }
        return <NewSessionResult>{ sessionId: `session_${++sessionCounter}` };
      }
      case RPC.sessionPrompt:
        return await this.handler.onPrompt(params as PromptParams, this);
      default:
        throw new Error(`unhandled method: ${method}`);
    }
  }

  private handleNotify(method: string, params: unknown): void {
    if (method === RPC.sessionCancel) {
      this.handler.onCancel?.(params as CancelParams);
    }
  }
}
