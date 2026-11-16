import { beforeAll, describe, expect, it } from 'vitest';
import type { IRNode } from '@/core/contracts';
import { validateIR } from '@/core/ir/validate';
import { emitScad } from '@/core/scad';
import { evaluateInNode } from '@/kernel/evaluate';
import {
  PRESETS,
  bushingPreset,
  dividerBoxPreset,
  flangePreset,
  getPresetById,
  lBracketPreset,
  type ParamValues,
  type PresetDefinition,
} from '@/presets';
import { cubeDoc } from '../fixtures/ir';

function collectNodeIds(root: IRNode): string[] {
  const ids: string[] = [];
  const visit = (node: IRNode): void => {
    ids.push(node.id);
    switch (node.type) {
      case 'translate':
      case 'rotate':
      case 'scale':
      case 'mirror':
        visit(node.child);
        break;
      case 'union':
      case 'intersection':
        node.children.forEach(visit);
        break;
      case 'difference':
        visit(node.base);
        node.subtract.forEach(visit);
        break;
      default:
        break;
    }
  };
  visit(root);
  return ids;
}

function extremeValues(preset: PresetDefinition, bound: 'min' | 'max'): ParamValues {
  return Object.fromEntries(preset.parameters.map((p) => [p.key, p[bound]]));
}

describe('presets: catálogo e metadados', () => {
  it('exporta os 4 presets obrigatórios e resolve por id via getPresetById', () => {
    expect(PRESETS).toHaveLength(4);
    expect(PRESETS.map((p) => p.id)).toEqual(['suporte-l', 'flange', 'caixa-divisorias', 'bucha']);

    expect(getPresetById('suporte-l')).toBe(lBracketPreset);
    expect(getPresetById('flange')).toBe(flangePreset);
    expect(getPresetById('caixa-divisorias')).toBe(dividerBoxPreset);
    expect(getPresetById('bucha')).toBe(bushingPreset);
    expect(getPresetById('inexistente')).toBeUndefined();
  });

  it.each(PRESETS)(
    '$id possui specs consistentes e defaultParams dentro de [min, max]',
    (preset) => {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(preset.parameters.length).toBeGreaterThanOrEqual(5);

      for (const spec of preset.parameters) {
        expect(spec.min).toBeLessThan(spec.max);
        expect(spec.step).toBeGreaterThan(0);
        expect(spec.defaultValue).toBeGreaterThanOrEqual(spec.min);
        expect(spec.defaultValue).toBeLessThanOrEqual(spec.max);
        expect(preset.defaultParams[spec.key]).toBe(spec.defaultValue);
      }
    },
  );
});

describe('presets: validação IR, pureza e emissão OpenSCAD', () => {
  it.each(PRESETS)(
    '$id gera IR válido (validateIR) com ids únicos em default, min e max',
    (preset) => {
      const cases = [
        preset.defaultParams,
        extremeValues(preset, 'min'),
        extremeValues(preset, 'max'),
      ];

      for (const params of cases) {
        const doc = preset.buildIR(params);
        const validation = validateIR(doc);
        expect(validation.ok).toBe(true);

        const ids = collectNodeIds(doc.root);
        expect(new Set(ids).size).toBe(ids.length);
      }
    },
  );

  it.each(PRESETS)('$id tem buildIR puro, determinístico e compatível com emitScad', (preset) => {
    const frozen = Object.freeze({ ...preset.defaultParams });
    const first = preset.buildIR(frozen);
    const second = preset.buildIR(frozen);

    expect(first).toEqual(second);

    const scad = emitScad(first);
    expect(scad).toContain('// Modelo:');
    expect(scad).toContain('// Unidade: mm | Eixo Z para cima');
    expect(scad.trim().length).toBeGreaterThan(40);
  });
});

