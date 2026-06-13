import { z } from 'zod';
import type { FlowGraph } from './model.js';
import type { SceneSpec } from './scene-spec.js';

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

export const zFileRef = z.object({
  uri: z.string(),
  mime: z.string(),
  type: zFileType,
  size: z.number().optional(),
  hash: z.string().optional(),
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

const zTransform = z.object({
  position: z.tuple([z.number(), z.number(), z.number()]).optional(),
  rotation: z.tuple([z.number(), z.number(), z.number()]).optional(),
  scale: z.union([z.number(), z.tuple([z.number(), z.number(), z.number()])]).optional(),
});

export const zSceneSpec = z.object({
  version: z.literal(1),
  theme: z.object({ palette: z.string(), style: z.string() }),
  layout: z.enum(['single-focus', 'gallery']),
  models: z.array(
    z.object({
      nodeId: z.string(),
      assetRef: z.string(),
      placement: zTransform.optional(),
      autoRotate: z.boolean().optional(),
    }),
  ),
  hotspots: z.array(
    z.object({
      modelNodeId: z.string(),
      part: z.string(),
      title: z.string(),
      bodyChunkIds: z.array(z.string()),
    }),
  ),
  panels: z.array(z.object({ title: z.string(), chunkIds: z.array(z.string()) })),
  citations: z.boolean(),
});

/** 校验并解析一个 FlowGraph（抛出 ZodError 或返回类型安全对象）。 */
export function validateFlow(input: unknown): FlowGraph {
  return zFlowGraph.parse(input) as FlowGraph;
}

/** 安全校验：返回成功结果或错误，不抛异常。 */
export function safeValidateFlow(input: unknown) {
  return zFlowGraph.safeParse(input);
}

/** 校验并解析一个 SceneSpec。 */
export function validateSceneSpec(input: unknown): SceneSpec {
  return zSceneSpec.parse(input) as SceneSpec;
}

export function safeValidateSceneSpec(input: unknown) {
  return zSceneSpec.safeParse(input);
}
