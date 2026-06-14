/**
 * Agent 管理：为每个会话连接一个 Agent，返回 Host 侧用于通信的传输。
 *
 * 通过 AgentConnector 抽象实现可插拔：
 * - inProcessMockConnector（M2 默认）：进程内 Mock Agent，零进程、最稳。
 * - spawnStdioConnector：spawn 子进程，走 stdio ndjson（真实/外部 Agent 路径）。
 */
import { spawn } from 'node:child_process';
import { createMemoryTransportPair, type AcpTransport } from '@dsweave/protocol';
import { createMockAgent, StdioTransport } from '@dsweave/agent';

export interface AgentEndpoint {
  /** Host 侧用于与 Agent 通信的传输。 */
  transport: AcpTransport;
  /** 关闭 / 释放该 Agent。 */
  dispose(): void;
}

export type AgentConnector = () => AgentEndpoint;

/** 进程内 Mock Agent（M2 默认）。 */
export function inProcessMockConnector(): AgentEndpoint {
  const [hostSide, agentSide] = createMemoryTransportPair();
  const agent = createMockAgent(agentSide);
  return {
    transport: hostSide,
    dispose: () => agent.close(),
  };
}

/** spawn 子进程并走 stdio ndjson（供真实/外部 Agent 使用）。 */
export function spawnStdioConnector(command: string, args: string[] = []): AgentConnector {
  return () => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    const transport = new StdioTransport(child.stdout, child.stdin);
    return {
      transport,
      dispose: () => {
        child.kill();
      },
    };
  };
}

export class AgentManager {
  private readonly connector: AgentConnector;

  constructor(connector: AgentConnector = inProcessMockConnector) {
    this.connector = connector;
  }

  /** 为一个新会话连接一个 Agent。 */
  connect(): AgentEndpoint {
    return this.connector();
  }
}
