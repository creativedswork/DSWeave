/**
 * 服务端 ws 连接的 AcpTransport 适配（Node `ws` 库）。
 */
import { WebSocket } from 'ws';
import type { RawData } from 'ws';
import type { AcpTransport } from '@dsweave/protocol';

export class NodeWsTransport implements AcpTransport {
  private readonly ws: WebSocket;
  private messageHandler: ((message: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on('message', (data: RawData, isBinary: boolean) => this.onData(data, isBinary));
    ws.on('close', () => this.closeHandler?.());
  }

  private onData(data: RawData, isBinary: boolean): void {
    if (!this.messageHandler) return;
    const text = isBinary ? '' : data.toString();
    if (!text) return;
    try {
      this.messageHandler(JSON.parse(text));
    } catch {
      // 忽略非法帧。
    }
  }

  send(message: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    this.ws.close();
  }
}
