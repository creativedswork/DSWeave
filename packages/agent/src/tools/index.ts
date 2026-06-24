/**
 * 工具占位（M2）：Mock Agent 假装可调用的 Host 能力清单。
 * M4 起，这里把 Host 的真实 Capability 暴露为 ACP tool_call。
 */
export const MOCK_CAPABILITIES = ['scene.html', 'report.html', 'gltf.render', 'fs.write'] as const;

const OUTPUT_TO_CAPABILITY: Record<string, string> = {
  'scene.html': 'scene.html',
  'report.html': 'scene.html',
  'app.react': 'app.react',
  custom: 'custom.bestEffort',
};

/** 输出类型 → 背后能力名（与 Host 能力注册表对齐）。 */
export function backingCapability(outputTypeId: string | undefined): string {
  if (!outputTypeId) return 'scene.html';
  return OUTPUT_TO_CAPABILITY[outputTypeId] ?? 'custom.bestEffort';
}

/** 别名：输出类型 → 背后能力 id（语义同 backingCapability）。 */
export const capabilityForOutput = backingCapability;
