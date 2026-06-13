import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { Mesh } from 'three';
import type { SceneSpec } from '@dsweave/core';

function SpinningBox() {
  const ref = useRef<Mesh>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.4;
  });
  return (
    <mesh ref={ref}>
      <boxGeometry args={[1.4, 1.4, 1.4]} />
      <meshStandardMaterial color="#38bdf8" metalness={0.3} roughness={0.4} />
    </mesh>
  );
}

export function Player({ spec }: { spec: SceneSpec }) {
  return (
    <div style={{ position: 'relative', height: '100%' }}>
      <Canvas camera={{ position: [3, 2, 4], fov: 50 }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <SpinningBox />
        <OrbitControls enablePan enableZoom />
      </Canvas>
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: '#e5e5e5',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div style={{ fontWeight: 600 }}>{spec.panels[0]?.title ?? 'DSWeave Scene'}</div>
        <div style={{ fontSize: 12, color: '#737373' }}>
          layout: {spec.layout} · models: {spec.models.length} · M0 占位场景
        </div>
      </div>
    </div>
  );
}
