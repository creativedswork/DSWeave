/**
 * 前端 ACP 接入：建立到 Host 的 WebSocket，封装成 DSWeaveAcpClient。
 *
 * 仅依赖 AcpTransport，未来换 Tauri IPC 时前端无需改动。
 */
import {
  DSWeaveAcpClient,
  WebSocketTransport,
  type UnderstandingNotification,
} from '@dsweave/protocol';

const HOST_PORT = Number(import.meta.env.VITE_DSWEAVE_PORT ?? 8787);
const CONNECT_TIMEOUT_MS = 5000;

let clientPromise: Promise<DSWeaveAcpClient> | null = null;

/** 文件理解流式回填的订阅者（由 store 设置，路由到状态）。 */
let understandingSink: ((note: UnderstandingNotification) => void) | null = null;

/** 设置文件理解回填的接收者。 */
export function setUnderstandingSink(cb: (note: UnderstandingNotification) => void): void {
  understandingSink = cb;
}

function hostName(): string {
  return typeof location !== 'undefined' ? location.hostname : 'localhost';
}

function hostUrl(): string {
  return `ws://${hostName()}:${HOST_PORT}`;
}

/** 把 Host 返回的相对产物 uri（/_artifacts/...）解析为可访问的 http URL。 */
export function artifactUrl(uri: string): string {
  if (/^https?:\/\//.test(uri)) return uri;
  return `http://${hostName()}:${HOST_PORT}${uri}`;
}

async function connect(): Promise<DSWeaveAcpClient> {
  const url = hostUrl();
  const ws = new WebSocket(url);

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error(`连接 Host 超时（${url}）。请先运行 \`pnpm dev:host\` 启动 Host。`));
    }, CONNECT_TIMEOUT_MS);
    ws.addEventListener('open', () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error(`无法连接 Host（${url}）。请确认 Host 已启动。`));
    });
  });

  // 断开后清空缓存，下次 start 时重连。
  ws.addEventListener('close', () => {
    clientPromise = null;
  });

  return new DSWeaveAcpClient(new WebSocketTransport(ws), {
    onUnderstanding: (note) => understandingSink?.(note),
  });
}

/** 获取（必要时建立）到 Host 的客户端连接。 */
export function getClient(): Promise<DSWeaveAcpClient> {
  if (!clientPromise) clientPromise = connect().catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}
