import { Suspense, useMemo, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { SceneSpec } from '@dsweave/core';
import { Stage, hotspotKey } from './scene/Stage.js';
import { DocPanel } from './panels/DocPanel.js';
import { resolveTheme } from './theme.js';
import { loadChunks, type ChunkInfo } from './spec.js';

/** 选中热点时的解说浮层。 */
function HotspotPopover({
  title,
  bodies,
  citations,
  theme,
  onClose,
}: {
  title: string;
  bodies: ChunkInfo[];
  citations: boolean;
  theme: ReturnType<typeof resolveTheme>;
  onClose: () => void;
}) {
  return (
    <div
      style={{
        position: 'absolute',
        left: 24,
        bottom: 24,
        maxWidth: 420,
        padding: '16px 18px',
        background: theme.panelBg,
        border: `1px solid ${theme.panelBorder}`,
        borderRadius: 12,
        backdropFilter: 'blur(10px)',
        color: theme.text,
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 30px rgba(0,0,0,0.45)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
        <strong style={{ fontSize: 14, color: theme.accent }}>{title}</strong>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: theme.textDim,
            cursor: 'pointer',
            fontSize: 16,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
      {bodies.map((c, i) => (
        <div key={i} style={{ marginTop: 8 }}>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6 }}>{c.text}</p>
          {citations && (c.loc || c.label) && (
            <p style={{ margin: '4px 0 0', fontSize: 10.5, color: theme.textDim }}>
              来源：{c.label ?? c.nodeId}
              {c.loc ? ` · ${c.loc}` : ''}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

export function Player({ spec }: { spec: SceneSpec }) {
  const theme = useMemo(() => resolveTheme(spec.theme), [spec.theme]);
  const chunks = useMemo(() => loadChunks(), []);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!selectedKey) return null;
    const idx = spec.hotspots.findIndex((h, i) => hotspotKey(h, i) === selectedKey);
    if (idx < 0) return null;
    const h = spec.hotspots[idx]!;
    const bodies = h.bodyChunkIds.map((id) => chunks[id]).filter((c): c is ChunkInfo => Boolean(c));
    return { title: h.title, bodies };
  }, [selectedKey, spec.hotspots, chunks]);

  return (
    <div style={{ display: 'flex', height: '100%', background: theme.bg }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <Canvas camera={{ position: [3.5, 2.4, 4.5], fov: 50 }} onPointerMissed={() => setSelectedKey(null)}>
          <Suspense fallback={null}>
            <Stage
              models={spec.models}
              images={spec.images ?? []}
              connectors={spec.connectors ?? []}
              hotspots={spec.hotspots}
              layout={spec.layout}
              selectedKey={selectedKey}
              theme={theme}
              onSelect={setSelectedKey}
            />
          </Suspense>
        </Canvas>

        <div
          style={{
            position: 'absolute',
            top: 18,
            left: 20,
            color: theme.text,
            fontFamily: 'system-ui, sans-serif',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontWeight: 700, fontSize: 15 }}>{spec.panels[0]?.title ?? 'DSWeave Scene'}</div>
          <div style={{ fontSize: 11, color: theme.textDim }}>
            {spec.layout} · {spec.models.length} 模型
            {(spec.images?.length ?? 0) > 0 ? ` · ${spec.images!.length} 图片` : ''}
            {' · '}
            {spec.hotspots.length} 热点
            {(spec.connectors?.length ?? 0) > 0 ? ` · ${spec.connectors!.length} 连接` : ''}
          </div>
        </div>

        {selected && (
          <HotspotPopover
            title={selected.title}
            bodies={selected.bodies}
            citations={spec.citations}
            theme={theme}
            onClose={() => setSelectedKey(null)}
          />
        )}
      </div>

      <DocPanel panels={spec.panels} chunks={chunks} citations={spec.citations} theme={theme} />
    </div>
  );
}
