import type { ExecStatus } from '@dsweave/core';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { isOutputData, isSourceData } from '../types';
import { STATUS_DOT, STATUS_LABEL, TOOL_STATE_DOT } from '../lib/status';

function nodeTitle(label: string, kind: string): string {
  return kind === 'output' ? `输出·${label}` : label;
}

export function ExecutionPanel() {
  const nodes = useDSWeaveStore((s) => s.nodes);
  const runtime = useDSWeaveStore((s) => s.runtime);
  const toolCalls = useDSWeaveStore((s) => s.toolCalls);
  const artifacts = useDSWeaveStore((s) => s.artifacts);
  const running = useDSWeaveStore((s) => s.running);

  const rows = nodes.map((n) => {
    const status: ExecStatus = runtime[n.id] ?? 'idle';
    const label = isSourceData(n.data)
      ? n.data.label
      : isOutputData(n.data)
        ? n.data.output.typeId
        : n.id;
    return { id: n.id, kind: n.data.kind, label: nodeTitle(label, n.data.kind), status };
  });

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-300">执行</h2>
        {running && (
          <span className="flex items-center gap-1.5 text-[10px] text-sky-300">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-400" />
            运行中
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <section>
          <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">节点进度</h3>
          {rows.length === 0 ? (
            <p className="text-[11px] text-neutral-600">画布为空。</p>
          ) : (
            <ul className="space-y-1">
              {rows.map((r) => (
                <li
                  key={r.id}
                  className="flex items-center gap-2 rounded-md bg-neutral-900/60 px-2 py-1.5"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[r.status]}`} />
                  <span className="flex-1 truncate text-[11px] text-neutral-200" title={r.label}>
                    {r.label}
                  </span>
                  <span className="text-[10px] text-neutral-500">{STATUS_LABEL[r.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {toolCalls.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">工具调用</h3>
            <ul className="space-y-1">
              {toolCalls.map((t) => (
                <li
                  key={t.id}
                  className="flex items-center gap-2 rounded-md bg-neutral-900/60 px-2 py-1.5"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${TOOL_STATE_DOT[t.state]}`} />
                  <span className="flex-1 truncate text-[11px] text-neutral-200" title={t.title}>
                    {t.title}
                  </span>
                  <span className="text-[10px] text-neutral-500">{t.state}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {artifacts.length > 0 && (
          <section className="mt-4">
            <h3 className="mb-1.5 text-[10px] uppercase tracking-wide text-neutral-500">产物</h3>
            <ul className="space-y-1">
              {artifacts.map((a, i) => (
                <li
                  key={`${a.uri}_${i}`}
                  className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5"
                >
                  <p className="truncate text-[11px] text-emerald-200" title={a.uri}>
                    {a.uri}
                  </p>
                  <p className="text-[10px] text-neutral-500">{a.mime}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </aside>
  );
}
