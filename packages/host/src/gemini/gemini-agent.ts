/**
 * Gemini 驱动的内部 Agent（新增 ACP 后端）：通用 ACP 核心（acp/acp-agent.ts）的薄包装。
 *
 * Gemini CLI 同样原生支持官方 ACP（`gemini --acp`，JSON-RPC over stdio），见
 * https://geminicli.com/docs/cli/acp-mode/ 。因此接入方式与 Claude Code 完全一致：
 * onPrompt 内部经官方 ACP（@agentclientprotocol/sdk 的 ClientSideConnection）驱动
 * `gemini --acp` 产出 scene.spec.json，再交给 Host 的 scene.html 能力出物。前端 / 内部协议 /
 * bridge / 能力链路全部不变，与 Claude 后端可热插拔切换。
 *
 * 鉴权：spawn 时透传 process.env，Gemini CLI 自行读取本机登录态 / GEMINI_API_KEY /
 * GOOGLE_API_KEY 等；Host 不另造鉴权表面。adapter 命令可经 GEMINI_ACP_CMD / GEMINI_ACP_ARGS 覆盖。
 */
import { type AcpTransport } from '@dsweave/protocol';
import {
  createAcpAgent,
  type AcpAgentOptions,
  type AcpBackendSpec,
} from '../acp/acp-agent.js';
import { defaultGeminiAdapterCommand } from '../claude/acp-client.js';

export type GeminiAgentOptions = AcpAgentOptions;

/** Gemini CLI（`gemini --acp`）后端描述。 */
const GEMINI_BACKEND: AcpBackendSpec = {
  label: 'Gemini',
  slug: 'gemini',
  resolveCommand: (opts) => defaultGeminiAdapterCommand(opts),
};

/** 创建一个 Gemini 驱动的内部 Agent 连接。 */
export function createGeminiAgent(
  transport: AcpTransport,
  options: GeminiAgentOptions = {},
) {
  return createAcpAgent(transport, GEMINI_BACKEND, options);
}
