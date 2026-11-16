import type { MeshData } from '@/core/contracts';

/**
 * Malha-mock: cubo centrado na origem, com 24 vértices (4 por face, normais planas) e 12 triângulos.
 * Serve ao viewer (M2) e aos testes de export antes de o kernel existir.
 */
export function unitCubeMesh(size = 1): MeshData {
  const h = size / 2;
  // [normal, 4 cantos em sentido anti-horário visto de fora]
  const faces: ReadonlyArray<readonly [readonly number[], readonly (readonly number[])[]]> = [
    [
      [1, 0, 0],
      [
        [h, -h, -h],
        [h, h, -h],
        [h, h, h],
        [h, -h, h],
      ],
    ],
    [
      [-1, 0, 0],
      [
        [-h, -h, h],
        [-h, h, h],
        [-h, h, -h],
        [-h, -h, -h],
      ],
    ],
    [
      [0, 1, 0],
      [
        [h, h, -h],
        [-h, h, -h],
        [-h, h, h],
        [h, h, h],
      ],
    ],
    [
      [0, -1, 0],
      [
        [-h, -h, -h],
        [h, -h, -h],
        [h, -h, h],
        [-h, -h, h],
      ],
    ],
    [
      [0, 0, 1],
      [
        [-h, -h, h],
        [h, -h, h],
        [h, h, h],
        [-h, h, h],
      ],
    ],
    [
      [0, 0, -1],
      [
        [-h, h, -h],
        [h, h, -h],
        [h, -h, -h],
        [-h, -h, -h],
      ],
    ],
  ];
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  faces.forEach(([normal, corners], f) => {
    for (const c of corners) {
      positions.push(...c);
      normals.push(...normal);
    }
    const o = f * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint32Array(indices),
    bbox: { min: [-h, -h, -h], max: [h, h, h] },
    volumeMm3: size ** 3,
    triangleCount: indices.length / 3,
  };
}

/** Bytes dos buffers que viajam por Transferable entre worker e UI. */
export const meshBytes = (m: MeshData): number =>
  m.positions.byteLength + m.normals.byteLength + m.indices.byteLength;
