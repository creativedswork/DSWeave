/**
 * 通用「ACP 驱动的内部 Agent」核心（M4b 起复用）。
 *
 * 任何「说官方 ACP 的子进程」（Claude Code 的 claude-agent-acp、Gemini CLI 的 `gemini --acp` 等）
 * 接入方式完全一致：实现与启发式 Agent 相同的内部契约（AgentSideConnection：onPrompt +
 * sessionUpdate + requestPermission + invokeCapability），onPrompt 内部经官方 ACP 驱动该子进程
 * 产出 scene.spec.json，再交给 Host 的 scene.html 能力出物。
 *
 * 因此前端 / 内部协议 / bridge / 能力链路全部不变，**新增一个后端只需提供 adapter 的
 * 启动命令（command/args）与一个展示用 label**——这就是本文件存在的意义（DRY 收口）。
 *
 * 流程：编 prompt → spawn ACP adapter → prompt turn（流式 update/permission 透传前端）
 *   → 读 <cwd>/scene.spec.json → zod 校验（失败回灌重试）→ invokeCapability('scene.html') → 产物。
 */
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import {
  AgentSideConnection,
  type AcpTransport,
  type CancelParams,
  type NewSessionParams,
  type NewSessionResult,
  type PromptParams,
  type PromptResult,
  type SceneHtmlInput,
} from '@dsweave/protocol';
import { safeValidateSceneSpec, type SceneSpec } from '@dsweave/core';
import { capabilityForOutput } from '../capabilities/index.js';
import { AcpSession, type AcpSessionOptions } from '../claude/acp-client.js';
import { buildScenePrompt, buildRetryPrompt, SCENE_SPEC_FILENAME } from '../claude/prompt.js';

export interface AcpAgentOptions extends AcpSessionOptions {
  /** SceneSpec 校验失败时的最大回灌重试次数（默认 2）。 */
  maxRetries?: number;
}

/** 后端描述：把通用核心特化为某个具体 ACP agent（Claude / Gemini / …）。 */
export interface AcpBackendSpec {
  /** 展示用名称（日志/UI），如 'Claude' / 'Gemini'。 */
  label: string;
  /** 会话 id / 工作目录前缀，如 'claude' / 'gemini'（须为合法目录名）。 */
  slug: string;
  /** 把后端选项解析为最终的 adapter 启动命令（默认命令 + 环境变量覆盖）。 */
  resolveCommand: (opts: AcpSessionOptions) => { command: string; args: string[] };
}

let sessionSeq = 0;

/** 统一抽取错误信息：兼容 Error 与 JSON-RPC 错误对象（{code,message}）。 */
function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return typeof err === 'string' ? err : JSON.stringify(err);
}

/**
 * 创建一个 ACP 驱动的内部 Agent 连接（按 backend 特化）。
 * Claude / Gemini 的 createXxxAgent 都是本函数的薄包装。
 */
export function createAcpAgent(
  transport: AcpTransport,
  backend: AcpBackendSpec,
  options: AcpAgentOptions = {},
): AgentSideConnection {
  const cancelled = new Set<string>();
  return new AgentSideConnection(transport, {
    onNewSession(_p: NewSessionParams): NewSessionResult {
      return { sessionId: `${backend.slug}_${++sessionSeq}` };
    },
    onCancel(p: CancelParams): void {
      cancelled.add(p.sessionId);
    },
    onPrompt(p: PromptParams, conn: AgentSideConnection): Promise<PromptResult> {
      return run(p, conn, cancelled, backend, options);
    },
  });
}

