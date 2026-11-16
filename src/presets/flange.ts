import type { IRDocument, IRNode } from '@/core/contracts';
import { buildDefaultParams, clampRange, readClamped, round4 } from './normalize';
import type { ParamSpec, ParamValues, PresetDefinition } from './types';

const SEGMENTS = 48;
const MIN_WALL_MM = 2;

const EXT_SPEC: ParamSpec = {
  key: 'diametroExterno',
  label: 'Diâmetro externo',
  unit: 'mm',
  min: 30,
  max: 400,
  step: 1,
  defaultValue: 100,
};
const CENTRAL_SPEC: ParamSpec = {
  key: 'diametroFuroCentral',
  label: 'Diâmetro do furo central',
  unit: 'mm',
  min: 4,
  max: 300,
  step: 1,
  defaultValue: 30,
};
const ESP_SPEC: ParamSpec = {
  key: 'espessura',
  label: 'Espessura',
  unit: 'mm',
  min: 2,
  max: 50,
  step: 0.5,
  defaultValue: 10,
};
const QTD_SPEC: ParamSpec = {
  key: 'qtdFuros',
  label: 'Quantidade de furos',
  unit: 'un',
  min: 3,
  max: 24,
  step: 1,
  defaultValue: 6,
  integer: true,
};
const PARAFUSO_SPEC: ParamSpec = {
  key: 'diametroFuroParafuso',
  label: 'Diâmetro dos furos de parafuso',
  unit: 'mm',
  min: 2,
  max: 40,
  step: 0.5,
  defaultValue: 8,
};

const PARAMETERS: readonly ParamSpec[] = [
  EXT_SPEC,
  CENTRAL_SPEC,
  ESP_SPEC,
  QTD_SPEC,
  PARAFUSO_SPEC,
];

const DEFAULT_PARAMS = buildDefaultParams(PARAMETERS);

interface FlangeParams {
  readonly diametroExterno: number;
  readonly diametroFuroCentral: number;
  readonly espessura: number;
  readonly qtdFuros: number;
  readonly diametroFuroParafuso: number;
}

function normalizeFlange(values: ParamValues): FlangeParams {
  const diametroExterno = readClamped(values, EXT_SPEC);
  const espessura = readClamped(values, ESP_SPEC);

  const maxCentral = Math.min(
    CENTRAL_SPEC.max,
    diametroExterno - (PARAFUSO_SPEC.min + 2 * MIN_WALL_MM) * 2,
  );
  const diametroFuroCentral = clampRange(
    readClamped(values, CENTRAL_SPEC),
    CENTRAL_SPEC.min,
    maxCentral,
  );

  const rOuter = diametroExterno / 2;
  const rInner = diametroFuroCentral / 2;
  const radialWidth = rOuter - rInner;
  const rPcd = (rOuter + rInner) / 2;

  const minChordNeeded = PARAFUSO_SPEC.min + MIN_WALL_MM;
  const sinRatio = Math.min(0.9999, minChordNeeded / (2 * rPcd));
  const maxFitByCircle = Math.floor(Math.PI / Math.asin(sinRatio));
  const maxQtd = Math.min(QTD_SPEC.max, maxFitByCircle);
  const qtdFuros = clampRange(readClamped(values, QTD_SPEC), QTD_SPEC.min, maxQtd, true);

  const chordAtQtd = 2 * rPcd * Math.sin(Math.PI / qtdFuros);
  const maxBoltRadial = radialWidth - 2 * MIN_WALL_MM;
  const maxBoltCircumferential = chordAtQtd - MIN_WALL_MM;
  const maxBolt = Math.min(PARAFUSO_SPEC.max, maxBoltRadial, maxBoltCircumferential);
  const diametroFuroParafuso = clampRange(
    readClamped(values, PARAFUSO_SPEC),
    PARAFUSO_SPEC.min,
    maxBolt,
  );

  return {
    diametroExterno,
    diametroFuroCentral,
    espessura,
    qtdFuros,
    diametroFuroParafuso,
  };
}

function clampFlangeParams(values: ParamValues): ParamValues {
  return Object.freeze({ ...normalizeFlange(values) });
}

function buildFlangeIR(values: ParamValues): IRDocument {
  const { diametroExterno, diametroFuroCentral, espessura, qtdFuros, diametroFuroParafuso } =
    normalizeFlange(values);

  const rOuter = diametroExterno / 2;
  const rCentral = diametroFuroCentral / 2;
  const rPcd = (rOuter + rCentral) / 2;
  const rBolt = diametroFuroParafuso / 2;
  const cutHeight = round4(espessura + 2);
  const zMid = round4(espessura / 2);

  const subtract: IRNode[] = [
    {
      id: 'furo-central-pos',
      type: 'translate',
      label: 'Furo central',
      offset: [0, 0, zMid],
      child: {
        id: 'furo-central',
        type: 'cylinder',
        height: cutHeight,
        radius: round4(rCentral),
        segments: SEGMENTS,
        center: true,
      },
    },
  ];

  for (let i = 0; i < qtdFuros; i++) {
    const angle = (2 * Math.PI * i) / qtdFuros;
    const x = round4(rPcd * Math.cos(angle));
    const y = round4(rPcd * Math.sin(angle));
    subtract.push({
      id: `furo-parafuso-${i + 1}-pos`,
      type: 'translate',
      label: `Furo de parafuso ${i + 1}`,
      offset: [x, y, zMid],
      child: {
        id: `furo-parafuso-${i + 1}`,
        type: 'cylinder',
        height: cutHeight,
        radius: round4(rBolt),
        segments: SEGMENTS,
        center: true,
      },
    });
  }

  return {
    schemaVersion: 1,
    units: 'mm',
    name: 'Flange com furação',
    root: {
      id: 'flange',
      type: 'difference',
      label: 'Flange circular perfurada',
      base: {
        id: 'disco-base',
        type: 'cylinder',
        label: 'Disco base da flange',
        height: round4(espessura),
        radius: round4(rOuter),
        segments: SEGMENTS,
      },
      subtract,
    },
  };
}

export const flangePreset: PresetDefinition = {
  id: 'flange',
  name: 'Flange com Furação',
  description: 'Flange circular com furo central e furos de parafuso distribuídos radialmente.',
  parameters: PARAMETERS,
  defaultParams: DEFAULT_PARAMS,
  clampParams: clampFlangeParams,
  buildIR: buildFlangeIR,
};
