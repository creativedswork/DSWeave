/**
 * 测试用「假 ACP Agent」：说官方 ACP（@agentclientprotocol/sdk 的 AgentSideConnection），
 * 行为模拟 Claude——收到 prompt 后解析其中的 <DSWEAVE_CONTEXT>，请求一次写权限，
 * 把一个自包含 HTML 写到 cwd/index.html，并返回 end_turn。
 *
 * 用途：让烟测在沙箱内验证 Stage B 的「官方 ACP client + bridge + index.html 收口
 * + 能力出物 + 权限流」全链路，而无需真实模型 / 余额 / 外网。
 * 运行方式：由 inProcessClaudeAgentConnector 经 CLAUDE_ACP_CMD=node CLAUDE_ACP_ARGS=<此文件> spawn。
 */
import { Readable, Writable } from 'node:stream';
import { writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  AgentSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent,
  type CancelNotification,
  type InitializeRequest,
  type InitializeResponse,
  type NewSessionRequest,
  type NewSessionResponse,
  type PromptRequest,
  type PromptResponse,
} from '@agentclientprotocol/sdk';

interface CtxModel {
  nodeId: string;
  parts: string[];
}
interface CtxDoc {
  nodeId: string;
  label: string;
  chunks: { id: string; text: string }[];
}
interface CtxImage {
  nodeId: string;
  label: string;
}
interface CtxEdge {
  from: string;
  to: string;
  semantics: string;
}
interface Ctx {
  models: CtxModel[];
  docs: CtxDoc[];
  images?: CtxImage[];
  edges?: CtxEdge[];
}

function parseContext(text: string): Ctx {
  // 取最后一个完整块（前文规则里可能提到标签名），并对捕获内容做 JSON 兜底。
  const matches = [...text.matchAll(/<DSWEAVE_CONTEXT>\s*([\s\S]*?)\s*<\/DSWEAVE_CONTEXT>/g)];
  const last = matches[matches.length - 1];
  if (!last || !last[1]) return { models: [], docs: [] };
  try {
    return JSON.parse(last[1]) as Ctx;
  } catch {
    return { models: [], docs: [] };
  }
}

/**
 * 探测 cwd 里被物化的 skill（模拟真实编码 agent 的「原生发现」）：
 * 扫常见 skillsDir 下含 SKILL.md 的子目录，返回它们的 id。
 */
function discoverSkillIds(): string[] {
  const dirs = ['.claude/skills', '.agents/skills', '.gemini/skills'];
  const ids = new Set<string>();
  for (const d of dirs) {
    try {
      if (!existsSync(d)) continue;
      for (const name of readdirSync(d)) {
        if (existsSync(join(d, name, 'SKILL.md'))) ids.add(name);
      }
    } catch {
      // 忽略
    }
  }
  return [...ids].sort();
}

function buildHtml(ctx: Ctx): string {
  const model = ctx.models[0];
  const img = (ctx.images ?? [])[0];
  const sem = (ctx.edges ?? []).map((e) => e.semantics).filter(Boolean).join('；');
  let body = `这是模型的说明文字。${sem ? `连线意图：${sem}。` : ''}`;
  while (body.length < 520) body += `本说明用于验证 Agent 自撰长文能够进入最终产物。`;
  const viewer = model
    ? `<model-viewer src="asset://${model.nodeId}" camera-controls auto-rotate style="width:100%;height:480px"></model-viewer>`
    : '';
  const image = img ? `<img src="asset://${img.nodeId}" style="max-width:100%">` : '';
  // 把「原生发现到的 skill」写进注释，供烟测验证物化链路（接缝②）。
  const skillMarker = `<!-- dsweave-skills: ${discoverSkillIds().join(',')} -->`;
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>fake</title></head><body>${skillMarker}${viewer}${image}<section><p>${body}</p></section></body></html>`;
}

const stream = ndJsonStream(
  Writable.toWeb(process.stdout) as WritableStream<Uint8Array>,
  Readable.toWeb(process.stdin) as unknown as ReadableStream<Uint8Array>,
);

new AgentSideConnection((conn): Agent => {
  let seq = 0;
  return {
    async initialize(_p: InitializeRequest): Promise<InitializeResponse> {
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: {},
        authMethods: [],
      };
    },
    async newSession(_p: NewSessionRequest): Promise<NewSessionResponse> {
      return { sessionId: `fake_${++seq}` };
    },
    async authenticate() {
      return {};
    },
    async prompt(p: PromptRequest): Promise<PromptResponse> {
      const text = p.prompt
        .map((b) => (b.type === 'text' ? b.text : ''))
        .join('\n');
      const ctx = parseContext(text);

      await conn.sessionUpdate({
        sessionId: p.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在根据上下文生成 index.html…\n' } },
      });

      // 请求写权限（模拟 Claude 写文件前的授权）
      await conn.requestPermission({
        sessionId: p.sessionId,
        toolCall: { toolCallId: 'write_1', title: '写入 index.html', kind: 'edit', status: 'pending' },
        options: [
          { kind: 'allow_once', name: '允许', optionId: 'allow' },
          { kind: 'reject_once', name: '拒绝', optionId: 'reject' },
        ],
      });

      await conn.sessionUpdate({
        sessionId: p.sessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: 'write_1', title: 'Write index.html', kind: 'edit', status: 'completed' },
      });

      writeFileSync(join(process.cwd(), 'index.html'), buildHtml(ctx), 'utf-8');

      await conn.sessionUpdate({
        sessionId: p.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已写出 index.html。\n' } },
      });

      return { stopReason: 'end_turn' };
    },
    async cancel(_p: CancelNotification): Promise<void> {
      // no-op
    },
  };
}, stream);