async function run(
  params: PromptParams,
  conn: AgentSideConnection,
  cancelled: Set<string>,
  backend: AcpBackendSpec,
  options: AcpAgentOptions,
): Promise<PromptResult> {
  const { sessionId, prompt } = params;
  const graph = prompt.graph;
  const maxRetries = options.maxRetries ?? 2;
  const isCancelled = () => cancelled.has(sessionId);
  const log = (text: string, level: 'info' | 'warn' | 'error' = 'info') =>
    conn.sessionUpdate(sessionId, { type: 'log', level, text });

  log(
    `收到工作流「${graph.name}」：${graph.nodes.length} 节点 / ${graph.edges.length} 连线（${backend.label}）`,
  );

  // 源节点 UI 反馈
  for (const node of graph.nodes.filter((n) => n.kind === 'source')) {
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: node.id,
      status: 'done',
      message: node.understanding?.ready ? '已理解' : '已登记',
    });
  }

  const { text, context } = buildScenePrompt(prompt);
  const outputNode = graph.nodes.find((n) => n.kind === 'output');
  const outputNodeId = outputNode?.id ?? context.outputNodeId;
  const capability = capabilityForOutput(outputNode?.output?.typeId ?? context.outputTypeId);

  // 官方 ACP session/new 要求 cwd 为绝对路径；workingDir 可能为空/相对，统一兜底解析。
  const baseDir =
    prompt.workingDir && isAbsolute(prompt.workingDir)
      ? prompt.workingDir
      : resolve(process.cwd(), prompt.workingDir || '.');
  const cwd = join(baseDir, '.dsweave', backend.slug, `${sessionId}_${Date.now()}`);
  mkdirSync(cwd, { recursive: true });
  const specPath = join(cwd, SCENE_SPEC_FILENAME);

  const { command, args } = backend.resolveCommand(options);
  const session = new AcpSession({ ...options, command, args });
  const toolId = `${backend.slug}_${outputNodeId}`;
  let lineBuf = '';
  const flush = (force = false) => {
    const parts = lineBuf.split('\n');
    lineBuf = force ? '' : (parts.pop() ?? '');
    for (const line of parts) if (line.trim()) log(line.trim());
    if (force && lineBuf.trim()) log(lineBuf.trim());
  };

  try {
    conn.sessionUpdate(sessionId, { type: 'node-status', nodeId: outputNodeId, status: 'running' });
    log(`启动 ${backend.label}（官方 ACP）…`);
    await session.init(cwd);

    const handlers = {
      onText: (t: string) => {
        lineBuf += t;
        flush();
      },
      onToolCall: (info: { id: string; title: string; status: string }) =>
        conn.sessionUpdate(sessionId, {
          type: 'tool-call',
          id: info.id,
          title: info.title,
          state:
            info.status === 'completed' ? 'done' : info.status === 'failed' ? 'error' : 'running',
          nodeId: outputNodeId,
        }),
      onPermission: (summary: string) =>
        conn.requestPermission(sessionId, `${backend.label} 请求：${summary}`, ['允许', '拒绝']),
    };

    // prompt turn + 校验回灌重试
    let spec: SceneSpec | undefined;
    let promptText = text;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (isCancelled()) return finish(conn, sessionId, 'cancelled', session, cwd);
      const outcome = await session.prompt(promptText, handlers);
      flush(true);
      if (outcome.stopReason !== 'end_turn') {
        log(`${backend.label} turn 异常结束：${outcome.stopReason}`, 'warn');
      }
      if (!existsSync(specPath)) {
        if (attempt < maxRetries) {
          log(`未发现 ${SCENE_SPEC_FILENAME}，回灌重试（${attempt + 1}/${maxRetries}）`, 'warn');
          promptText = buildRetryPrompt(`未找到 ${SCENE_SPEC_FILENAME}`);
          continue;
        }
        break;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(specPath, 'utf-8'));
      } catch (e) {
        if (attempt < maxRetries) {
          promptText = buildRetryPrompt(`不是合法 JSON：${(e as Error).message}`);
          continue;
        }
        break;
      }
      const check = safeValidateSceneSpec(parsed);
      if (check.success) {
        spec = check.data as SceneSpec;
        break;
      }
      const issue = check.error.issues[0];
      const errMsg = `${issue?.path?.join('.') ?? ''}: ${issue?.message ?? '校验失败'}`;
      log(`SceneSpec 校验失败：${errMsg}`, 'warn');
      if (attempt < maxRetries) {
        promptText = buildRetryPrompt(errMsg);
      }
    }

    if (!spec) {
      conn.sessionUpdate(sessionId, {
        type: 'node-status',
        nodeId: outputNodeId,
        status: 'error',
        message: 'SceneSpec 未产出/非法',
      });
      return finish(conn, sessionId, 'error', session, cwd);
    }
    log(
      `SceneSpec 就绪：${spec.models.length} 模型 / ${spec.hotspots.length} 热点 / ${spec.panels.length} 面板`,
    );

    // 交给 Host 能力出物
    conn.sessionUpdate(sessionId, {
      type: 'tool-call',
      id: toolId,
      title: capability,
      state: 'running',
      nodeId: outputNodeId,
    });
    const input: SceneHtmlInput = { spec };
    const res = await conn.invokeCapability({ sessionId, capability, outputNodeId, input });
    conn.sessionUpdate(sessionId, {
      type: 'tool-call',
      id: toolId,
      title: capability,
      state: 'done',
      nodeId: outputNodeId,
    });
    conn.sessionUpdate(sessionId, {
      type: 'artifact',
      uri: res.artifact.uri,
      mime: res.artifact.mime,
      fromNodeId: outputNodeId,
    });
    log(
      res.cached
        ? `产物命中缓存：${res.artifact.uri}`
        : `产物已生成：${res.artifact.uri}（${res.artifact.bytes} 字节）`,
    );
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: outputNodeId,
      status: 'done',
      message: res.cached ? '产物已就绪（缓存）' : '产物已生成',
    });

    return finish(conn, sessionId, 'end_turn', session, cwd);
  } catch (err) {
    log(`${backend.label} Agent 失败：${errMessage(err)}`, 'error');
    conn.sessionUpdate(sessionId, {
      type: 'node-status',
      nodeId: outputNodeId,
      status: 'error',
      message: '产出失败',
    });
    return finish(conn, sessionId, 'error', session, cwd);
  }
}

function finish(
  conn: AgentSideConnection,
  sessionId: string,
  reason: PromptResult['stopReason'],
  session: AcpSession,
  cwd: string,
): PromptResult {
  session.dispose();
  if (!process.env.DSWEAVE_KEEP_WORKDIR) {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {
      // 清理失败可忽略
    }
  } else {
    conn.sessionUpdate(sessionId, { type: 'log', level: 'info', text: `workdir 保留：${cwd}` });
  }
  conn.sessionUpdate(sessionId, {
    type: 'log',
    level: reason === 'end_turn' ? 'info' : 'warn',
    text: reason === 'end_turn' ? '完成' : `已停止：${reason}`,
  });
  return { stopReason: reason };
}
