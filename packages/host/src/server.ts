/**
 * WS + HTTP 服务：接受前端连接、为每连接连一个 Agent 并桥接、管理会话生命周期；
 * 同进程的 HTTP 服务静态托管产物（`/_artifacts/<hash>/...`）供前端 iframe 预览。
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { WebSocketServer, type WebSocket } from 'ws';
import type { CapabilityInvokeParams } from '@dsweave/protocol';
import { AgentManager, type AgentConnector } from './agent-manager.js';
import { bridge, type BridgeHandle } from './bridge.js';
import { UnderstandingService } from './understanding-service.js';
import { NodeWsTransport } from './ws-transport.js';
import { ArtifactStore } from './artifacts.js';
import { createDefaultCapabilityRegistry } from './capabilities/index.js';
import type { CapabilityRegistry } from './capabilities/index.js';

export interface ServerOptions {
  port: number;
  /** 沙箱工作目录（产物落盘根）。 */
  workingDir?: string;
  /** 预构建 Player 单文件 HTML 路径（缺省 <cwd>/packages/player/dist/index.html）。 */
  playerDistPath?: string;
  /** Agent 连接策略；缺省进程内 Mock。 */
  agentConnector?: AgentConnector;
  /** 能力注册表；缺省 scene.html。 */
  capabilities?: CapabilityRegistry;
  /** 是否打印帧日志（默认 true）。 */
  verbose?: boolean;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
};

function serveArtifact(req: IncomingMessage, res: ServerResponse, artifacts: ArtifactStore): void {
  const urlPath = (req.url ?? '').split('?')[0] ?? '';
  const full = artifacts.resolveServePath(urlPath);
  if (!full) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
    return;
  }
  const ext = full.toLowerCase().slice(full.lastIndexOf('.') + 1);
  res.writeHead(200, {
    'content-type': MIME_BY_EXT[ext] ?? 'application/octet-stream',
    'access-control-allow-origin': '*',
  });
  res.end(readFileSync(full));
}

export function startServer(options: ServerOptions): Promise<RunningServer> {
  const { port, verbose = true } = options;
  const workingDir = options.workingDir ?? process.cwd();

  const artifacts = new ArtifactStore({ rootDir: workingDir, playerDistPath: options.playerDistPath });
  const capabilities = options.capabilities ?? createDefaultCapabilityRegistry();
  // 跨连接共享文件理解服务，使内容寻址缓存得以复用，并供能力解析资产/分块。
  const understanding = new UnderstandingService();
  const manager = new AgentManager(options.agentConnector);

  const httpServer = createServer((req, res) => serveArtifact(req, res, artifacts));
  const wss = new WebSocketServer({ server: httpServer });
  let connSeq = 0;

  const onCapabilityInvoke = (params: CapabilityInvokeParams) =>
    capabilities.invoke(
      params.capability,
      { outputNodeId: params.outputNodeId, input: params.input },
      { understanding, artifacts },
    );

  wss.on('connection', (ws: WebSocket) => {
    const connId = ++connSeq;
    const clientTransport = new NodeWsTransport(ws);
    const agent = manager.connect();
    const handle: BridgeHandle = bridge(clientTransport, agent.transport, {
      understanding,
      onCapabilityInvoke,
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
    httpServer.on('error', reject);
    httpServer.listen(port, () => {
      if (verbose) console.log(`[dsweave/host] ws + http listening on http://localhost:${port}`);
      resolve({
        port,
        close: () =>
          new Promise<void>((res) => {
            wss.close(() => httpServer.close(() => res()));
          }),
      });
    });
  });
}
