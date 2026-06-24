import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Box3, Vector3 } from 'three';
import type { Group } from 'three';
import type { SceneModel, SceneHotspot, SceneImage, SceneConnector, Transform } from '@dsweave/core';
import type { ResolvedTheme } from '../theme.js';
import { useGltfModel } from './ModelLoader.js';
import { Hotspot } from '../hotspots/Hotspot.js';
import { ImagePlane } from './ImagePlane.js';
import { Connector } from './Connector.js';

export function hotspotKey(h: SceneHotspot, i: number): string {
  return `${h.modelNodeId}::${h.part}::${i}`;
}

/** 占位模型（资产缺失/加载失败时渲染，保证场景仍可看）。 */
function Placeholder({ color }: { color: string }) {
  const ref = useRef<Group>(null);
  useFrame((_, delta) => {
    if (ref.current) ref.current.rotation.y += delta * 0.4;
  });
  return (
    <group ref={ref}>
      <mesh>
        <icosahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={color} flatShading metalness={0.2} roughness={0.6} />
      </mesh>
    </group>
  );
}

interface ModelViewProps {
  model: SceneModel;
  position: [number, number, number];
  hotspots: { spot: SceneHotspot; index: number }[];
  selectedKey: string | null;
  theme: ResolvedTheme;
  onSelect: (key: string) => void;
}

function ModelView({ model, position, hotspots, selectedKey, theme, onSelect }: ModelViewProps) {
  const { group, error, fitScale, center } = useGltfModel(model.assetRef);
  const spin = useRef<Group>(null);

  useFrame((_, delta) => {
    if (model.autoRotate !== false && spin.current) spin.current.rotation.y += delta * 0.3;
  });

  const anchors = useMemo(() => {
    const map: Record<string, [number, number, number]> = {};
    if (!group) return map;
    group.updateMatrixWorld(true);
    hotspots.forEach(({ spot, index }, i) => {
      const obj = group.getObjectByName(spot.part);
      const v = new Vector3();
      if (obj) {
        new Box3().setFromObject(obj).getCenter(v);
      } else {
        const ang = (i / Math.max(hotspots.length, 1)) * Math.PI * 2;
        v.set(Math.cos(ang) * (center.length() || 1), center.y, Math.sin(ang) * (center.length() || 1));
      }
      map[hotspotKey(spot, index)] = [v.x, v.y, v.z];
    });
    return map;
  }, [group, hotspots, center]);

  const scaleArr = scaleToArray(model.placement?.scale);

  return (
    <group position={position} scale={scaleArr} rotation={model.placement?.rotation}>
      <group ref={spin}>
        {group ? (
          <group scale={fitScale} position={[-center.x * fitScale, -center.y * fitScale, -center.z * fitScale]}>
            <primitive object={group} />
            {hotspots.map(({ spot, index }) => (
              <Hotspot
                key={hotspotKey(spot, index)}
                position={anchors[hotspotKey(spot, index)] ?? [0, 0, 0]}
                title={spot.title}
                index={index}
                active={selectedKey === hotspotKey(spot, index)}
                theme={theme}
                onSelect={() => onSelect(hotspotKey(spot, index))}
              />
            ))}
          </group>
        ) : (
          <Placeholder color={error ? '#f43f5e' : theme.accent} />
        )}
      </group>
    </group>
  );
}

function scaleToArray(s: Transform['scale']): [number, number, number] | undefined {
  if (typeof s === 'number') return [s, s, s];
  return s;
}

export interface StageProps {
  models: SceneModel[];
  images: SceneImage[];
  connectors: SceneConnector[];
  hotspots: SceneHotspot[];
  layout: 'single-focus' | 'gallery';
  selectedKey: string | null;
  theme: ResolvedTheme;
  onSelect: (key: string) => void;
}

/**
 * 场景骨架：相机/光照/控制 + 统一布局（模型 + 图片）+ 热点 + 连接箭头。
 * 布局：尊重元素自带 placement.position；其余沿 X 轴居中并排（图片在前=左侧）。
 */
export function Stage({ models, images, connectors, hotspots, selectedKey, theme, onSelect }: StageProps) {
  const spacing = 3.4;
  const indexed = hotspots.map((spot, index) => ({ spot, index }));

  // 解析每个元素（按 nodeId）的世界位置，供模型/图片渲染与连接端点查询。
  const positions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    const els: { nodeId: string; placement?: Transform }[] = [
      ...images.map((im) => ({ nodeId: im.nodeId, placement: im.placement })),
      ...models.map((m) => ({ nodeId: m.nodeId, placement: m.placement })),
    ];
    const auto = els.filter((e) => !e.placement?.position);
    for (const e of els) if (e.placement?.position) map.set(e.nodeId, e.placement.position);
    const n = auto.length;
    auto.forEach((e, i) => {
      map.set(e.nodeId, [(i - (n - 1) / 2) * spacing, 0, 0]);
    });
    return map;
  }, [models, images]);

  const hasContent = models.length > 0 || images.length > 0;

  return (
    <>
      <color attach="background" args={[theme.bg]} />
      <ambientLight intensity={0.6} />
      <directionalLight position={[5, 6, 5]} intensity={1.2} />
      <directionalLight position={[-4, 2, -3]} intensity={0.4} />

      {!hasContent && <Placeholder color={theme.accent} />}

      {models.map((model) => (
        <ModelView
          key={model.nodeId}
          model={model}
          position={positions.get(model.nodeId) ?? [0, 0, 0]}
          hotspots={indexed.filter((h) => h.spot.modelNodeId === model.nodeId)}
          selectedKey={selectedKey}
          theme={theme}
          onSelect={onSelect}
        />
      ))}

      {images.map((image) => (
        <ImagePlane
          key={image.nodeId}
          image={image}
          position={positions.get(image.nodeId) ?? [0, 0, 0]}
          theme={theme}
        />
      ))}

      {connectors.map((c, i) => {
        const from = positions.get(c.fromNodeId);
        const to = positions.get(c.toNodeId);
        if (!from || !to) return null;
        return (
          <Connector key={i} from={from} to={to} label={c.label} style={c.style} theme={theme} />
        );
      })}

      <OrbitControls enablePan enableZoom makeDefault />
    </>
  );
}
