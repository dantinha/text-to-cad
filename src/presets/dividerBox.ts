import type { IRDocument, IRNode } from '@/core/contracts';
import { buildDefaultParams, clampRange, readClamped, round4 } from './normalize';
import type { ParamSpec, ParamValues, PresetDefinition } from './types';

const MIN_CELL_MM = 4;

const LARGURA_SPEC: ParamSpec = {
  key: 'largura',
  label: 'Largura',
  unit: 'mm',
  min: 30,
  max: 400,
  step: 1,
  defaultValue: 120,
};
const PROF_SPEC: ParamSpec = {
  key: 'profundidade',
  label: 'Profundidade',
  unit: 'mm',
  min: 30,
  max: 400,
  step: 1,
  defaultValue: 80,
};
const ALTURA_SPEC: ParamSpec = {
  key: 'altura',
  label: 'Altura',
  unit: 'mm',
  min: 15,
  max: 250,
  step: 1,
  defaultValue: 40,
};
const PAREDE_SPEC: ParamSpec = {
  key: 'espessuraParede',
  label: 'Espessura da parede',
  unit: 'mm',
  min: 1.5,
  max: 15,
  step: 0.5,
  defaultValue: 3,
};
const DIV_X_SPEC: ParamSpec = {
  key: 'divisoesX',
  label: 'Divisões em X',
  unit: 'un',
  min: 1,
  max: 8,
  step: 1,
  defaultValue: 3,
  integer: true,
};
const DIV_Y_SPEC: ParamSpec = {
  key: 'divisoesY',
  label: 'Divisões em Y',
  unit: 'un',
  min: 1,
  max: 8,
  step: 1,
  defaultValue: 2,
  integer: true,
};

const PARAMETERS: readonly ParamSpec[] = [
  LARGURA_SPEC,
  PROF_SPEC,
  ALTURA_SPEC,
  PAREDE_SPEC,
  DIV_X_SPEC,
  DIV_Y_SPEC,
];

const DEFAULT_PARAMS = buildDefaultParams(PARAMETERS);

interface DividerBoxParams {
  readonly largura: number;
  readonly profundidade: number;
  readonly altura: number;
  readonly espessuraParede: number;
  readonly divisoesX: number;
  readonly divisoesY: number;
}

function normalizeDividerBox(values: ParamValues): DividerBoxParams {
  const largura = readClamped(values, LARGURA_SPEC);
  const profundidade = readClamped(values, PROF_SPEC);
  const altura = readClamped(values, ALTURA_SPEC);

  const maxWall = Math.min(
    PAREDE_SPEC.max,
    altura - 2,
    (largura - MIN_CELL_MM) / 2,
    (profundidade - MIN_CELL_MM) / 2,
  );
  const espessuraParede = clampRange(readClamped(values, PAREDE_SPEC), PAREDE_SPEC.min, maxWall);

  const maxDivX = Math.min(
    DIV_X_SPEC.max,
    Math.floor((largura - espessuraParede) / (espessuraParede + MIN_CELL_MM)),
  );
  const maxDivY = Math.min(
    DIV_Y_SPEC.max,
    Math.floor((profundidade - espessuraParede) / (espessuraParede + MIN_CELL_MM)),
  );

  const divisoesX = clampRange(readClamped(values, DIV_X_SPEC), DIV_X_SPEC.min, maxDivX, true);
  const divisoesY = clampRange(readClamped(values, DIV_Y_SPEC), DIV_Y_SPEC.min, maxDivY, true);

  return { largura, profundidade, altura, espessuraParede, divisoesX, divisoesY };
}

function clampDividerBoxParams(values: ParamValues): ParamValues {
  return Object.freeze({ ...normalizeDividerBox(values) });
}

function buildDividerBoxIR(values: ParamValues): IRDocument {
  const {
    largura,
    profundidade,
    altura,
    espessuraParede: wall,
    divisoesX,
    divisoesY,
  } = normalizeDividerBox(values);

  const innerW = round4(largura - 2 * wall);
  const innerD = round4(profundidade - 2 * wall);
  const cavityH = round4(altura - wall + 1);

  const shell: IRNode = {
    id: 'caixa-casco',
    type: 'difference',
    label: 'Caixa oca com fundo fechado',
    base: {
      id: 'caixa-externa-pos',
      type: 'translate',
      offset: [round4(-largura / 2), round4(-profundidade / 2), 0],
      child: {
        id: 'caixa-externa',
        type: 'cube',
        size: [round4(largura), round4(profundidade), round4(altura)],
      },
    },
    subtract: [
      {
        id: 'cavidade-interna-pos',
        type: 'translate',
        label: 'Cavidade interna',
        offset: [round4(-innerW / 2), round4(-innerD / 2), round4(wall)],
        child: {
          id: 'cavidade-interna',
          type: 'cube',
          size: [innerW, innerD, cavityH],
        },
      },
    ],
  };

  const dividers: IRNode[] = [];
  const divZ = round4(wall / 2);
  const divH = round4(altura - wall / 2);

  if (divisoesX > 1) {
    const cellX = (largura - (divisoesX + 1) * wall) / divisoesX;
    const spanY = round4(profundidade - wall);
    for (let i = 1; i < divisoesX; i++) {
      const x = round4(-largura / 2 + i * (cellX + wall));
      dividers.push({
        id: `divisoria-x-${i}-pos`,
        type: 'translate',
        label: `Divisória X ${i}`,
        offset: [x, round4(-spanY / 2), divZ],
        child: {
          id: `divisoria-x-${i}`,
          type: 'cube',
          size: [round4(wall), spanY, divH],
        },
      });
    }
  }

  if (divisoesY > 1) {
    const cellY = (profundidade - (divisoesY + 1) * wall) / divisoesY;
    const spanX = round4(largura - wall);
    for (let j = 1; j < divisoesY; j++) {
      const y = round4(-profundidade / 2 + j * (cellY + wall));
      dividers.push({
        id: `divisoria-y-${j}-pos`,
        type: 'translate',
        label: `Divisória Y ${j}`,
        offset: [round4(-spanX / 2), y, divZ],
        child: {
          id: `divisoria-y-${j}`,
          type: 'cube',
          size: [spanX, round4(wall), divH],
        },
      });
    }
  }

  return {
    schemaVersion: 1,
    units: 'mm',
    name: 'Caixa com divisórias',
    root:
      dividers.length === 0
        ? shell
        : {
            id: 'caixa-divisorias',
            type: 'union',
            label: 'Caixa organizadora com divisórias internas',
            children: [shell, ...dividers],
          },
  };
}

export const dividerBoxPreset: PresetDefinition = {
  id: 'caixa-divisorias',
  name: 'Caixa com Divisórias',
  description: 'Caixa organizadora retangular com fundo fechado e divisórias internas em grade.',
  parameters: PARAMETERS,
  defaultParams: DEFAULT_PARAMS,
  clampParams: clampDividerBoxParams,
  buildIR: buildDividerBoxIR,
};