describe('presets: invariantes de clampParams', () => {
  it('suporte-l normaliza limites, NaN/ausentes e garante folga mínima de parede para furos', () => {
    const clamped = lBracketPreset.clampParams({
      largura: 20,
      altura: 25,
      profundidade: 25,
      espessura: 25,
      diametroFuro: 30,
    });

    expect(clamped['espessura']).toBeLessThanOrEqual(15);
    expect(clamped['diametroFuro']).toBeLessThanOrEqual((clamped['largura'] ?? 0) / 2 - 4);
    expect(clamped['diametroFuro']).toBeGreaterThanOrEqual(2);
    expect(validateIR(lBracketPreset.buildIR(clamped)).ok).toBe(true);

    const fallback = lBracketPreset.clampParams({ largura: Number.NaN });
    expect(fallback).toEqual(lBracketPreset.defaultParams);
  });

  it('flange arredonda qtdFuros inteiro, garante furo central menor que externo e folga nos furos', () => {
    const clamped = flangePreset.clampParams({
      diametroExterno: 30,
      diametroFuroCentral: 40,
      espessura: 1,
      qtdFuros: 23.7,
      diametroFuroParafuso: 25,
    });

    expect(Number.isInteger(clamped['qtdFuros'])).toBe(true);
    expect(clamped['diametroFuroCentral']).toBeLessThanOrEqual(
      (clamped['diametroExterno'] ?? 0) - 12,
    );
    expect(clamped['espessura']).toBe(2);
    expect(clamped['diametroFuroParafuso']).toBeGreaterThanOrEqual(2);
    expect(validateIR(flangePreset.buildIR(clamped)).ok).toBe(true);
  });

  it('caixa-divisorias arredonda divisões inteiras e impede parede/divisórias maiores que a caixa', () => {
    const clamped = dividerBoxPreset.clampParams({
      largura: 30,
      profundidade: 30,
      altura: 15,
      espessuraParede: 15,
      divisoesX: 7.6,
      divisoesY: 0.2,
    });

    expect(Number.isInteger(clamped['divisoesX'])).toBe(true);
    expect(Number.isInteger(clamped['divisoesY'])).toBe(true);
    expect(clamped['espessuraParede']).toBeLessThanOrEqual(13);
    expect(clamped['divisoesY']).toBe(1);
    expect(validateIR(dividerBoxPreset.buildIR(clamped)).ok).toBe(true);
  });

  it('bucha garante diametroInterno < diametroExterno - 4, flange maior que externo e alturaFlange < altura', () => {
    const clamped = bushingPreset.clampParams({
      diametroExterno: 10,
      diametroInterno: 20,
      altura: 8,
      diametroFlange: 8,
      alturaFlange: 20,
    });

    expect(clamped['diametroInterno']).toBeLessThanOrEqual((clamped['diametroExterno'] ?? 0) - 4);
    expect(clamped['diametroFlange']).toBeGreaterThanOrEqual((clamped['diametroExterno'] ?? 0) + 4);
    expect(clamped['alturaFlange']).toBeLessThanOrEqual((clamped['altura'] ?? 0) - 2);
    expect(validateIR(bushingPreset.buildIR(clamped)).ok).toBe(true);
  });
});

