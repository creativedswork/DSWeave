/**
 * @dsweave/host — Node 进程：WS 桥接、文件服务、文件理解、能力执行、Agent 管理。
 *
 * M0 仅占位。后续里程碑实现：
 * - server / bridge：WebSocket ↔ Agent stdio 中继
 * - fs-service：文件登记 + hash + 资源 uri
 * - understanding：文档解析 + gltf 渲染/元数据
 * - context：分块 / 摘要 / 检索
 * - capabilities：scene.html / gltf.render / fs.write（输出菜单从能力派生）
 */

export const HOST_VERSION = '0.0.0';

export interface HostOptions {
  /** 沙箱工作目录。 */
  workingDir: string;
  /** WebSocket 监听端口。 */
  port?: number;
}

/** 占位：创建并启动 Host（M2 起实现）。 */
export function createHost(options: HostOptions): { options: HostOptions } {
  return { options };
}
