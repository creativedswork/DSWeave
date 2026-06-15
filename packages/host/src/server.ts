/**
 * WS 服务：接受前端连接，为每个连接连一个 Agent 并桥接，管理会话生命周期。
 */
import { WebSocketServer, type WebSocket } from 'ws';
import { AgentManager, type AgentConnector } from './agent-manager.js';
import { bridge, type BridgeHandle } from './bridge.js';
import { UnderstandingService } from './understanding-service.js';
import { NodeWsTransport } from './ws-transport.js';

export interface ServerOptions {
  port: number;
  /** Agent 连接策略；缺省进程内 Mock。 */
  agentConnector?: AgentConnector;
  /** 是否打印帧日志（默认 true）。 */
  verbose?: boolean;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const { port, verbose = true } = options;
  const wss = new WebSocketServer({ port });
  const manager = new AgentManager(options.agentConnector);
  // 跨连接共享文件理解服务，使内容寻址缓存得以复用。
  const understanding = new UnderstandingService();
  let connSeq = 0;

  wss.on('connection', (ws: WebSocket) => {
    const connId = ++connSeq;
    const clientTransport = new NodeWsTransport(ws);
    const agent = manager.connect();
    const handle: BridgeHandle = bridge(clientTransport, agent.transport, {
      understanding,
      onFrame: verbose
        ? (dir, msg) => {
            const method = (msg as { method?: string })?.method;
            if (method) console.log(`[host#${connId}] ${dir} ${method}`);
          }
        : undefined,
    });

    if (verbose) console.log(`[host] client #${connId} connected`);

    ws.on('close', () => {
      handle.close();
      agent.dispose();
      if (verbose) console.log(`[host] client #${connId} disconnected`);
    });
  });

  return new Promise((resolve, reject) => {
    wss.on('listening', () => {
      if (verbose) console.log(`[dsweave/host] ws listening on ws://localhost:${port}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => res());
          }),
      });
    });
    wss.on('error', reject);
  });
}
