/**
 * @dsweave/host — Node 进程：WS/HTTP 服务、文件服务、文件理解、上下文工程、能力执行、Agent 管理。
 *
 * scene.html 能力：把 Agent 自撰 HTML 注入 model-viewer 运行时 + 内联 asset:// 资产 → 自包含 HTML 产物；
 * 产物内容寻址落盘 `.dsweave/artifacts/<hash>/`，经 HTTP 静态服务供前端 iframe 预览。
 */
import { startServer, type RunningServer, type ServerOptions } from './server.js';
import {
  inProcessSceneAgentConnector,
  inProcessMockConnector,
  inProcessClaudeAgentConnector,
  inProcessGeminiAgentConnector,
  type AgentConnector,
} from './agent-manager.js';

/**
 * 内置 Agent 类型：mock（占位）/ scene（启发式，M4a）/ claude（Claude Code，M4b）/
 * gemini（Gemini CLI，官方 ACP）。claude 与 gemini 均经官方 ACP 接入，可热插拔。
 */
export type AgentKind = 'mock' | 'scene' | 'claude' | 'gemini';

/** 按类型选择内置 Agent connector。 */
export function connectorForKind(kind: AgentKind): AgentConnector {
  switch (kind) {
    case 'mock':
      return inProcessMockConnector;
    case 'claude':
      return inProcessClaudeAgentConnector();
    case 'gemini':
      return inProcessGeminiAgentConnector();
    case 'scene':
    default:
      return inProcessSceneAgentConnector;
  }
}

export const HOST_VERSION = '0.5.0';

export interface HostOptions {
  /** 沙箱工作目录（产物落盘根）。 */
  workingDir: string;
  /** WebSocket / HTTP 监听端口。 */
  port?: number;
  /** Agent 连接策略（缺省进程内启发式 Agent）。优先于 agentKind。 */
  agentConnector?: AgentConnector;
  /** 内置 Agent 类型（缺省 scene）；agentConnector 未提供时生效。 */
  agentKind?: AgentKind;
  verbose?: boolean;
}

export interface Host {
  readonly options: Required<Pick<HostOptions, 'workingDir' | 'port'>> & HostOptions;
  start(): Promise<RunningServer>;
}

/** 创建一个 Host 实例（调用 start 启动 WS/HTTP 服务）。 */
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
        workingDir: resolved.workingDir,
        agentConnector:
          resolved.agentConnector ?? connectorForKind(resolved.agentKind ?? 'scene'),
        verbose: resolved.verbose,
      };
      return startServer(serverOpts);
    },
  };
}

export { startServer } from './server.js';
export {
  AgentManager,
  inProcessMockConnector,
  inProcessSceneAgentConnector,
  inProcessClaudeAgentConnector,
  inProcessGeminiAgentConnector,
  spawnStdioConnector,
} from './agent-manager.js';
export { createClaudeAgent } from './claude/claude-agent.js';
export type { ClaudeAgentOptions } from './claude/claude-agent.js';
export { createGeminiAgent } from './gemini/gemini-agent.js';
export type { GeminiAgentOptions } from './gemini/gemini-agent.js';
export { createAcpAgent } from './acp/acp-agent.js';
export type { AcpAgentOptions, AcpBackendSpec } from './acp/acp-agent.js';
export { ClaudeAcpSession, AcpSession, defaultGeminiAdapterCommand } from './claude/acp-client.js';
export type { ClaudeAcpOptions, AcpSessionOptions } from './claude/acp-client.js';
export { bridge } from './bridge.js';
export type { CapabilityInvoker } from './bridge.js';
export { FsService, contentHash } from './fs-service.js';
export type { StoredFile } from './fs-service.js';
export { NodeWsTransport } from './ws-transport.js';
export { UnderstandingService } from './understanding-service.js';
export { ArtifactStore } from './artifacts.js';
export type { ArtifactStoreOptions } from './artifacts.js';
export {
  CapabilityRegistry,
  createDefaultCapabilityRegistry,
  sceneHtmlCapability,
  OUTPUT_TYPES,
  capabilityForOutput,
  visibleOutputTypes,
} from './capabilities/index.js';
export type {
  Capability,
  CapabilityInvocation,
  CapabilityRuntime,
  ChunkInfo,
  OutputType,
} from './capabilities/index.js';
export {
  ProviderRegistry,
  createDefaultRegistry,
} from './understanding/index.js';
export type { UnderstandingProvider, UnderstandIO } from './understanding/index.js';
export { chunkText, summarizeChunks, buildContext } from './context/index.js';
export {
  SkillsService,
  discoverSkills,
  scanScope,
  readSkillDir,
  parseFrontmatter,
} from './skills/index.js';
export type {
  SkillsServiceOptions,
  DiscoveredSkill,
  SkillRoots,
} from './skills/index.js';
export type { AgentConnector, AgentEndpoint } from './agent-manager.js';
export type { RunningServer, ServerOptions } from './server.js';
