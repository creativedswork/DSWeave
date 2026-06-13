/**
 * 传输层抽象：前端业务只依赖 AcpTransport，因此 WebSocket → Tauri IPC 迁移无感。
 *
 * - WebSocketTransport：前端 ↔ Host
 * - StdioTransport：Host ↔ Agent（基于 @agentclientprotocol/sdk）
 */
export interface AcpTransport {
  send(message: unknown): void;
  onMessage(handler: (message: unknown) => void): void;
  close(): void;
}
