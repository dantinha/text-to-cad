import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import type { MeshData } from '@/core/contracts';
import { meshDataToBufferGeometry } from './geometry';
import type { RenderMode } from './types';

export interface CadMeshProps {
  readonly mesh: MeshData;
  readonly renderMode: RenderMode;
}

type MaterialMap = Record<RenderMode, THREE.Material>;

/**
 * Renderiza a malha CAD mantendo `BufferGeometry` memoizada por referência de `mesh`
 * e reutilizando as instâncias de material para evitar recompilação de shaders ao alternar modos.
 */
export function CadMesh({ mesh, renderMode }: CadMeshProps) {
  const geometry = useMemo(() => meshDataToBufferGeometry(mesh), [mesh]);

  const materials = useMemo<MaterialMap>(
    () => ({
      solid: new THREE.MeshStandardMaterial({
        color: '#94a3b8',
        metalness: 0.25,
        roughness: 0.45,
      }),
      wireframe: new THREE.MeshBasicMaterial({
        color: '#38bdf8',
        wireframe: true,
      }),
      clay: new THREE.MeshStandardMaterial({
        color: '#d4d4d8',
        metalness: 0.0,
        roughness: 0.9,
      }),
      xray: new THREE.MeshStandardMaterial({
        color: '#60a5fa',
        metalness: 0.1,
        roughness: 0.4,
        transparent: true,
        opacity: 0.35,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    }),
    [],
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
    };
  }, [geometry]);

  useEffect(() => {
    return () => {
      for (const material of Object.values(materials)) {
        material.dispose();
      }
    };
  }, [materials]);

  return <mesh geometry={geometry} material={materials[renderMode]} />;
}
