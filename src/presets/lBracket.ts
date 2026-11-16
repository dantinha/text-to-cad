import type { IRDocument, IRNode } from '@/core/contracts';
import { buildDefaultParams, clampRange, readClamped, round4 } from './normalize';
import type { ParamSpec, ParamValues, PresetDefinition } from './types';

const SEGMENTS = 48;

const LARGURA_SPEC: ParamSpec = {
  key: 'largura',
  label: 'Largura',
  unit: 'mm',
  min: 20,
  max: 300,
  step: 1,
  defaultValue: 60,
};
const ALTURA_SPEC: ParamSpec = {
  key: 'altura',
  label: 'Altura',
  unit: 'mm',
  min: 25,
  max: 300,
  step: 1,
  defaultValue: 50,
};
const PROFUNDIDADE_SPEC: ParamSpec = {
  key: 'profundidade',
  label: 'Profundidade',
  unit: 'mm',
  min: 25,
  max: 300,
  step: 1,
  defaultValue: 50,
};
const ESPESSURA_SPEC: ParamSpec = {
  key: 'espessura',
  label: 'Espessura',
  unit: 'mm',
  min: 2,
  max: 25,
  step: 0.5,
  defaultValue: 6,
};
const FURO_SPEC: ParamSpec = {
  key: 'diametroFuro',
  label: 'Diâmetro dos furos',
  unit: 'mm',
  min: 2,
  max: 30,
  step: 0.5,
  defaultValue: 6,
};

const PARAMETERS: readonly ParamSpec[] = [
  LARGURA_SPEC,
  ALTURA_SPEC,
  PROFUNDIDADE_SPEC,
  ESPESSURA_SPEC,
  FURO_SPEC,
];

const DEFAULT_PARAMS = buildDefaultParams(PARAMETERS);

interface LBracketParams {
  readonly largura: number;
  readonly altura: number;
  readonly profundidade: number;
  readonly espessura: number;
  readonly diametroFuro: number;
}

function normalizeLBracket(values: ParamValues): LBracketParams {
  const largura = readClamped(values, LARGURA_SPEC);
  const altura = readClamped(values, ALTURA_SPEC);
  const profundidade = readClamped(values, PROFUNDIDADE_SPEC);

  const maxEsp = Math.min(ESPESSURA_SPEC.max, Math.min(altura, profundidade) - 10);
  const espessura = clampRange(readClamped(values, ESPESSURA_SPEC), ESPESSURA_SPEC.min, maxEsp);

  const usableY = profundidade - espessura;
  const usableZ = altura - espessura;
  const maxFuro = Math.min(FURO_SPEC.max, largura / 2 - 4, usableY - 4, usableZ - 4);
  const diametroFuro = clampRange(readClamped(values, FURO_SPEC), FURO_SPEC.min, maxFuro);

  return { largura, altura, profundidade, espessura, diametroFuro };
}

function clampLBracketParams(values: ParamValues): ParamValues {
  return Object.freeze({ ...normalizeLBracket(values) });
}

function makeVerticalHole(
  id: string,
  label: string,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
): IRNode {
  return {
    id,
    type: 'translate',
    label,
    offset: [round4(x), round4(y), round4(z)],
    child: {
      id: `${id}-cyl`,
      type: 'cylinder',
      height: round4(height),
      radius: round4(radius),
      segments: SEGMENTS,
      center: true,
    },
  };
}

function makeHorizontalHole(
  id: string,
  label: string,
  x: number,
  y: number,
  z: number,
  height: number,
  radius: number,
): IRNode {
  return {
    id,
    type: 'translate',
    label,
    offset: [round4(x), round4(y), round4(z)],
    child: {
      id: `${id}-rot`,
      type: 'rotate',
      degrees: [90, 0, 0],
      child: {
        id: `${id}-cyl`,
        type: 'cylinder',
        height: round4(height),
        radius: round4(radius),
        segments: SEGMENTS,
        center: true,
      },
    },
  };
}

function buildLBracketIR(values: ParamValues): IRDocument {
  const { largura, altura, profundidade, espessura, diametroFuro } = normalizeLBracket(values);

  const holeRadius = diametroFuro / 2;
  const holeHeight = espessura + 2;
  const xOffset = largura / 4;
  const yCenter = espessura + (profundidade - espessura) / 2;
  const zCenter = espessura + (altura - espessura) / 2;

  return {
    schemaVersion: 1,
    units: 'mm',
    name: 'Suporte em L',
    root: {
      id: 'suporte-l',
      type: 'difference',
      label: 'Suporte em L com furos de fixação',
      base: {
        id: 'corpo-l',
        type: 'union',
        label: 'Corpo em L',
        children: [
          {
            id: 'aba-horizontal-pos',
            type: 'translate',
            label: 'Aba horizontal',
            offset: [round4(-largura / 2), 0, 0],
            child: {
              id: 'aba-horizontal',
              type: 'cube',
              size: [largura, profundidade, espessura],
            },
          },
          {
            id: 'aba-vertical-pos',
            type: 'translate',
            label: 'Aba vertical',
            offset: [round4(-largura / 2), 0, 0],
            child: {
              id: 'aba-vertical',
              type: 'cube',
              size: [largura, espessura, altura],
            },
          },
        ],
      },
      subtract: [
        makeVerticalHole(
          'furo-base-esq',
          'Furo base esquerdo',
          -xOffset,
          yCenter,
          espessura / 2,
          holeHeight,
          holeRadius,
        ),
        makeVerticalHole(
          'furo-base-dir',
          'Furo base direito',
          xOffset,
          yCenter,
          espessura / 2,
          holeHeight,
          holeRadius,
        ),
        makeHorizontalHole(
          'furo-parede-esq',
          'Furo vertical esquerdo',
          -xOffset,
          espessura / 2,
          zCenter,
          holeHeight,
          holeRadius,
        ),
        makeHorizontalHole(
          'furo-parede-dir',
          'Furo vertical direito',
          xOffset,
          espessura / 2,
          zCenter,
          holeHeight,
          holeRadius,
        ),
      ],
    },
  };
}

export const lBracketPreset: PresetDefinition = {
  id: 'suporte-l',
  name: 'Suporte em L',
  description: 'Cantoneira estrutural em L com abas parametrizadas e 4 furos de fixação.',
  parameters: PARAMETERS,
  defaultParams: DEFAULT_PARAMS,
  clampParams: clampLBracketParams,
  buildIR: buildLBracketIR,
};
