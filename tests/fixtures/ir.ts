import type { IRDocument, IRNode } from '@/core/ir/types';

const cube = (id: string, size: readonly [number, number, number] = [10, 10, 10]): IRNode => ({
  id,
  type: 'cube',
  size,
});

/** Documento mínimo válido: um cubo de 10 mm. */
export const cubeDoc = (): IRDocument => ({
  schemaVersion: 1,
  units: 'mm',
  name: 'Cubo',
  root: cube('cubo'),
});

/** Peça de referência do plano: cubo 40x30x20 menos um furo passante de raio 5. */
export const cubeMinusCylinderDoc = (): IRDocument => ({
  schemaVersion: 1,
  units: 'mm',
  name: 'Cubo com furo',
  root: {
    id: 'peca',
    type: 'difference',
    label: 'Peça com furo',
    base: { id: 'bloco', type: 'cube', size: [40, 30, 20], center: true },
    subtract: [
      { id: 'furo', type: 'cylinder', height: 40, radius: 5, segments: 128, center: true },
    ],
  },
});

/** Exercita os 13 tipos de nó do IR. */
export const allNodeTypesDoc = (): IRDocument => ({
  schemaVersion: 1,
  units: 'mm',
  root: {
    id: 'raiz',
    type: 'union',
    children: [
      { id: 'n-cube', type: 'cube', size: [10, 10, 10], color: '#aabbcc' },
      { id: 'n-cyl', type: 'cylinder', height: 10, radius: 3, segments: 32, center: true },
      { id: 'n-sph', type: 'sphere', radius: 4, segments: 32 },
      { id: 'n-cone', type: 'cone', height: 8, radius: 4 },
      { id: 'n-torus', type: 'torus', majorRadius: 10, minorRadius: 2 },
      {
        id: 'n-ext',
        type: 'extrude',
        polygon: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
        height: 5,
      },
      { id: 'n-tr', type: 'translate', offset: [5, 0, 0], child: cube('t-c') },
      { id: 'n-rot', type: 'rotate', degrees: [0, 0, 45], child: cube('r-c') },
      { id: 'n-sc', type: 'scale', factor: [2, 1, 1], child: cube('s-c') },
      { id: 'n-mir', type: 'mirror', normal: [1, 0, 0], child: cube('m-c') },
      {
        id: 'n-diff',
        type: 'difference',
        base: cube('d-b'),
        subtract: [cube('d-s', [2, 2, 2])],
      },
      { id: 'n-int', type: 'intersection', children: [cube('i-a'), cube('i-b', [5, 5, 5])] },
    ],
  },
});

/** União com exatamente `total` nós (1 união + total-1 cubos). */
export const wideUnion = (total: number): IRDocument => ({
  schemaVersion: 1,
  units: 'mm',
  root: {
    id: 'u',
    type: 'union',
    children: Array.from({ length: total - 1 }, (_, i) => cube(`c${i}`)),
  },
});

/** Cadeia de `depth` níveis: (depth-1) translates em volta de um cubo. */
export const deepChain = (depth: number): IRDocument => {
  let node: IRNode = cube('folha');
  for (let i = 0; i < depth - 1; i++) {
    node = { id: `t${i}`, type: 'translate', offset: [0, 0, 0], child: node };
  }
  return { schemaVersion: 1, units: 'mm', root: node };
};
