import { useEffect, useRef, useState } from 'react';
import { useDSWeaveStore } from '../store/useDSWeaveStore';

const LEVEL_COLOR: Record<string, string> = {
  info: 'text-neutral-300',
  warn: 'text-amber-300',
  error: 'text-rose-300',
};

function ts(t: number): string {
  const d = new Date(t);
  return d.toLocaleTimeString('zh-CN', { hour12: false });
}

export function LogTimeline() {
  const logs = useDSWeaveStore((s) => s.logs);
  const runError = useDSWeaveStore((s) => s.runError);
  const [collapsed, setCollapsed] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!collapsed) endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [logs, collapsed]);

  return (
    <section className="flex shrink-0 flex-col border-t border-neutral-800 bg-neutral-950">
      <div className="flex items-center justify-between px-4 py-1.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">日志</h2>
          <span className="text-[10px] text-neutral-600">{logs.length}</span>
          {runError && <span className="text-[10px] text-rose-400">· {runError}</span>}
        </div>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="rounded px-1.5 text-[10px] text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          {collapsed ? '展开' : '收起'}
        </button>
      </div>
      {!collapsed && (
        <div className="h-36 overflow-y-auto border-t border-neutral-900 px-4 py-2 font-mono text-[11px] leading-relaxed">
          {logs.length === 0 ? (
            <p className="text-neutral-600">点击「Start」运行工作流，日志将在此滚动。</p>
          ) : (
            logs.map((l) => (
              <div key={l.id} className="flex gap-2">
                <span className="shrink-0 text-neutral-600">{ts(l.ts)}</span>
                <span className={LEVEL_COLOR[l.level] ?? 'text-neutral-300'}>{l.text}</span>
              </div>
            ))
          )}
          <div ref={endRef} />
        </div>
      )}
    </section>
  );
}
