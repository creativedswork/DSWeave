import { Html } from '@react-three/drei';
import type { ResolvedTheme } from '../theme.js';

export interface HotspotProps {
  position: [number, number, number];
  title: string;
  index: number;
  active: boolean;
  theme: ResolvedTheme;
  onSelect: () => void;
}

/** 3D 空间中的可点热点标记（点击弹出关联文档片段）。 */
export function Hotspot({ position, title, index, active, theme, onSelect }: HotspotProps) {
  return (
    <Html position={position} center distanceFactor={8} zIndexRange={[40, 0]}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: active ? '4px 10px' : '4px 4px',
          borderRadius: 999,
          border: `1px solid ${theme.panelBorder}`,
          background: active ? theme.accent : theme.panelBg,
          color: active ? '#0a0a0f' : theme.text,
          cursor: 'pointer',
          fontFamily: 'system-ui, sans-serif',
          fontSize: 12,
          fontWeight: 600,
          whiteSpace: 'nowrap',
          boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
          transition: 'all 0.15s ease',
        }}
        title={title}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 18,
            height: 18,
            borderRadius: 999,
            background: active ? '#0a0a0f' : theme.accent,
            color: active ? theme.accent : '#0a0a0f',
            fontSize: 11,
          }}
        >
          {index + 1}
        </span>
        {active && <span>{title}</span>}
      </button>
    </Html>
  );
}
