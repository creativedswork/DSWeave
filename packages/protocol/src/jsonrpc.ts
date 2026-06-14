/**
 * 极简 JSON-RPC 2.0 对等端（peer），架在 AcpTransport 之上。
 *
 * 同时支持请求/响应（带 id）与通知（无 id），双向：任一端都能发起请求或推送通知。
 * ACP 的 `session/*` 方法即建立在此之上。
 */
import type { AcpTransport } from './transport.js';

export type RpcId = number;

export interface RpcRequest {
  jsonrpc: '2.0';
  id: RpcId;
  method: string;
  params?: unknown;
}

export interface RpcNotification {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
}

export interface RpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface RpcResponse {
  jsonrpc: '2.0';
  id: RpcId;
  result?: unknown;
  error?: RpcError;
}

/** 处理对端发来的请求；返回值作为 result，抛出错误作为 error。 */
export type RequestHandler = (method: string, params: unknown) => Promise<unknown> | unknown;
/** 处理对端发来的通知。 */
export type NotificationHandler = (method: string, params: unknown) => void;

export interface JsonRpcHandlers {
  onRequest?: RequestHandler;
  onNotify?: NotificationHandler;
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: RpcError) => void;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

export class JsonRpcPeer {
  private readonly transport: AcpTransport;
  private handlers: JsonRpcHandlers;
  private nextId = 1;
  private readonly pending = new Map<RpcId, Pending>();
  private closed = false;

  constructor(transport: AcpTransport, handlers: JsonRpcHandlers = {}) {
    this.transport = transport;
    this.handlers = handlers;
    this.transport.onMessage((msg) => this.handleMessage(msg));
    this.transport.onClose?.(() => this.handleClose());
  }

  setHandlers(handlers: JsonRpcHandlers): void {
    this.handlers = handlers;
  }

  /** 发起请求，等待响应。 */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(rpcError(-32000, 'transport closed'));
    const id = this.nextId++;
    const req: RpcRequest = { jsonrpc: '2.0', id, method, params };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.transport.send(req);
    });
  }

  /** 推送通知（不等待响应）。 */
  notify(method: string, params?: unknown): void {
    if (this.closed) return;
    const note: RpcNotification = { jsonrpc: '2.0', method, params };
    this.transport.send(note);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) p.reject(rpcError(-32000, 'transport closed'));
    this.pending.clear();
    this.transport.close();
  }

  private handleClose(): void {
    if (this.closed) return;
    this.closed = true;
    for (const [, p] of this.pending) p.reject(rpcError(-32000, 'connection closed'));
    this.pending.clear();
  }

  private handleMessage(msg: unknown): void {
    if (!isObject(msg)) return;
    const hasId = 'id' in msg && typeof msg.id === 'number';
    const hasMethod = typeof msg.method === 'string';

    if (hasMethod && hasId) {
      void this.handleRequest(msg as unknown as RpcRequest);
      return;
    }
    if (hasMethod) {
      this.handlers.onNotify?.(msg.method as string, msg.params);
      return;
    }
    if (hasId) {
      this.handleResponse(msg as unknown as RpcResponse);
    }
  }

  private async handleRequest(req: RpcRequest): Promise<void> {
    const handler = this.handlers.onRequest;
    if (!handler) {
      this.transport.send(<RpcResponse>{
        jsonrpc: '2.0',
        id: req.id,
        error: rpcError(-32601, `method not handled: ${req.method}`),
      });
      return;
    }
    try {
      const result = await handler(req.method, req.params);
      this.transport.send(<RpcResponse>{ jsonrpc: '2.0', id: req.id, result: result ?? null });
    } catch (err) {
      this.transport.send(<RpcResponse>{
        jsonrpc: '2.0',
        id: req.id,
        error: toRpcError(err),
      });
    }
  }

  private handleResponse(res: RpcResponse): void {
    const pending = this.pending.get(res.id);
    if (!pending) return;
    this.pending.delete(res.id);
    if (res.error) pending.reject(res.error);
    else pending.resolve(res.result);
  }
}

export function rpcError(code: number, message: string, data?: unknown): RpcError {
  return { code, message, data };
}

function toRpcError(err: unknown): RpcError {
  if (isObject(err) && typeof err.code === 'number' && typeof err.message === 'string') {
    return err as unknown as RpcError;
  }
  return rpcError(-32603, err instanceof Error ? err.message : String(err));
}