describe('presets: avaliação no kernel manifold-3d (< 300 ms)', () => {
  beforeAll(async () => {
    // Aquece o singleton WASM uma única vez antes de cronometrar os presets.
    const warmup = await evaluateInNode(cubeDoc());
    expect(warmup.ok).toBe(true);
  });

  it('avalia suporte-l com defaultParams, bbox correto e tempo < 300 ms', async () => {
    const p = lBracketPreset.defaultParams;
    const t0 = performance.now();
    const res = await evaluateInNode(lBracketPreset.buildIR(p));
    const elapsed = performance.now() - t0;

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(elapsed).toBeLessThan(300);
    expect(res.value.volumeMm3).toBeGreaterThan(0);
    expect(res.value.triangleCount).toBeGreaterThan(0);
    expect(res.value.bbox.min[0]).toBeCloseTo(-(p['largura'] ?? 0) / 2, 3);
    expect(res.value.bbox.max[0]).toBeCloseTo((p['largura'] ?? 0) / 2, 3);
    expect(res.value.bbox.min[1]).toBeCloseTo(0, 3);
    expect(res.value.bbox.max[1]).toBeCloseTo(p['profundidade'] ?? 0, 3);
    expect(res.value.bbox.min[2]).toBeCloseTo(0, 3);
    expect(res.value.bbox.max[2]).toBeCloseTo(p['altura'] ?? 0, 3);
  });

  it('avalia flange com defaultParams, bbox correto e tempo < 300 ms', async () => {
    const p = flangePreset.defaultParams;
    const t0 = performance.now();
    const res = await evaluateInNode(flangePreset.buildIR(p));
    const elapsed = performance.now() - t0;

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(elapsed).toBeLessThan(300);
    expect(res.value.volumeMm3).toBeGreaterThan(0);
    expect(res.value.triangleCount).toBeGreaterThan(0);
    const r = (p['diametroExterno'] ?? 0) / 2;
    expect(res.value.bbox.min[0]).toBeCloseTo(-r, 1);
    expect(res.value.bbox.max[0]).toBeCloseTo(r, 1);
    expect(res.value.bbox.min[1]).toBeCloseTo(-r, 1);
    expect(res.value.bbox.max[1]).toBeCloseTo(r, 1);
    expect(res.value.bbox.min[2]).toBeCloseTo(0, 3);
    expect(res.value.bbox.max[2]).toBeCloseTo(p['espessura'] ?? 0, 3);
  });

  it('avalia caixa-divisorias (com e sem divisórias), bbox correto e tempo < 300 ms', async () => {
    const p = dividerBoxPreset.defaultParams;
    const t0 = performance.now();
    const res = await evaluateInNode(dividerBoxPreset.buildIR(p));
    const elapsed = performance.now() - t0;

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(elapsed).toBeLessThan(300);
    expect(res.value.volumeMm3).toBeGreaterThan(0);
    expect(res.value.triangleCount).toBeGreaterThan(0);
    expect(res.value.bbox.min[0]).toBeCloseTo(-(p['largura'] ?? 0) / 2, 3);
    expect(res.value.bbox.max[0]).toBeCloseTo((p['largura'] ?? 0) / 2, 3);
    expect(res.value.bbox.min[1]).toBeCloseTo(-(p['profundidade'] ?? 0) / 2, 3);
    expect(res.value.bbox.max[1]).toBeCloseTo((p['profundidade'] ?? 0) / 2, 3);
    expect(res.value.bbox.min[2]).toBeCloseTo(0, 3);
    expect(res.value.bbox.max[2]).toBeCloseTo(p['altura'] ?? 0, 3);

    const noDividers = await evaluateInNode(
      dividerBoxPreset.buildIR({ ...p, divisoesX: 1, divisoesY: 1 }),
    );
    expect(noDividers.ok).toBe(true);
  });

  it('avalia bucha com defaultParams, bbox correto e tempo < 300 ms', async () => {
    const p = bushingPreset.defaultParams;
    const t0 = performance.now();
    const res = await evaluateInNode(bushingPreset.buildIR(p));
    const elapsed = performance.now() - t0;

    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(elapsed).toBeLessThan(300);
    expect(res.value.volumeMm3).toBeGreaterThan(0);
    expect(res.value.triangleCount).toBeGreaterThan(0);
    const rFlange = (p['diametroFlange'] ?? 0) / 2;
    expect(res.value.bbox.min[0]).toBeCloseTo(-rFlange, 1);
    expect(res.value.bbox.max[0]).toBeCloseTo(rFlange, 1);
    expect(res.value.bbox.min[1]).toBeCloseTo(-rFlange, 1);
    expect(res.value.bbox.max[1]).toBeCloseTo(rFlange, 1);
    expect(res.value.bbox.min[2]).toBeCloseTo(0, 3);
    expect(res.value.bbox.max[2]).toBeCloseTo(p['altura'] ?? 0, 3);
  });
});
