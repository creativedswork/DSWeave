import { useEffect, useMemo, useState } from 'react';
import { Html } from '@react-three/drei';
import { DoubleSide, TextureLoader, SRGBColorSpace } from 'three';
import type { Texture } from 'three';
import type { SceneImage } from '@dsweave/core';
import type { ResolvedTheme } from '../theme.js';
import { loadAssets } from '../spec.js';

/** 从注入的 assets（data URI）加载一张图片纹理，并返回宽高比。 */
function useImageTexture(assetRef: string): { texture: Texture | null; aspect: number; error: boolean } {
  const [state, setState] = useState<{ texture: Texture | null; aspect: number; error: boolean }>({
    texture: null,
    aspect: 1,
    error: false,
  });

  useEffect(() => {
    const src = loadAssets()[assetRef];
    if (!src) {
      setState({ texture: null, aspect: 1, error: true });
      return;
    }
    let disposed = false;
    new TextureLoader().load(
      src,
      (tex) => {
        if (disposed) return;
        tex.colorSpace = SRGBColorSpace;
        const img = tex.image as { width?: number; height?: number };
        const aspect = img.width && img.height ? img.width / img.height : 1;
        setState({ texture: tex, aspect, error: false });
      },
      undefined,
      () => {
        if (!disposed) setState({ texture: null, aspect: 1, error: true });
      },
    );
    return () => {
      disposed = true;
    };
  }, [assetRef]);

  return state;
}

export interface ImagePlaneProps {
  image: SceneImage;
  position: [number, number, number];
  theme: ResolvedTheme;
}

/** 把一张图片渲染为场景中的贴图平面（可选下方标签）。 */
export function ImagePlane({ image, position, theme }: ImagePlaneProps) {
  const { texture, aspect, error } = useImageTexture(image.assetRef);
  const width = image.width ?? 2.4;
  const height = width / (aspect || 1);

  const scaleArr = useMemo<[number, number, number]>(() => {
    const s = image.placement?.scale;
    if (typeof s === 'number') return [s, s, s];
    return s ?? [1, 1, 1];
  }, [image.placement?.scale]);

  const rot = image.placement?.rotation;

  return (
    <group position={position} scale={scaleArr} rotation={rot}>
      <mesh>
        <planeGeometry args={[width, height]} />
        {texture ? (
          <meshBasicMaterial map={texture} toneMapped={false} side={DoubleSide} transparent />
        ) : (
          <meshStandardMaterial color={error ? '#f43f5e' : theme.panelBorder} side={DoubleSide} />
        )}
      </mesh>
      {image.label && (
        <Html position={[0, -height / 2 - 0.25, 0]} center distanceFactor={8} zIndexRange={[30, 0]}>
          <div
            style={{
              padding: '3px 10px',
              borderRadius: 8,
              background: theme.panelBg,
              border: `1px solid ${theme.panelBorder}`,
              color: theme.text,
              fontFamily: 'system-ui, sans-serif',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {image.label}
          </div>
        </Html>
      )}
    </group>
  );
}
