import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { MeshData } from '@/core/contracts';
import {
  computeBboxLabelPositions,
  computeFitCameraPose,
  computeMeshMetrics,
  meshDataToBufferGeometry,
  projectPointToScreen,
} from '@/viewer/geometry';
import { unitCubeMesh } from '../fixtures/mesh';

describe('meshDataToBufferGeometry', () => {
  it('converte unitCubeMesh(10) em THREE.BufferGeometry com atributos e índices zero-copy', () => {
    const mesh = unitCubeMesh(10);
    const geometry = meshDataToBufferGeometry(mesh);

    expect(geometry).toBeInstanceOf(THREE.BufferGeometry);

    const posAttr = geometry.getAttribute('position');
    const normAttr = geometry.getAttribute('normal');
    const indexAttr = geometry.getIndex();

    expect(posAttr).toBeDefined();
    expect(posAttr.itemSize).toBe(3);
    expect(posAttr.count).toBe(24);
    expect(posAttr.array).toBe(mesh.positions);

    expect(normAttr).toBeDefined();
    expect(normAttr.itemSize).toBe(3);
    expect(normAttr.count).toBe(24);
    expect(normAttr.array).toBe(mesh.normals);

    expect(indexAttr).not.toBeNull();
    expect(indexAttr?.count).toBe(36);
    expect(indexAttr?.array).toBe(mesh.indices);

    expect(geometry.boundingBox?.min.toArray()).toEqual([-5, -5, -5]);
    expect(geometry.boundingBox?.max.toArray()).toEqual([5, 5, 5]);

    geometry.dispose();
  });

  it('lida com malha vazia sem lançar erro', () => {
    const emptyMesh: MeshData = {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      volumeMm3: 0,
      triangleCount: 0,
    };

    const geometry = meshDataToBufferGeometry(emptyMesh);
    expect(geometry.getAttribute('position').count).toBe(0);
    expect(geometry.getIndex()?.count).toBe(0);
    geometry.dispose();
  });

  it('calcula normais automaticamente se normals estiver vazio', () => {
    const cube = unitCubeMesh(10);
    const withoutNormals: MeshData = {
      ...cube,
      normals: new Float32Array(0),
    };

    const geometry = meshDataToBufferGeometry(withoutNormals);
    const normAttr = geometry.getAttribute('normal');
    expect(normAttr).toBeDefined();
    expect(normAttr.count).toBe(24);
    geometry.dispose();
  });
});

describe('computeMeshMetrics', () => {
  it('calcula dimensões, centro, raio, volume em cm³ e triângulos para unitCubeMesh(10)', () => {
    const metrics = computeMeshMetrics(unitCubeMesh(10));

    expect(metrics.sizeX).toBe(10);
    expect(metrics.sizeY).toBe(10);
    expect(metrics.sizeZ).toBe(10);
    expect(metrics.center).toEqual([0, 0, 0]);
    expect(metrics.radius).toBeCloseTo(Math.hypot(10, 10, 10) / 2, 5);
    expect(metrics.volumeCm3).toBeCloseTo(1, 5);
    expect(metrics.triangleCount).toBe(12);
    expect(metrics.formattedDimensions).toBe('10,0 × 10,0 × 10,0 mm');
    expect(metrics.formattedVolume).toBe('1,00 cm³');
    expect(metrics.formattedTriangles).toBe('12');
  });

  it('calcula centro deslocado e formata milhares em PT-BR', () => {
    const base = unitCubeMesh(10);
    const shifted: MeshData = {
      ...base,
      bbox: { min: [0, -10, 5], max: [20, 10, 15] },
      volumeMm3: 4000,
      triangleCount: 1200,
    };

    const metrics = computeMeshMetrics(shifted);
    expect(metrics.sizeX).toBe(20);
    expect(metrics.sizeY).toBe(20);
    expect(metrics.sizeZ).toBe(10);
    expect(metrics.center).toEqual([10, 0, 10]);
    expect(metrics.volumeCm3).toBeCloseTo(4, 5);
    expect(metrics.formattedDimensions).toBe('20,0 × 20,0 × 10,0 mm');
    expect(metrics.formattedVolume).toBe('4,00 cm³');
    expect(metrics.formattedTriangles).toBe('1.200');
  });
});

describe('computeFitCameraPose', () => {
  it('calcula posição e alvo da câmera Z-up enquadrando o modelo', () => {
    const pose = computeFitCameraPose([10, 0, 5], 8.66, 42);
    expect(pose.target).toEqual([10, 0, 5]);
    const dist = Math.hypot(pose.position[0] - 10, pose.position[1] - 0, pose.position[2] - 5);
    expect(dist).toBeGreaterThan(8.66);
    // Direção isométrica canônica Z-up (+X, -Y, +Z)
    expect(pose.position[0] - 10).toBeGreaterThan(0);
    expect(pose.position[1] - 0).toBeLessThan(0);
    expect(pose.position[2] - 5).toBeGreaterThan(0);
  });
});

describe('computeBboxLabelPositions e projectPointToScreen', () => {
  it('posiciona X, Y e Z em 3 arestas distintas do bbox', () => {
    const pos = computeBboxLabelPositions(unitCubeMesh(10).bbox);
    expect(pos.x).toEqual([0, -5, 5]);
    expect(pos.y).toEqual([5, 0, -5]);
    expect(pos.z).toEqual([5, -5, 0]);
  });

  it('projeta o centro do viewport corretamente', () => {
    const cam = new THREE.PerspectiveCamera(45, 800 / 600, 0.1, 1000);
    cam.up.set(0, 0, 1);
    cam.position.set(60, -60, 45);
    cam.lookAt(0, 0, 0);
    cam.updateMatrixWorld();

    const origin = projectPointToScreen([0, 0, 0], cam, 800, 600);
    expect(origin.visible).toBe(true);
    expect(origin.x).toBeCloseTo(400, 1);
    expect(origin.y).toBeCloseTo(300, 1);
  });
});
