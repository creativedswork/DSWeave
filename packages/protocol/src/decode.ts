/**
 * Update → 执行态解码：把 ACP `session/update` 归一化成前端领域事件 DSWeaveEvent。
 */
import type { DSWeaveEvent } from './events.js';
import type { SessionUpdate } from './messages.js';

/** 把一个 SessionUpdate 解码成 DSWeaveEvent（一一映射，未知类型返回 null）。 */
export function decodeUpdate(update: SessionUpdate): DSWeaveEvent | null {
  switch (update.type) {
    case 'node-status':
      return {
        kind: 'node-status',
        nodeId: update.nodeId,
        status: update.status,
        message: update.message,
      };
    case 'edge-status':
      return { kind: 'edge-status', edgeId: update.edgeId, status: update.status };
    case 'tool-call':
      return { kind: 'tool-call', id: update.id, title: update.title, state: update.state };
    case 'log':
      return { kind: 'log', level: update.level, text: update.text };
    case 'artifact':
      return { kind: 'artifact', uri: update.uri, mime: update.mime, fromNodeId: update.fromNodeId };
    default:
      return null;
  }
}
