/**
 * @dsweave/host — Node 进程：WS 桥接、文件服务、（后续）文件理解、能力执行、Agent 管理。
 *
 * M2：WS 服务 + Agent 管理（默认进程内 Mock）+ 透明帧中继 + 文件登记。
 * 后续里程碑：understanding / context / capabilities / 产物落盘。
 */
import { startServer, type RunningServer, type ServerOptions } from './server.js';
import type { AgentConnector } from './agent-manager.js';

export const HOST_VERSION = '0.1.0';

export interface HostOptions {
  /** 沙箱工作目录。 */
  workingDir: string;
  /** WebSocket 监听端口。 */
  port?: number;
  /** Agent 连接策略（缺省进程内 Mock）。 */
  agentConnector?: AgentConnector;
  verbose?: boolean;
}

export interface Host {
  readonly options: Required<Pick<HostOptions, 'workingDir' | 'port'>> & HostOptions;
  start(): Promise<RunningServer>;
}

/** 创建一个 Host 实例（调用 start 启动 WS 服务）。 */
export function createHost(options: HostOptions): Host {
  const resolved = {
    ...options,
    workingDir: options.workingDir,
    port: options.port ?? 8787,
  };
  return {
    options: resolved,
    start: () => {
      const serverOpts: ServerOptions = {
        port: resolved.port,
        agentConnector: resolved.agentConnector,
        verbose: resolved.verbose,
      };
      return startServer(serverOpts);
    },
  };
}

export { startServer } from './server.js';
export { AgentManager, inProcessMockConnector, spawnStdioConnector } from './agent-manager.js';
export { bridge } from './bridge.js';
export { FsService } from './fs-service.js';
export { NodeWsTransport } from './ws-transport.js';
export type { AgentConnector, AgentEndpoint } from './agent-manager.js';
export type { RunningServer, ServerOptions } from './server.js';
