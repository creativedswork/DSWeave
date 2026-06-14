/**
 * @dsweave/agent — 参考 ACP Agent（可插拔；亦可接外部 Agent 如 Gemini CLI）。
 *
 * - M2：Mock Agent（收到 prompt → node/edge 状态流 + 日志 + 产物 → done）
 * - M4：真实 Agent，只产出 SceneSpec（不写代码），调用 Host 能力
 */
export const AGENT_VERSION = '0.0.0';
export const AGENT_KIND = 'mock' as const;

export { createMockAgent } from './agent.js';
export { StdioTransport } from './stdio.js';
export { MOCK_CAPABILITIES, backingCapability } from './tools/index.js';
