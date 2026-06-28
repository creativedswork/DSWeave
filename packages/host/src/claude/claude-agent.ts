/**
 * Claude 驱动的内部 Agent（M4b）：通用 ACP 核心（acp/acp-agent.ts）的薄包装。
 *
 * 它实现与启发式 Agent 完全相同的内部契约（AgentSideConnection），onPrompt 内部经官方 ACP
 * 驱动 claude-agent-acp 产出 scene.spec.json，再交给 Host 的 scene.html 能力出物。因此前端 /
 * 内部协议 / bridge / 能力链路全部不变，仅 Agent 实现替换。具体编排见 acp/acp-agent.ts。
 */
import { type AcpTransport } from '@dsweave/protocol';
import {
  createAcpAgent,
  type AcpAgentOptions,
  type AcpBackendSpec,
} from '../acp/acp-agent.js';
import { defaultAdapterCommand } from './acp-client.js';

export type ClaudeAgentOptions = AcpAgentOptions;

/** Claude Code（claude-agent-acp）后端描述。 */
const CLAUDE_BACKEND: AcpBackendSpec = {
  label: 'Claude',
  slug: 'claude',
  resolveCommand: (opts) => defaultAdapterCommand(opts),
  // Claude Agent SDK 默认扫 cwd/.claude/skills/（省略 settingSources 时加载 user+project）。
  skillsDir: '.claude/skills',
};

/** 创建一个 Claude 驱动的内部 Agent 连接。 */
export function createClaudeAgent(
  transport: AcpTransport,
  options: ClaudeAgentOptions = {},
) {
  return createAcpAgent(transport, CLAUDE_BACKEND, options);
}
