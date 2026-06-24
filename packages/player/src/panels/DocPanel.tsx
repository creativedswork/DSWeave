import type { ScenePanel } from '@dsweave/core';
import type { ResolvedTheme } from '../theme.js';
import type { ChunkInfo } from '../spec.js';

export interface DocPanelProps {
  panels: ScenePanel[];
  chunks: Record<string, ChunkInfo>;
  citations: boolean;
  theme: ResolvedTheme;
}

/** 侧栏文档面板：呈现 SceneSpec.panels 绑定的文档片段（可带来源引用）。 */
export function DocPanel({ panels, chunks, citations, theme }: DocPanelProps) {
  if (panels.length === 0) return null;
  return (
    <aside
      style={{
        width: 320,
        flexShrink: 0,
        height: '100%',
        overflowY: 'auto',
        padding: '20px 18px',
        background: theme.panelBg,
        borderLeft: `1px solid ${theme.panelBorder}`,
        backdropFilter: 'blur(8px)',
        fontFamily: 'system-ui, sans-serif',
        color: theme.text,
      }}
    >
      {panels.map((panel, pi) => (
        <section key={pi} style={{ marginBottom: 22 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 13, fontWeight: 700, color: theme.accent }}>
            {panel.title}
          </h3>
          {panel.chunkIds.length === 0 ? (
            <p style={{ fontSize: 12, color: theme.textDim }}>（无内容）</p>
          ) : (
            panel.chunkIds.map((id) => {
              const c = chunks[id];
              if (!c) return null;
              return (
                <div key={id} style={{ marginBottom: 10 }}>
                  <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.6, color: theme.text }}>
                    {c.text}
                  </p>
                  {citations && (c.loc || c.label) && (
                    <p style={{ margin: '4px 0 0', fontSize: 10.5, color: theme.textDim }}>
                      来源：{c.label ?? c.nodeId}
                      {c.loc ? ` · ${c.loc}` : ''}
                    </p>
                  )}
                </div>
              );
            })
          )}
        </section>
      ))}
    </aside>
  );
}
