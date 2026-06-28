/**
 * Agent 管理：为每个会话连接一个 Agent，返回 Host 侧用于通信的传输。
 *
 * 通过 AgentConnector 抽象实现可插拔：
 * - inProcessMockConnector（M2 默认）：进程内 Mock Agent，零进程、最稳。
 * - spawnStdioConnector：spawn 子进程，走 stdio ndjson（真实/外部 Agent 路径）。
 */
import { createMemoryTransportPair, type AcpTransport } from '@dsweave/protocol';
import { createMockAgent, createSceneAgent, StdioTransport } from '@dsweave/agent';
import { createClaudeAgent, type ClaudeAgentOptions } from './claude/claude-agent.js';
import { createGeminiAgent, type GeminiAgentOptions } from './gemini/gemini-agent.js';
import { spawnCross } from './util/spawn.js';

export interface AgentEndpoint {
  /** Host 侧用于与 Agent 通信的传输。 */
  transport: AcpTransport;
  /** 关闭 / 释放该 Agent。 */
  dispose(): void;
}

export type AgentConnector = () => AgentEndpoint;

/** 进程内 Mock Agent（M2/M3：状态流 + 占位产物）。 */
export function inProcessMockConnector(): AgentEndpoint {
  const [hostSide, agentSide] = createMemoryTransportPair();
  const agent = createMockAgent(agentSide);
  return {
    transport: hostSide,
    dispose: () => agent.close(),
  };
}

/** 进程内启发式 Agent（M4a：直接产出自包含 HTML → scene.html 能力）。 */
export function inProcessSceneAgentConnector(): AgentEndpoint {
  const [hostSide, agentSide] = createMemoryTransportPair();
  const agent = createSceneAgent(agentSide);
  return {
    transport: hostSide,
    dispose: () => agent.close(),
  };
}

/**
 * Claude 驱动的内部 Agent（M4b）：进程内 AgentSideConnection，onPrompt 经官方 ACP
 * 驱动 claude-agent-acp 产出自包含 HTML → scene.html 能力。前端/内部协议/能力链路不变。
 */
export function inProcessClaudeAgentConnector(options: ClaudeAgentOptions = {}): AgentConnector {
  return () => {
    const [hostSide, agentSide] = createMemoryTransportPair();
    const agent = createClaudeAgent(agentSide, options);
    return {
      transport: hostSide,
      dispose: () => agent.close(),
    };
  };
}

/**
 * Gemini 驱动的内部 Agent：进程内 AgentSideConnection，onPrompt 经官方 ACP 驱动
 * `gemini --acp` 产出自包含 HTML → scene.html 能力。与 Claude 后端同构、可热插拔，
 * 前端/内部协议/能力链路不变。
 */
export function inProcessGeminiAgentConnector(options: GeminiAgentOptions = {}): AgentConnector {
  return () => {
    const [hostSide, agentSide] = createMemoryTransportPair();
    const agent = createGeminiAgent(agentSide, options);
    return {
      transport: hostSide,
      dispose: () => agent.close(),
    };
  };
}

/** spawn 子进程并走 stdio ndjson（供真实/外部 Agent 使用）。 */
export function spawnStdioConnector(command: string, args: string[] = []): AgentConnector {
  return () => {
    const child = spawnCross(command, args, { stdio: ['pipe', 'pipe', 'inherit'] });
    if (!child.stdin || !child.stdout) throw new Error('子进程未提供 stdio 管道');
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
