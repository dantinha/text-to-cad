import type { IRDocument } from '@/core/contracts';
import { buildDefaultParams, clampRange, readClamped, round4 } from './normalize';
import type { ParamSpec, ParamValues, PresetDefinition } from './types';

const SEGMENTS = 48;
const MIN_RADIAL_STEP_MM = 2;

const EXT_SPEC: ParamSpec = {
  key: 'diametroExterno',
  label: 'Diâmetro externo',
  unit: 'mm',
  min: 8,
  max: 200,
  step: 0.5,
  defaultValue: 24,
};
const INT_SPEC: ParamSpec = {
  key: 'diametroInterno',
  label: 'Diâmetro interno',
  unit: 'mm',
  min: 2,
  max: 180,
  step: 0.5,
  defaultValue: 12,
};
const ALTURA_SPEC: ParamSpec = {
  key: 'altura',
  label: 'Altura total',
  unit: 'mm',
  min: 6,
  max: 250,
  step: 1,
  defaultValue: 30,
};
const FLANGE_DIA_SPEC: ParamSpec = {
  key: 'diametroFlange',
  label: 'Diâmetro do colar',
  unit: 'mm',
  min: 12,
  max: 260,
  step: 0.5,
  defaultValue: 36,
};
const FLANGE_H_SPEC: ParamSpec = {
  key: 'alturaFlange',
  label: 'Altura do colar',
  unit: 'mm',
  min: 1.5,
  max: 50,
  step: 0.5,
  defaultValue: 5,
};

const PARAMETERS: readonly ParamSpec[] = [
  EXT_SPEC,
  INT_SPEC,
  ALTURA_SPEC,
  FLANGE_DIA_SPEC,
  FLANGE_H_SPEC,
];

const DEFAULT_PARAMS = buildDefaultParams(PARAMETERS);

interface BushingParams {
  readonly diametroExterno: number;
  readonly diametroInterno: number;
  readonly altura: number;
  readonly diametroFlange: number;
  readonly alturaFlange: number;
}

function normalizeBushing(values: ParamValues): BushingParams {
  const diametroExterno = readClamped(values, EXT_SPEC);
  const altura = readClamped(values, ALTURA_SPEC);

  const maxInner = Math.min(INT_SPEC.max, diametroExterno - 2 * MIN_RADIAL_STEP_MM);
  const diametroInterno = clampRange(readClamped(values, INT_SPEC), INT_SPEC.min, maxInner);

  const minFlangeDia = Math.max(FLANGE_DIA_SPEC.min, diametroExterno + 2 * MIN_RADIAL_STEP_MM);
  const diametroFlange = clampRange(
    readClamped(values, FLANGE_DIA_SPEC),
    minFlangeDia,
    FLANGE_DIA_SPEC.max,
  );

  const maxFlangeH = Math.min(FLANGE_H_SPEC.max, altura - 2);
  const alturaFlange = clampRange(
    readClamped(values, FLANGE_H_SPEC),
    FLANGE_H_SPEC.min,
    maxFlangeH,
  );

  return { diametroExterno, diametroInterno, altura, diametroFlange, alturaFlange };
}

function clampBushingParams(values: ParamValues): ParamValues {
  return Object.freeze({ ...normalizeBushing(values) });
}

function buildBushingIR(values: ParamValues): IRDocument {
  const { diametroExterno, diametroInterno, altura, diametroFlange, alturaFlange } =
    normalizeBushing(values);

  return {
    schemaVersion: 1,
    units: 'mm',
    name: 'Bucha com colar',
    root: {
      id: 'bucha',
      type: 'difference',
      label: 'Bucha cilíndrica oca com colar inferior',
      base: {
        id: 'bucha-corpo',
        type: 'union',
        label: 'Corpo e colar da bucha',
        children: [
          {
            id: 'colar-inferior',
            type: 'cylinder',
            label: 'Colar inferior',
            height: round4(alturaFlange),
            radius: round4(diametroFlange / 2),
            segments: SEGMENTS,
          },
          {
            id: 'cilindro-externo',
            type: 'cylinder',
            label: 'Cilindro principal',
            height: round4(altura),
            radius: round4(diametroExterno / 2),
            segments: SEGMENTS,
          },
        ],
      },
      subtract: [
        {
          id: 'furo-passante-pos',
          type: 'translate',
          label: 'Furo passante central',
          offset: [0, 0, round4(altura / 2)],
          child: {
            id: 'furo-passante',
            type: 'cylinder',
            height: round4(altura + 2),
            radius: round4(diametroInterno / 2),
            segments: SEGMENTS,
            center: true,
          },
        },
      ],
    },
  };
}

export const bushingPreset: PresetDefinition = {
  id: 'bucha',
  name: 'Bucha / Espaçador',
  description: 'Bucha cilíndrica oca com colar inferior para apoio e centralização.',
  parameters: PARAMETERS,
  defaultParams: DEFAULT_PARAMS,
  clampParams: clampBushingParams,
  buildIR: buildBushingIR,
};
