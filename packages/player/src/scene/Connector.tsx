import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { Quaternion, Vector3 } from 'three';
import type { ResolvedTheme } from '../theme.js';

export interface ConnectorProps {
  from: [number, number, number];
  to: [number, number, number];
  label?: string;
  style?: 'arrow' | 'line';
  theme: ResolvedTheme;
}

/** 两元素间的有向连接：线段 +（可选）箭头 +（可选）中点标注。 */
export function Connector({ from, to, label, style = 'arrow', theme }: ConnectorProps) {
  const geom = useMemo(() => {
    const a = new Vector3(...from);
    const b = new Vector3(...to);
    const dir = new Vector3().subVectors(b, a);
    const len = dir.length() || 1;
    dir.normalize();
    const headLen = style === 'arrow' ? Math.min(0.35, len * 0.25) : 0;
    // 线段终点回退一个箭头长度，留出箭头空间。
    const lineEnd = new Vector3().copy(b).addScaledVector(dir, -headLen);
    const tip = new Vector3().copy(b).addScaledVector(dir, -headLen / 2);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
    const mid = new Vector3().addVectors(a, lineEnd).multiplyScalar(0.5);
    return {
      points: [a.toArray() as [number, number, number], lineEnd.toArray() as [number, number, number]],
      tip: tip.toArray() as [number, number, number],
      quaternion: q,
      mid: mid.toArray() as [number, number, number],
      headLen,
    };
  }, [from, to, style]);

  return (
    <group>
      <Line points={geom.points} color={theme.accent} lineWidth={2.5} />
      {style === 'arrow' && geom.headLen > 0 && (
        <mesh position={geom.tip} quaternion={geom.quaternion}>
          <coneGeometry args={[geom.headLen * 0.5, geom.headLen, 16]} />
          <meshStandardMaterial color={theme.accent} emissive={theme.accent} emissiveIntensity={0.3} />
        </mesh>
      )}
      {label && (
        <Html position={geom.mid} center distanceFactor={8} zIndexRange={[35, 0]}>
          <div
            style={{
              padding: '2px 9px',
              borderRadius: 999,
              background: theme.accent,
              color: '#0a0a0f',
              fontFamily: 'system-ui, sans-serif',
              fontSize: 11.5,
              fontWeight: 700,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
            }}
          >
            {label}
          </div>
        </Html>
      )}
    </group>
  );
}
