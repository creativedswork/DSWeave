/**
 * @dsweave/agent — 参考 ACP Agent（可插拔；亦可接外部 Agent 如 Gemini CLI）。
 *
 * M0 仅占位。后续：
 * - M2：Mock Agent（收到 prompt → 假的 node-status 流 → done）
 * - M4：真实 Agent，只产出 SceneSpec（不写代码），调用 Host 能力
 */

export const AGENT_VERSION = '0.0.0';

export const AGENT_KIND = 'reference' as const;
