/**
 * 测试用「假 ACP Agent」：说官方 ACP（@agentclientprotocol/sdk 的 AgentSideConnection），
 * 行为模拟 Claude——收到 prompt 后解析其中的 <DSWEAVE_CONTEXT>，请求一次写权限，
 * 把一个合法 SceneSpec 写到 cwd/scene.spec.json，并返回 end_turn。
 *
 * 用途：让 m4b 烟测在沙箱内验证 Stage B 的「官方 ACP client + bridge + scene.spec.json 收口
 * + 能力出物 + 权限流」全链路，而无需真实模型 / 余额 / 外网。
 * 运行方式：由 inProcessClaudeAgentConnector 经 CLAUDE_ACP_CMD=node CLAUDE_ACP_ARGS=<此文件> spawn。
 */
import { Readable, Writable } from 'node:stream';
import { writeFileSync } from 'node:fs';
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
  chunks: { id: string; preview: string }[];
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

function buildSpec(ctx: Ctx): unknown {
  const model = ctx.models[0];
  const doc = ctx.docs[0];
  const imgs = ctx.images ?? [];
  const img = imgs[0];
  // 由连线语义取一个连接标注（模拟 LLM 从 edges 派生 connector）。
  const semantic = (ctx.edges ?? []).map((e) => e.semantics).find((s) => /生成|箭头|→|指向/.test(s));
  const label = semantic ? (semantic.match(/生成/) ? '生成' : semantic.slice(0, 6)) : '关联';

  return {
    version: 1,
    theme: { palette: 'dark', style: 'minimal' },
    layout: imgs.length + (model ? 1 : 0) > 1 ? 'gallery' : 'single-focus',
    models: model ? [{ nodeId: model.nodeId, assetRef: model.nodeId, autoRotate: true, placement: { position: [2, 0, 0] } }] : [],
    images: img ? [{ nodeId: img.nodeId, assetRef: img.nodeId, label: img.label, placement: { position: [-2, 0, 0] } }] : [],
    hotspots:
      model && model.parts[0] && doc && doc.chunks[0]
        ? [{ modelNodeId: model.nodeId, part: model.parts[0], title: '部件说明', bodyChunkIds: [doc.chunks[0].id] }]
        : [],
    panels: doc ? [{ title: doc.label, chunkIds: doc.chunks.map((c) => c.id) }] : [],
    connectors: img && model ? [{ fromNodeId: img.nodeId, toNodeId: model.nodeId, label, style: 'arrow' }] : [],
    citations: true,
  };
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
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '正在根据上下文生成 scene.spec.json…\n' } },
      });

      // 请求写权限（模拟 Claude 写文件前的授权）
      await conn.requestPermission({
        sessionId: p.sessionId,
        toolCall: { toolCallId: 'write_1', title: '写入 scene.spec.json', kind: 'edit', status: 'pending' },
        options: [
          { kind: 'allow_once', name: '允许', optionId: 'allow' },
          { kind: 'reject_once', name: '拒绝', optionId: 'reject' },
        ],
      });

      await conn.sessionUpdate({
        sessionId: p.sessionId,
        update: { sessionUpdate: 'tool_call', toolCallId: 'write_1', title: 'Write scene.spec.json', kind: 'edit', status: 'completed' },
      });

      writeFileSync(join(process.cwd(), 'scene.spec.json'), JSON.stringify(buildSpec(ctx), null, 2), 'utf-8');

      await conn.sessionUpdate({
        sessionId: p.sessionId,
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已写出 scene.spec.json。\n' } },
      });

      return { stopReason: 'end_turn' };
    },
    async cancel(_p: CancelNotification): Promise<void> {
      // no-op
    },
  };
}, stream);
