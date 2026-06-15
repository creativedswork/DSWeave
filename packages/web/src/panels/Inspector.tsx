import type { Understanding } from '@dsweave/core';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { isSourceData } from '../types';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-3">
      <h3 className="mb-1 text-[10px] uppercase tracking-wide text-neutral-500">{title}</h3>
      {children}
    </section>
  );
}

function bboxDims(u: Understanding): string | null {
  const b = u.model?.bbox;
  if (!b) return null;
  return b.max.map((v, i) => (v - (b.min[i] ?? 0)).toFixed(2)).join(' × ');
}

function ModelView({ u }: { u: Understanding }) {
  const parts = u.model?.nodes ?? [];
  const dims = bboxDims(u);
  return (
    <>
      {u.captions?.[0] && (
        <Section title="外观">
          <p className="text-[11px] leading-snug text-neutral-300">{u.captions[0]}</p>
        </Section>
      )}
      <Section title={`部件（${parts.length}）`}>
        {parts.length === 0 ? (
          <p className="text-[11px] text-neutral-600">无命名部件</p>
        ) : (
          <ul className="flex flex-wrap gap-1">
            {parts.map((p, i) => (
              <li
                key={`${p.name}_${i}`}
                className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-300 ring-1 ring-emerald-500/20"
                title={p.meshIndex != null ? `mesh ${p.meshIndex}` : undefined}
              >
                {p.name}
              </li>
            ))}
          </ul>
        )}
      </Section>
      {(u.model?.materials?.length ?? 0) > 0 && (
        <Section title="材质">
          <p className="text-[11px] text-neutral-300">{u.model!.materials!.join('、')}</p>
        </Section>
      )}
      {(u.model?.animations?.length ?? 0) > 0 && (
        <Section title="动画">
          <p className="text-[11px] text-neutral-300">{u.model!.animations!.join('、')}</p>
        </Section>
      )}
      {dims && (
        <Section title="包围盒尺寸">
          <p className="text-[11px] text-neutral-300">{dims}</p>
        </Section>
      )}
    </>
  );
}

function DocView({ u }: { u: Understanding }) {
  return (
    <>
      {u.summary && (
        <Section title="摘要">
          <p className="text-[11px] leading-snug text-neutral-300">{u.summary}</p>
        </Section>
      )}
      {u.outline && u.outline.length > 0 && (
        <Section title="大纲">
          <ul className="space-y-0.5">
            {u.outline.map((o, i) => (
              <li
                key={i}
                className="truncate text-[11px] text-neutral-300"
                style={{ paddingLeft: `${(o.level - 1) * 10}px` }}
              >
                {o.title}
              </li>
            ))}
          </ul>
        </Section>
      )}
      {u.schema && (
        <Section title="数据结构">
          <pre className="max-h-32 overflow-auto rounded bg-neutral-900 p-2 text-[10px] leading-snug text-neutral-300">
            {JSON.stringify(u.schema, null, 2)}
          </pre>
        </Section>
      )}
      {u.chunks && u.chunks.length > 0 && (
        <Section title={`分块（${u.chunks.length}）`}>
          <ul className="space-y-1">
            {u.chunks.slice(0, 8).map((c) => (
              <li key={c.id} className="rounded bg-neutral-900/70 p-1.5">
                {c.source.loc && (
                  <span className="mb-0.5 block text-[9px] uppercase text-sky-400/70">
                    {c.source.loc}
                  </span>
                )}
                <span className="line-clamp-3 text-[11px] leading-snug text-neutral-300">
                  {c.text}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

export function Inspector() {
  const selectedNodeId = useDSWeaveStore((s) => s.selectedNodeId);
  const node = useDSWeaveStore((s) => s.nodes.find((n) => n.id === s.selectedNodeId));
  const understanding = useDSWeaveStore((s) =>
    s.selectedNodeId ? s.understanding[s.selectedNodeId] : undefined,
  );
  const status = useDSWeaveStore((s) =>
    s.selectedNodeId ? s.understandStatus[s.selectedNodeId] : undefined,
  );
  const setSelectedNode = useDSWeaveStore((s) => s.setSelectedNode);

  if (!selectedNodeId || !node || !isSourceData(node.data)) return null;

  const isModel = Boolean(understanding?.model);

  return (
    <aside className="absolute left-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-xl border border-neutral-800 bg-neutral-950/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold text-neutral-100" title={node.data.label}>
            {node.data.label}
          </h2>
          <p className="text-[10px] uppercase text-neutral-500">{node.data.file.type} · 文件理解</p>
        </div>
        <button
          type="button"
          onClick={() => setSelectedNode(null)}
          className="rounded px-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      <div className="overflow-y-auto px-4 py-3">
        {!understanding ? (
          <p className="text-[11px] text-neutral-500">
            {status === 'pending'
              ? '正在解析文件…'
              : status === 'error'
                ? '未连接 Host：启动 `pnpm dev:host` 后重新拖入文件即可解析。'
                : '暂无理解结果。'}
          </p>
        ) : isModel ? (
          <ModelView u={understanding} />
        ) : (
          <DocView u={understanding} />
        )}
        {understanding?.metadata && (
          <Section title="元数据">
            <pre className="max-h-24 overflow-auto rounded bg-neutral-900 p-2 text-[10px] leading-snug text-neutral-400">
              {JSON.stringify(understanding.metadata, null, 2)}
            </pre>
          </Section>
        )}
      </div>
    </aside>
  );
}
