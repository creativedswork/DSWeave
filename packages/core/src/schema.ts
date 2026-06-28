import { z } from 'zod';
import type { FlowGraph } from './model.js';
import type { Understanding } from './model.js';

export const zFileType = z.enum([
  'gltf',
  'md',
  'pdf',
  'txt',
  'html',
  'image',
  'data',
  'unknown',
]);

export const zFileAsset = z.object({
  path: z.string(),
  mime: z.string().optional(),
  size: z.number().optional(),
  hash: z.string().optional(),
  role: z.enum(['buffer', 'image', 'other']).optional(),
});

export const zFileRef = z.object({
  uri: z.string(),
  mime: z.string(),
  type: zFileType,
  size: z.number().optional(),
  hash: z.string().optional(),
  assets: z.array(zFileAsset).optional(),
});

export const zOutputTypeId = z.enum(['scene.html', 'report.html', 'app.react', 'custom']);

export const zOutputSpec = z.object({
  typeId: zOutputTypeId,
  spec: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const zFlowNode = z.object({
  id: z.string(),
  kind: z.enum(['source', 'output']),
  position: z.object({ x: z.number(), y: z.number() }),
  label: z.string().optional(),
  file: zFileRef.optional(),
  output: zOutputSpec.optional(),
});

export const zFlowEdge = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  semantics: z.string(),
  params: z.record(z.unknown()).optional(),
});

export const zFlowGraph = z.object({
  version: z.literal(1),
  id: z.string(),
  name: z.string(),
  nodes: z.array(zFlowNode),
  edges: z.array(zFlowEdge),
  meta: z
    .object({
      createdAt: z.string(),
      updatedAt: z.string(),
    })
    .optional(),
});

// ---------- 文件理解（Understanding）相关 ----------

export const zChunk = z.object({
  id: z.string(),
  text: z.string(),
  source: z.object({ nodeId: z.string(), loc: z.string().optional() }),
  embedding: z.array(z.number()).optional(),
});

export const zModelMeta = z.object({
  nodes: z
    .array(z.object({ name: z.string(), meshIndex: z.number().optional() }))
    .optional(),
  materials: z.array(z.string()).optional(),
  animations: z.array(z.string()).optional(),
  bbox: z
    .object({
      min: z.tuple([z.number(), z.number(), z.number()]),
      max: z.tuple([z.number(), z.number(), z.number()]),
    })
    .optional(),
});

export const zUnderstanding = z.object({
  text: z.string().optional(),
  summary: z.string().optional(),
  chunks: z.array(zChunk).optional(),
  outline: z.array(z.object({ level: z.number(), title: z.string() })).optional(),
  schema: z.record(z.unknown()).optional(),
  captions: z.array(z.string()).optional(),
  renders: z.array(z.string()).optional(),
  model: zModelMeta.optional(),
  metadata: z.record(z.unknown()).optional(),
  ready: z.boolean(),
});

/** 校验并解析一个 Understanding。 */
export function validateUnderstanding(input: unknown): Understanding {
  return zUnderstanding.parse(input) as Understanding;
}

export function safeValidateUnderstanding(input: unknown) {
  return zUnderstanding.safeParse(input);
}

/** 校验并解析一个 FlowGraph（抛出 ZodError 或返回类型安全对象）。 */
export function validateFlow(input: unknown): FlowGraph {
  return zFlowGraph.parse(input) as FlowGraph;
}

/** 安全校验：返回成功结果或错误，不抛异常。 */
export function safeValidateFlow(input: unknown) {
  return zFlowGraph.safeParse(input);
}
