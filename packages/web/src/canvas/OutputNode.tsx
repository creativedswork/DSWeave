import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { OutputTypeId } from '@dsweave/core';
import type { DSNode } from '../types';
import { isOutputData } from '../types';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { VISIBLE_OUTPUT_TYPES, getOutputType } from '../lib/outputs';

export function OutputNode({ id, data, selected }: NodeProps<DSNode>) {
  const updateOutput = useDSWeaveStore((s) => s.updateOutput);
  if (!isOutputData(data)) return null;
  const def = getOutputType(data.output.typeId);

  return (
    <div
      className={`w-72 rounded-xl border bg-neutral-950/95 p-3 shadow-lg transition-colors ${
        selected ? 'border-fuchsia-500' : 'border-fuchsia-500/40'
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-neutral-950 !bg-fuchsia-500"
      />
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded bg-fuchsia-500/15 px-1.5 py-0.5 text-[10px] font-medium uppercase text-fuchsia-300 ring-1 ring-fuchsia-500/30">
          输出
        </span>
        <span className="text-xs font-medium text-neutral-200">目标产物</span>
      </div>

      <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
        输出类型（受限菜单）
      </label>
      <select
        value={data.output.typeId}
        onChange={(e) => updateOutput(id, { typeId: e.target.value as OutputTypeId })}
        className="nodrag mb-2 w-full rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-xs text-neutral-100 outline-none focus:border-fuchsia-500"
      >
        {VISIBLE_OUTPUT_TYPES.map((t) => (
          <option key={t.id} value={t.id}>
            {t.label}
          </option>
        ))}
      </select>
      <p className="mb-2 text-[10px] leading-snug text-neutral-500">{def.description}</p>

      <label className="mb-1 block text-[10px] uppercase tracking-wide text-neutral-500">
        软细节（自然语言）
      </label>
      <textarea
        value={data.output.spec}
        onChange={(e) => updateOutput(id, { spec: e.target.value })}
        placeholder={def.specPlaceholder}
        rows={3}
        className="nodrag w-full resize-none rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1.5 text-[11px] leading-snug text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-fuchsia-500"
      />
    </div>
  );
}
