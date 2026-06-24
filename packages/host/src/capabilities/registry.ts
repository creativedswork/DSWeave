/**
 * 能力注册表：Host 把「输出类型」背后的产出能力以可插拔单元注册，供 Agent 调用。
 *
 * Agent 只声明意图（SceneSpec / 输出类型），真正「产出可运行产物」由 Host 能力完成，
 * 把易错的代码固化在 Host/构建期。能力 id 与输出类型注册表对齐（输出菜单从能力派生）。
 */
import type { CapabilityInvokeResult } from '@dsweave/protocol';
import type { UnderstandingService } from '../understanding-service.js';
import type { ArtifactStore } from '../artifacts.js';

/** 能力执行所需的 Host 运行时依赖。 */
export interface CapabilityRuntime {
  understanding: UnderstandingService;
  artifacts: ArtifactStore;
}

/** 一次能力调用。 */
export interface CapabilityInvocation {
  outputNodeId?: string;
  input: unknown;
}

export interface Capability {
  readonly id: string;
  readonly version: string;
  invoke(inv: CapabilityInvocation, rt: CapabilityRuntime): Promise<CapabilityInvokeResult>;
}

export class CapabilityRegistry {
  private readonly caps = new Map<string, Capability>();

  register(cap: Capability): this {
    this.caps.set(cap.id, cap);
    return this;
  }

  get(id: string): Capability | undefined {
    return this.caps.get(id);
  }

  ids(): string[] {
    return [...this.caps.keys()];
  }

  /** 调用一项能力；未注册时抛错。 */
  invoke(
    id: string,
    inv: CapabilityInvocation,
    rt: CapabilityRuntime,
  ): Promise<CapabilityInvokeResult> {
    const cap = this.caps.get(id);
    if (!cap) throw new Error(`未注册的能力：${id}`);
    return cap.invoke(inv, rt);
  }
}
