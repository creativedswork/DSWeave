import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { DSEdge } from '../types';
import { useDSWeaveStore } from '../store/useDSWeaveStore';

export function SemanticEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
}: EdgeProps<DSEdge>) {
  const setEditingEdge = useDSWeaveStore((s) => s.setEditingEdge);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });
  const semantics = data?.semantics?.trim();

  return (
    <>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{ stroke: selected ? '#38bdf8' : '#52525b', strokeWidth: selected ? 2 : 1.5 }}
      />
      <EdgeLabelRenderer>
        <button
          type="button"
          onClick={() => setEditingEdge(id)}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          className={`nodrag nopan pointer-events-auto absolute max-w-[180px] truncate rounded-md border px-2 py-1 text-[11px] shadow-sm transition-colors ${
            semantics
              ? 'border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-sky-500'
              : 'border-dashed border-neutral-600 bg-neutral-900/80 italic text-neutral-500 hover:border-sky-500'
          }`}
          title={semantics || '点击填写连线语义'}
        >
          {semantics || '+ 语义'}
        </button>
      </EdgeLabelRenderer>
    </>
  );
}
