import { CapabilityRegistry } from './registry.js';
import { sceneHtmlCapability } from './scene-html.js';

export { CapabilityRegistry } from './registry.js';
export type { Capability, CapabilityInvocation, CapabilityRuntime } from './registry.js';
export { sceneHtmlCapability } from './scene-html.js';
export type { ChunkInfo } from './scene-html.js';
export {
  OUTPUT_TYPES,
  capabilityForOutput,
  visibleOutputTypes,
} from './output-types.js';
export type { OutputType } from './output-types.js';

/** 默认能力注册表（M4a：scene.html）。 */
export function createDefaultCapabilityRegistry(): CapabilityRegistry {
  return new CapabilityRegistry().register(sceneHtmlCapability);
}
