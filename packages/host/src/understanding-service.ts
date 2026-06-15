/**
 * 文件理解编排：登记文件 → provider 解析 → 上下文工程（分块/摘要）→ 内容寻址缓存 → 流式回填。
 *
 * - 内容寻址：缓存键 = 内容 hash + provider 版本，二次登记同内容命中即复用。
 * - 异步：未命中时立即返回 hash，理解就绪后经 onReady 回填（understanding/update）。
 * - in-flight 去重：同一缓存键的并发登记只解析一次。
 */
import type { Understanding } from '@dsweave/core';
import type { RegisterFileParams, RegisterFileResult, UnderstandingNotification } from '@dsweave/protocol';
import { FsService, type StoredFile } from './fs-service.js';
import type { ProviderRegistry, UnderstandIO } from './understanding/registry.js';
import { createDefaultRegistry } from './understanding/index.js';
import { chunkText } from './context/chunker.js';
import { summarizeChunks } from './context/summarize.js';

export type UnderstandingReadyCallback = (note: UnderstandingNotification) => void;

function decodeBase64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function makeIO(nodeId: string, stored: StoredFile): UnderstandIO {
  const decoder = new TextDecoder();
  return {
    nodeId,
    bytes: stored.bytes,
    text: () => decoder.decode(stored.bytes),
    asset: (path) => stored.assets.get(path),
    assetPaths: () => [...stored.assets.keys()],
  };
}

export class UnderstandingService {
  private readonly fs: FsService;
  private readonly registry: ProviderRegistry;
  /** 缓存键（hash@version）→ 理解结果。 */
  private readonly cache = new Map<string, Understanding>();
  /** in-flight 去重：缓存键 → 进行中的解析。 */
  private readonly inFlight = new Map<string, Promise<Understanding>>();
  /** nodeId → 已就绪的理解（供 prompt 注入）。 */
  private readonly byNode = new Map<string, Understanding>();

  constructor(registry: ProviderRegistry = createDefaultRegistry(), fs: FsService = new FsService()) {
    this.registry = registry;
    this.fs = fs;
  }

  /** prompt 注入用：取某节点已就绪的理解。 */
  getForNode(nodeId: string): Understanding | undefined {
    return this.byNode.get(nodeId);
  }

  /** 当前所有已就绪的 nodeId → 理解 的快照。 */
  snapshot(): Map<string, Understanding> {
    return new Map(this.byNode);
  }

  /**
   * 登记一个文件并触发理解。命中缓存时同步带回结果；否则异步经 onReady 回填。
   */
  register(params: RegisterFileParams, onReady: UnderstandingReadyCallback): RegisterFileResult {
    const { nodeId, ref } = params;
    const bytes = decodeBase64(params.content);
    const assets = (params.assets ?? []).map((a) => ({ path: a.path, bytes: decodeBase64(a.content) }));
    const stored = this.fs.store(ref, bytes, assets);
    const hash = stored.ref.hash as string;

    const provider = this.registry.get(ref.type);
    const version = provider?.version ?? 'none';
    const cacheKey = `${hash}@${version}`;

    const cached = this.cache.get(cacheKey);
    if (cached) {
      this.byNode.set(nodeId, cached);
      return { nodeId, hash, cached: true, understanding: cached };
    }

    // 启动（或复用 in-flight 的）异步解析，就绪后回填。
    const work =
      this.inFlight.get(cacheKey) ?? this.runUnderstand(cacheKey, nodeId, stored, provider);
    work
      .then((u) => {
        this.byNode.set(nodeId, u);
        onReady({ nodeId, hash, understanding: u });
      })
      .catch(() => {
        /* runUnderstand 内部已兜底，不会到这里 */
      });

    return { nodeId, hash, cached: false };
  }

  private runUnderstand(
    cacheKey: string,
    nodeId: string,
    stored: StoredFile,
    provider: ReturnType<ProviderRegistry['get']>,
  ): Promise<Understanding> {
    const promise = (async () => {
      const base = provider
        ? await safeUnderstand(provider, stored, nodeId)
        : ({ ready: true, metadata: { note: `无 ${stored.ref.type} provider，已登记未解析` } } as Understanding);
      const enriched = enrich(nodeId, base);
      this.cache.set(cacheKey, enriched);
      return enriched;
    })();
    this.inFlight.set(cacheKey, promise);
    void promise.finally(() => this.inFlight.delete(cacheKey));
    return promise;
  }
}

async function safeUnderstand(
  provider: NonNullable<ReturnType<ProviderRegistry['get']>>,
  stored: StoredFile,
  nodeId: string,
): Promise<Understanding> {
  try {
    return await provider.understand(stored.ref, makeIO(nodeId, stored));
  } catch (err) {
    return {
      ready: true,
      metadata: { error: `解析失败：${err instanceof Error ? err.message : String(err)}` },
    };
  }
}

/** 上下文工程：在 provider 产出之上补齐分块与摘要（引用追溯）。 */
function enrich(nodeId: string, u: Understanding): Understanding {
  if (!u.text || (u.chunks && u.chunks.length > 0)) {
    // 无正文（如 gltf/image）或已自带分块：补摘要（若可）后返回。
    return u;
  }
  const chunks = chunkText(nodeId, u.text, Boolean(u.outline && u.outline.length > 0));
  const summary = u.summary ?? summarizeChunks(chunks);
  return { ...u, chunks, summary };
}
