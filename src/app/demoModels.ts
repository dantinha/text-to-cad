import type { IRDocument } from '@/core';

export interface DemoModel {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly doc: IRDocument;
}

export const M2_DEMO_MODELS: readonly DemoModel[] = [
  {
    id: 'cubo-furo',
    label: 'Cubo com furo',
    subtitle: '40 × 30 × 20 mm · furo Ø10 mm',
    doc: {
      schemaVersion: 1,
      units: 'mm',
      name: 'Cubo com furo passante',
      root: {
        id: 'peca',
        type: 'difference',
        label: 'Bloco perfurado',
        base: {
          id: 'bloco',
          type: 'cube',
          label: 'Corpo principal 40x30x20',
          size: [40, 30, 20],
          center: true,
        },
        subtract: [
          {
            id: 'furo',
            type: 'cylinder',
            label: 'Furo central Ø10',
            height: 40,
            radius: 5,
            segments: 64,
            center: true,
          },
        ],
      },
    },
  },
  {
    id: 'perfil-l',
    label: 'Perfil em L',
    subtitle: 'Extrusão 2D com furo de fixação',
    doc: {
      schemaVersion: 1,
      units: 'mm',
      name: 'Suporte em L simples',
      root: {
        id: 'suporte',
        type: 'difference',
        label: 'Suporte extrudado com furo',
        base: {
          id: 'corpo-l',
          type: 'extrude',
          label: 'Perfil L 30x30',
          polygon: [
            [-15, -15],
            [15, -15],
            [15, -9],
            [-9, -9],
            [-9, 15],
            [-15, 15],
          ],
          height: 20,
          center: true,
        },
        subtract: [
          {
            id: 'furo-base',
            type: 'translate',
            offset: [4, -12, 0],
            child: {
              id: 'cil-furo',
              type: 'rotate',
              degrees: [90, 0, 0],
              child: {
                id: 'furo-m5',
                type: 'cylinder',
                label: 'Furo M5',
                height: 20,
                radius: 2.75,
                segments: 32,
                center: true,
              },
            },
          },
        ],
      },
    },
  },
  {
    id: 'anel-torus',
    label: 'Anel Torus',
    subtitle: 'R=16 mm · r=4 mm · 64 segs',
    doc: {
      schemaVersion: 1,
      units: 'mm',
      name: 'Anel paramétrico',
      root: {
        id: 'anel',
        type: 'torus',
        label: 'Anel de vedação',
        majorRadius: 16,
        minorRadius: 4,
        segments: 64,
      },
    },
  },
];
