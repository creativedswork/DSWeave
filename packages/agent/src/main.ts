/**
 * Mock Agent 独立进程入口：通过 stdin/stdout 走 ndjson ACP。
 * 注意：stdout 是协议通道，日志一律走 stderr。
 */
import { createMockAgent } from './agent.js';
import { StdioTransport } from './stdio.js';

const transport = new StdioTransport(process.stdin, process.stdout);
createMockAgent(transport);
process.stderr.write('[dsweave/agent] mock agent ready (stdio)\n');
