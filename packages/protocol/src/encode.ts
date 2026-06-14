/**
 * 图 → Prompt 编码：把 FlowGraph 结构 + 上下文编成发给 Agent 的有界任务。
 */
import { stripRuntime, type FlowGraph, type OutputSpec } from '@dsweave/core';
import type { PromptInput } from './messages.js';

/** 一次会话的上下文（Host 注入）。 */
export interface SessionContext {
  workingDir: string;
  /** Host 可用能力清单（约束 Agent 不臆造工具）。 */
  capabilities: string[];
  /** token 预算（M3 上下文工程用，M2 预留）。 */
  budget?: number;
}

/** 系统指令：声明角色与约束（不含「先出计划」阶段，直接执行）。 */
export const SYSTEM_TEMPLATE = [
  '你是 DSWeave 的执行 Agent。输入是一张「节点图」：节点=文件，边=自然语言语义，输出节点=受限产物类型+软细节。',
  '请基于图结构与各文件的理解，调用 Host 声明的能力产出目标产物。',
  '约束：只能使用 capabilities 中列出的能力；输出类型只能是 outputs 中给定的受限类型；在 session/update 中回引 nodeId/edgeId 以便前端精确高亮。',
].join('\n');

/** 把图与上下文编码为 PromptInput。 */
export function encodeGraphToPrompt(graph: FlowGraph, ctx: SessionContext): PromptInput {
  const stripped = stripRuntime(graph);
  const outputs: OutputSpec[] = stripped.nodes
    .filter((n) => n.kind === 'output' && n.output)
    .map((n) => n.output as OutputSpec);

  return {
    instructions: SYSTEM_TEMPLATE,
    graph: stripped,
    capabilities: ctx.capabilities,
    workingDir: ctx.workingDir,
    outputs,
  };
}
