import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { DSNode } from '../types';
import { isSourceData } from '../types';
import { SourcePreview } from '../previews';
import { useDSWeaveStore } from '../store/useDSWeaveStore';
import { statusRing } from '../lib/status';

const TYPE_BADGE: Record<string, string> = {
  gltf: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  md: 'bg-sky-500/15 text-sky-300 ring-sky-500/30',
  pdf: 'bg-rose-500/15 text-rose-300 ring-rose-500/30',
  txt: 'bg-neutral-500/15 text-neutral-300 ring-neutral-500/30',
  html: 'bg-orange-500/15 text-orange-300 ring-orange-500/30',
  image: 'bg-violet-500/15 text-violet-300 ring-violet-500/30',
  data: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
  unknown: 'bg-neutral-500/15 text-neutral-400 ring-neutral-500/30',
};

function formatSize(bytes?: number): string {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceNode({ id, data, selected }: NodeProps<DSNode>) {
  const status = useDSWeaveStore((s) => s.runtime[id]);
  if (!isSourceData(data)) return null;
  const badge = TYPE_BADGE[data.file.type] ?? TYPE_BADGE.unknown;
  const assetCount = data.file.assets?.length ?? 0;
  const ring = statusRing(status);
  return (
    <div
      className={`w-64 rounded-xl border bg-neutral-950/95 p-2.5 shadow-lg transition-colors ${
        ring || (selected ? 'border-sky-500' : 'border-neutral-800')
      }`}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!h-3 !w-3 !border-2 !border-neutral-950 !bg-neutral-500"
      />
      <div className="mb-2 flex items-center gap-2">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ring-1 ${badge}`}>
          {data.file.type}
        </span>
        <span className="flex-1 truncate text-xs font-medium text-neutral-200" title={data.label}>
          {data.label}
        </span>
        <span className="text-[10px] text-neutral-600">{formatSize(data.file.size)}</span>
      </div>
      <SourcePreview data={data} />
      <div className="mt-1.5 flex items-center gap-2 text-[10px]">
        {assetCount > 0 && (
          <span
            className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-emerald-300/80 ring-1 ring-emerald-500/20"
            title={`资源包：${assetCount} 个依赖（.bin / 纹理）`}
          >
            +{assetCount} 资源
          </span>
        )}
        {data.warning && (
          <span className="truncate text-amber-400" title={data.warning}>
            ⚠ {data.warning}
          </span>
        )}
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!h-3 !w-3 !border-2 !border-neutral-950 !bg-sky-500"
      />
    </div>
  );
}
