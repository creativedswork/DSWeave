/**
 * @dsweave/agent — 参考 ACP Agent（可插拔）。
 *
 * - M2/M3：Mock Agent（node/edge 状态流 + 日志 + 占位产物）。
 * - M4a：启发式 SceneSpec Agent（无 LLM）——只产出 SceneSpec，调用 Host scene.html 能力产出。
 * - M4b：换上官方 ACP（Claude Code）于 stdio 边界，前端零改。
 */
export const AGENT_VERSION = '0.0.0';
export const AGENT_KIND = 'mock' as const;

export { createMockAgent } from './agent.js';
export { createSceneAgent } from './scene-agent.js';
export { buildSceneSpec } from './scene-builder.js';
export { StdioTransport } from './stdio.js';
export { MOCK_CAPABILITIES, backingCapability, capabilityForOutput } from './tools/index.js';
