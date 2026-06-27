import { useEffect, useState } from 'react';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { ComposableTextarea } from '../components/ComposableTextarea';

export function EdgeEditor() {
  const editingEdgeId = useDSWeaveStore((s) => s.editingEdgeId);
  const edge = useDSWeaveStore((s) => s.edges.find((e) => e.id === s.editingEdgeId));
  const nodes = useDSWeaveStore((s) => s.nodes);
  const updateEdgeData = useDSWeaveStore((s) => s.updateEdgeData);
  const removeEdge = useDSWeaveStore((s) => s.removeEdge);
  const setEditingEdge = useDSWeaveStore((s) => s.setEditingEdge);

  const [paramsText, setParamsText] = useState('');
  const [paramsError, setParamsError] = useState<string | null>(null);

  useEffect(() => {
    if (edge) {
      setParamsText(edge.data?.params ? JSON.stringify(edge.data.params, null, 2) : '');
      setParamsError(null);
    }
  }, [editingEdgeId, edge]);

  if (!editingEdgeId || !edge) return null;

  const labelOf = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) return id;
    if (n.data.kind === 'source') return n.data.label;
    return `输出·${n.data.output.typeId}`;
  };

  const commitParams = (text: string) => {
    setParamsText(text);
    if (text.trim() === '') {
      setParamsError(null);
      updateEdgeData(edge.id, { params: undefined });
      return;
    }
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      setParamsError(null);
      updateEdgeData(edge.id, { params: parsed });
    } catch {
      setParamsError('不是合法的 JSON');
    }
  };

  return (
    <aside className="absolute right-3 top-3 z-10 w-80 rounded-xl border border-neutral-800 bg-neutral-950/95 p-4 shadow-2xl backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">连线语义</h2>
        <button
          type="button"
          onClick={() => setEditingEdge(null)}
          className="rounded px-1.5 text-neutral-500 hover:bg-neutral-800 hover:text-neutral-200"
        >
          ✕
        </button>
      </div>

      <p className="mb-3 truncate text-[11px] text-neutral-500">
        <span className="text-neutral-300">{labelOf(edge.source)}</span>
        <span className="mx-1 text-neutral-600">→</span>
        <span className="text-neutral-300">{labelOf(edge.target)}</span>
      </p>

      <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
        语义（这条连线代表什么关系 / 操作）
      </label>
      <ComposableTextarea
        autoFocus
        value={edge.data?.semantics ?? ''}
        onValueChange={(semantics) => updateEdgeData(edge.id, { semantics })}
        placeholder="例：把这份文档作为该模型部件的解说内容"
        rows={3}
        className="mb-3 w-full resize-none rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-sky-500"
      />

      <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
        参数（可选 · JSON）
      </label>
      <ComposableTextarea
        value={paramsText}
        onValueChange={commitParams}
        placeholder='例：{ "weight": 0.8 }'
        rows={3}
        className={`mb-1 w-full resize-none rounded-md border bg-neutral-900 px-2 py-1.5 font-mono text-[11px] text-neutral-100 outline-none placeholder:text-neutral-600 ${
          paramsError ? 'border-rose-500 focus:border-rose-500' : 'border-neutral-700 focus:border-sky-500'
        }`}
      />
      {paramsError && <p className="mb-2 text-[10px] text-rose-400">{paramsError}</p>}

      <div className="mt-3 flex justify-between">
        <button
          type="button"
          onClick={() => removeEdge(edge.id)}
          className="rounded-md border border-rose-500/40 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-500/10"
        >
          删除连线
        </button>
        <button
          type="button"
          onClick={() => setEditingEdge(null)}
          className="rounded-md bg-sky-600 px-3 py-1 text-xs font-medium text-white hover:bg-sky-500"
        >
          完成
        </button>
      </div>
    </aside>
  );
}
