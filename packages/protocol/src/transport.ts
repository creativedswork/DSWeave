/**
 * 传输层抽象：前端业务只依赖 AcpTransport，因此 WebSocket → Tauri IPC 迁移无感。
 *
 * - WebSocketTransport：前端 ↔ Host（浏览器与 Node 的 ws 均兼容）
 * - 内存传输对（createMemoryTransportPair）：进程内连接 Mock Agent / 单测
 * - StdioTransport：Host ↔ 真实 Agent（基于 Node 流，放在 host/agent 侧实现）
 */
export interface AcpTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  /** 连接关闭时回调（可选）。 */
  onClose?(handler: () => void): void;
  close(): void;
}

/**
 * 浏览器 `WebSocket` 与 Node `ws` 的最小公共子集（避免依赖 DOM lib）。
 * 仅要求 addEventListener（二者皆支持），用方法语法以获得宽松的参数兼容。
 */
export interface WebSocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: string, listener: (ev: unknown) => void): void;
}

const WS_OPEN = 1;

/**
 * 基于标准 WebSocket 的传输。发送在连接 open 前会被缓冲，open 后冲刷。
 * 消息体统一为 JSON 文本。
 */
export class WebSocketTransport implements AcpTransport {
  private readonly ws: WebSocketLike;
  private messageHandler: ((message: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private outbox: string[] = [];
  private opened = false;

  constructor(ws: WebSocketLike) {
    this.ws = ws;
    this.opened = ws.readyState === WS_OPEN;

    const handleOpen = () => {
      this.opened = true;
      for (const frame of this.outbox) this.ws.send(frame);
      this.outbox = [];
    };
    const handleMessage = (data: unknown) => {
      if (!this.messageHandler) return;
      this.messageHandler(parseFrame(data));
    };

    ws.addEventListener('open', () => handleOpen());
    ws.addEventListener('message', (ev) => handleMessage((ev as { data: unknown }).data));
    ws.addEventListener('close', () => this.closeHandler?.());
  }

  send(message: unknown): void {
    const frame = JSON.stringify(message);
    if (this.opened && this.ws.readyState === WS_OPEN) {
      this.ws.send(frame);
    } else {
      this.outbox.push(frame);
    }
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.ws.close();
  }
}

function parseFrame(data: unknown): unknown {
  // 约定双方都以 JSON 文本收发；非字符串（已解析对象）原样透传。
  if (typeof data === 'string') return JSON.parse(data);
  return data;
}

/** 微任务投递（替代 queueMicrotask，避免依赖宿主全局）。 */
function microtask(fn: () => void): void {
  void Promise.resolve().then(fn);
}

/**
 * 一对相互连接的内存传输（A.send → B.onMessage，反之亦然）。
 * 用于进程内连接 Mock Agent，以及单元测试，无需真实 socket。
 */
export function createMemoryTransportPair(): [AcpTransport, AcpTransport] {
  let handlerA: ((m: unknown) => void) | null = null;
  let handlerB: ((m: unknown) => void) | null = null;
  let closeA: (() => void) | null = null;
  let closeB: (() => void) | null = null;

  // 跨「微任务」投递，模拟真实异步传输，避免重入。
  const deliver = (handler: (() => void) | null) => {
    if (handler) microtask(handler);
  };

  const a: AcpTransport = {
    send: (m) => deliver(() => handlerB?.(clone(m))),
    onMessage: (h) => {
      handlerA = h;
    },
    onClose: (h) => {
      closeA = h;
    },
    close: () => deliver(() => closeB?.()),
  };
  const b: AcpTransport = {
    send: (m) => deliver(() => handlerA?.(clone(m))),
    onMessage: (h) => {
      handlerB = h;
    },
    onClose: (h) => {
      closeB = h;
    },
    close: () => deliver(() => closeA?.()),
  };
  return [a, b];
}

/** 结构化克隆（隔离两端，模拟序列化语义）。 */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
