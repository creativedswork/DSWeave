/**
 * StdioTransport：基于 Node 流的 ndjson 传输（每行一个 JSON 消息）。
 * 用于把 Agent 作为独立子进程，通过 stdin/stdout 与 Host 通信。
 */
import type { Readable, Writable } from 'node:stream';
import type { AcpTransport } from '@dsweave/protocol';

export class StdioTransport implements AcpTransport {
  private readonly output: Writable;
  private buffer = '';
  private messageHandler: ((message: unknown) => void) | null = null;
  private closeHandler: (() => void) | null = null;

  constructor(input: Readable, output: Writable) {
    this.output = output;
    input.setEncoding('utf8');
    input.on('data', (chunk: string) => this.onData(chunk));
    input.on('close', () => this.closeHandler?.());
    input.on('end', () => this.closeHandler?.());
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.messageHandler?.(JSON.parse(trimmed));
      } catch {
        // 忽略无法解析的行（可能是混入的非协议输出）。
      }
    }
  }

  send(message: unknown): void {
    this.output.write(JSON.stringify(message) + '\n');
  }

  onMessage(handler: (message: unknown) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  close(): void {
    // 不强制关闭进程标准流，由进程生命周期管理。
  }
}
