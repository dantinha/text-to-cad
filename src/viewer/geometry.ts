import * as THREE from 'three';
import type { MeshData } from '@/core/contracts';
import type { MeshMetrics } from './types';

const MM_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const CM3_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const CM3_SMALL_FORMATTER = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 3,
  maximumFractionDigits: 3,
});

const INT_FORMATTER = new Intl.NumberFormat('pt-BR');

/** Direção isométrica canônica para sistema Z-up (compatível com posição inicial [60, -60, 45]). */
const DEFAULT_VIEW_DIR: readonly [number, number, number] = [60, -60, 45];

/** Formata uma medida em milímetros com padrão numérico PT-BR. */
export function formatMillimeters(value: number): string {
  return MM_FORMATTER.format(Number.isFinite(value) ? value : 0);
}

/** Formata volume em cm³ com padrão numérico PT-BR. */
export function formatVolumeCm3(volumeCm3: number): string {
  if (!Number.isFinite(volumeCm3) || volumeCm3 <= 0) {
    return CM3_FORMATTER.format(0);
  }
  return volumeCm3 < 0.01 ? CM3_SMALL_FORMATTER.format(volumeCm3) : CM3_FORMATTER.format(volumeCm3);
}

/**
 * Converte um `MeshData` em `THREE.BufferGeometry` reutilizando os `TypedArray`s (zero-copy).
 * Se `normals` estiver ausente ou incompatível, calcula normais automaticamente.
 */
export function meshDataToBufferGeometry(mesh: MeshData): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();

  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));

  if (mesh.normals.length === mesh.positions.length && mesh.normals.length > 0) {
    geometry.setAttribute('normal', new THREE.BufferAttribute(mesh.normals, 3));
  }

  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));

  if (mesh.positions.length > 0) {
    if (mesh.normals.length !== mesh.positions.length) {
      geometry.computeVertexNormals();
    }
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
  }

  return geometry;
}

/** Calcula dimensões, centro, raio envolvente, volume em cm³ e strings formatadas para o HUD. */
export function computeMeshMetrics(mesh: MeshData): MeshMetrics {
  const { min, max } = mesh.bbox;
  const sizeX = Math.max(0, max[0] - min[0]);
  const sizeY = Math.max(0, max[1] - min[1]);
  const sizeZ = Math.max(0, max[2] - min[2]);

  const center: readonly [number, number, number] = [
    (min[0] + max[0]) / 2,
    (min[1] + max[1]) / 2,
    (min[2] + max[2]) / 2,
  ];

  const radius = Math.hypot(sizeX, sizeY, sizeZ) / 2;
  const volumeCm3 = mesh.volumeMm3 / 1000;
  const triangleCount = mesh.triangleCount;

  const formattedDimensions = `${formatMillimeters(sizeX)} × ${formatMillimeters(sizeY)} × ${formatMillimeters(sizeZ)} mm`;
  const formattedVolume = `${formatVolumeCm3(volumeCm3)} cm³`;
  const formattedTriangles = INT_FORMATTER.format(triangleCount);

  return {
    sizeX,
    sizeY,
    sizeZ,
    center,
    radius,
    volumeCm3,
    triangleCount,
    formattedDimensions,
    formattedVolume,
    formattedTriangles,
  };
}

export interface FitCameraPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
}

/**
 * Calcula posição e alvo de câmera Z-up para enquadrar o bounding box no viewport.
 * Preserva `viewDirection` quando fornecida e não degenerada.
 */
export function computeFitCameraPose(
  center: readonly [number, number, number],
  radius: number,
  fovDeg: number,
  viewDirection?: readonly [number, number, number],
): FitCameraPose {
  const dir = viewDirection ?? DEFAULT_VIEW_DIR;
  const dirLen = Math.hypot(dir[0], dir[1], dir[2]);
  const fallbackLen = Math.hypot(DEFAULT_VIEW_DIR[0], DEFAULT_VIEW_DIR[1], DEFAULT_VIEW_DIR[2]);

  const nx = dirLen > 1e-4 ? dir[0] / dirLen : DEFAULT_VIEW_DIR[0] / fallbackLen;
  const ny = dirLen > 1e-4 ? dir[1] / dirLen : DEFAULT_VIEW_DIR[1] / fallbackLen;
  const nz = dirLen > 1e-4 ? dir[2] / dirLen : DEFAULT_VIEW_DIR[2] / fallbackLen;

  const safeRadius = Math.max(radius, 1);
  const clampedFov = Math.min(Math.max(fovDeg, 10), 120);
  const halfFovRad = (clampedFov * Math.PI) / 360;
  const distance = (safeRadius / Math.sin(halfFovRad)) * 1.25;

  return {
    position: [center[0] + nx * distance, center[1] + ny * distance, center[2] + nz * distance],
    target: [center[0], center[1], center[2]],
  };
}

export interface BboxLabelPositions {
  readonly x: readonly [number, number, number];
  readonly y: readonly [number, number, number];
  readonly z: readonly [number, number, number];
}

/** Posiciona as 3 etiquetas de cota em arestas distintas para evitar sobreposição visual. */
export function computeBboxLabelPositions(bbox: MeshData['bbox']): BboxLabelPositions {
  return {
    x: [(bbox.min[0] + bbox.max[0]) / 2, bbox.min[1], bbox.max[2]],
    y: [bbox.max[0], (bbox.min[1] + bbox.max[1]) / 2, bbox.min[2]],
    z: [bbox.max[0], bbox.min[1], (bbox.min[2] + bbox.max[2]) / 2],
  };
}

export interface ScreenProjection {
  readonly x: number;
  readonly y: number;
  readonly visible: boolean;
}

const _projVec = new THREE.Vector3();

/** Projeta um ponto 3D (em mm) para coordenadas de pixel dentro do viewport. */
export function projectPointToScreen(
  point: readonly [number, number, number],
  camera: THREE.Camera,
  width: number,
  height: number,
): ScreenProjection {
  if (
    width <= 0 ||
    height <= 0 ||
    !(camera as { matrixWorldInverse?: unknown }).matrixWorldInverse ||
    !(camera as { projectionMatrix?: unknown }).projectionMatrix
  ) {
    return { x: 0, y: 0, visible: false };
  }
  _projVec.set(point[0], point[1], point[2]).project(camera);
  const visible =
    Number.isFinite(_projVec.x) &&
    Number.isFinite(_projVec.y) &&
    _projVec.z >= -1 &&
    _projVec.z <= 1;
  return {
    x: (_projVec.x * 0.5 + 0.5) * width,
    y: (-_projVec.y * 0.5 + 0.5) * height,
    visible,
  };
}
