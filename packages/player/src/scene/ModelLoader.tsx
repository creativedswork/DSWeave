import { useEffect, useMemo, useState } from 'react';
import { Box3, LoadingManager, Vector3 } from 'three';
import type { Group } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadAssets } from '../spec.js';

export interface LoadedModel {
  /** 加载完成的场景根（含命名部件）。 */
  group: Group | null;
  error: string | null;
  /** 归一化到单位尺度的缩放系数（用于 fit）。 */
  fitScale: number;
  /** 包围盒中心（用于居中）。 */
  center: Vector3;
}

/** 从注入的 assets（data URI）加载一个 gltf/glb 模型，并计算 fit 变换。 */
export function useGltfModel(assetRef: string): LoadedModel {
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const assets = loadAssets();
    const root = assets[assetRef];
    if (!root) {
      setError(`缺少资产：${assetRef}`);
      setGroup(null);
      return;
    }

    const manager = new LoadingManager();
    // gltf 依赖（.bin/纹理）可能以相对路径或被 data: 基址改写后的形式请求，
    // 统一按文件名回查注入的 data URI。
    manager.setURLModifier((url) => {
      if (url.startsWith('data:')) return url;
      const filename = decodeURIComponent(url.split('/').pop() ?? url);
      return assets[filename] ?? assets[url] ?? url;
    });

    const loader = new GLTFLoader(manager);
    let disposed = false;
    loader.load(
      root,
      (gltf) => {
        if (!disposed) {
          setGroup(gltf.scene);
          setError(null);
        }
      },
      undefined,
      (err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err));
      },
    );
    return () => {
      disposed = true;
    };
  }, [assetRef]);

  const { fitScale, center } = useMemo(() => {
    if (!group) return { fitScale: 1, center: new Vector3() };
    const box = new Box3().setFromObject(group);
    const size = box.getSize(new Vector3());
    const c = box.getCenter(new Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    return { fitScale: 2 / maxDim, center: c };
  }, [group]);

  return { group, error, fitScale, center };
}
