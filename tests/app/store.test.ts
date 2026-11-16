// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BYOK_SESSION_KEY } from '@/ai/byok';
import { PRESETS } from '@/presets';
import {
  clearHistory,
  HISTORY_STORAGE_KEY,
  loadHistory,
  MAX_HISTORY_ITEMS,
  pushHistoryItem,
  redactSensitiveText,
  saveHistory,
  type ModelSnapshot,
} from '@/app/history';
import { createCadStore, MAX_UNDO } from '@/app/store';
import { cubeDoc } from '../fixtures/ir';

function makeSnapshot(overrides: Partial<ModelSnapshot> = {}): ModelSnapshot {
  return {
    id: overrides.id ?? 'snap-1',
    source: overrides.source ?? 'ai',
    label: overrides.label ?? 'Modelo Teste',
    promptOrPresetId: overrides.promptOrPresetId ?? 'Cubo 10 mm',
    presetParams: overrides.presetParams,
    doc: overrides.doc ?? cubeDoc(),
    createdAt: overrides.createdAt ?? '2026-11-16T20:00:00.000Z',
  };
}

describe('history.ts (localStorage persistente)', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it('limita o histórico a 20 itens e evita duplicar o topo com o mesmo IR', () => {
    let items: ModelSnapshot[] = [];
    for (let i = 1; i <= 25; i += 1) {
      const doc = {
        schemaVersion: 1 as const,
        units: 'mm' as const,
        name: `Cubo ${i}`,
        root: { id: `c-${i}`, type: 'cube' as const, size: [10 + i, 10, 10] as const },
      };
      items = pushHistoryItem(
        items,
        makeSnapshot({
          id: `id-${i}`,
          label: `Cubo ${i}`,
          doc,
        }),
      );
    }

    expect(items).toHaveLength(MAX_HISTORY_ITEMS);
    expect(items[0]?.id).toBe('id-25');
    expect(items[19]?.id).toBe('id-6');

    // Mesmo IR no topo não duplica
    const topDoc = items[0]?.doc;
    if (!topDoc) throw new Error('topDoc ausente');
    const afterDup = pushHistoryItem(
      items,
      makeSnapshot({ id: 'id-dup', label: 'Duplicado', doc: topDoc }),
    );
    expect(afterDup).toHaveLength(MAX_HISTORY_ITEMS);
    expect(afterDup[0]?.id).toBe('id-25');
    expect(afterDup).not.toBe(items);
  });

  it('rejeita JSON corrompido e entradas com IR inválido no localStorage', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, '{json-quebrado');
    expect(loadHistory()).toEqual([]);

    const validEntry = makeSnapshot({ id: 'ok-1', label: 'Válido', doc: cubeDoc() });
    const invalidIrEntry = {
      id: 'bad-ir',
      source: 'ai',
      label: 'Inválido',
      promptOrPresetId: 'bad',
      doc: { schemaVersion: 1, units: 'mm', root: { id: 'x', type: 'cube', size: [-5, 10, 10] } },
      createdAt: '2026-11-16T20:00:00.000Z',
    };
    const malformedEntry = { id: 123, source: 'unknown' };

    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([validEntry, invalidIrEntry, malformedEntry]),
    );

    const loaded = loadHistory();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.id).toBe('ok-1');
  });

  it('redige chaves AIza... e AQ... antes de salvar no histórico', () => {
    expect(redactSensitiveText('chave AIzaSyD1234567890abcd e AQ.abcdef123456')).toBe(
      'chave [REDACTED] e [REDACTED]',
    );

    const items = pushHistoryItem(
      [],
      makeSnapshot({
        label: 'Peça AIzaSyD1234567890abcd',
        promptOrPresetId: 'Prompt com AQ.AbCdEfGhIjKlMnOp',
        doc: { ...cubeDoc(), name: 'Modelo AIzaSyD1234567890abcd' },
      }),
    );

    expect(items[0]?.label).not.toContain('AIza');
    expect(items[0]?.promptOrPresetId).not.toContain('AQ.');
    expect(items[0]?.doc.name).not.toContain('AIza');
    expect(items[0]?.label).toContain('[REDACTED]');
    expect(items[0]?.promptOrPresetId).toContain('[REDACTED]');
    expect(items[0]?.doc.name).toContain('[REDACTED]');
  });

  it('clearHistory remove a chave do localStorage', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify([makeSnapshot()]));
    clearHistory();
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('valida presetParams, lida com JSON não-array, trunca >20 no load e redige chave BYOK da sessão', () => {
    window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ not: 'array' }));
    expect(loadHistory()).toEqual([]);

    window.sessionStorage.setItem(BYOK_SESSION_KEY, 'minha-chave-secreta-123');
    expect(redactSensitiveText('prompt com minha-chave-secreta-123')).toBe('prompt com [REDACTED]');

    const validPreset = makeSnapshot({
      id: 'p-1',
      source: 'preset',
      label: 'Flange',
      promptOrPresetId: 'flange',
      presetParams: { diametroExterno: 120 },
    });
    const badParams = {
      ...validPreset,
      id: 'p-bad',
      presetParams: { diametroExterno: 'NaN' },
    };
    const oversizedField = {
      ...validPreset,
      id: 'p-huge',
      label: 'x'.repeat(5500),
    };
    const manyValid = Array.from({ length: 25 }, (_, idx) =>
      makeSnapshot({ id: `m-${idx}`, label: `M ${idx}` }),
    );
    window.localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify([validPreset, badParams, oversizedField, ...manyValid]),
    );

    const loaded = loadHistory();
    expect(loaded).toHaveLength(MAX_HISTORY_ITEMS);
    expect(loaded[0]?.presetParams).toEqual({ diametroExterno: 120 });
    expect(loaded.find((item) => item.id === 'p-bad')).toBeUndefined();
    expect(loaded.find((item) => item.id === 'p-huge')).toBeUndefined();

    saveHistory([validPreset]);
    expect(loadHistory()).toHaveLength(1);
  });
});

describe('store.ts (Zustand + Immer + Undo/Redo)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it('agrupa ajustes contínuos de slider em 1 entrada de undo e limpa redoStack em nova ação', () => {
    const store = createCadStore();
    const initialPresetId = store.getState().selectedPresetId;
    const initialLargura = store.getState().paramsByPreset[initialPresetId]?.largura;

    // 3 movimentos consecutivos no mesmo slider do mesmo preset -> 1 entrada de undo
    store.getState().setParam('largura', 70);
    store.getState().setParam('largura', 80);
    store.getState().setParam('largura', 90);

    expect(store.getState().paramsByPreset[initialPresetId]?.largura).toBe(90);
    expect(store.getState().undoStack).toHaveLength(1);

    // 1 undo restaura para o valor antes do gesto contínuo
    store.getState().undo();
    expect(store.getState().paramsByPreset[initialPresetId]?.largura).toBe(initialLargura);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(store.getState().redoStack).toHaveLength(1);

    // Redo volta para 90
    store.getState().redo();
    expect(store.getState().paramsByPreset[initialPresetId]?.largura).toBe(90);
    expect(store.getState().redoStack).toHaveLength(0);

    // Parâmetro diferente no mesmo preset cria nova entrada de undo (lastEditGroup granular)
    store.getState().setParam('altura', 55);
    expect(store.getState().undoStack).toHaveLength(2);
    store.getState().undo();
    expect(store.getState().paramsByPreset[initialPresetId]?.largura).toBe(90);

    // Nova ação limpa redoStack
    store.getState().undo();
    expect(store.getState().redoStack).toHaveLength(2);
    store.getState().selectPreset('flange');
    expect(store.getState().selectedPresetId).toBe('flange');
    expect(store.getState().redoStack).toHaveLength(0);
  });

  it('alterna entre IA e preset, registra no histórico, restaura item e limpa histórico', () => {
    const store = createCadStore();
    const doc = { ...cubeDoc(), name: 'Cubo IA Teste' };

    store.getState().commitAiModel(doc, 'Cubo 10 mm via IA');
    expect(store.getState().sourceMode).toBe('ai');
    expect(store.getState().aiModel.doc).toEqual(doc);
    expect(store.getState().history).toHaveLength(1);
    expect(store.getState().history[0]?.source).toBe('ai');

    // Troca para preset flange
    store.getState().selectPreset('flange');
    expect(store.getState().sourceMode).toBe('preset');
    expect(store.getState().history).toHaveLength(2);
    expect(store.getState().history[0]?.source).toBe('preset');

    // Restaura o item de IA do histórico
    const aiSnapshot = store.getState().history[1];
    if (!aiSnapshot) throw new Error('aiSnapshot ausente');
    store.getState().restoreHistoryItem(aiSnapshot);
    expect(store.getState().sourceMode).toBe('ai');
    expect(store.getState().aiModel.prompt).toBe('Cubo 10 mm via IA');

    // Undo volta para preset flange
    store.getState().undo();
    expect(store.getState().sourceMode).toBe('preset');
    expect(store.getState().selectedPresetId).toBe('flange');

    // Reset params funciona e respeita undo
    store.getState().setParam('diametroExterno', 140);
    store.getState().resetParams();
    const flangeDefault = PRESETS.find((p) => p.id === 'flange')?.defaultParams.diametroExterno;
    expect(store.getState().paramsByPreset.flange?.diametroExterno).toBe(flangeDefault);

    // Clear history
    store.getState().clearHistory();
    expect(store.getState().history).toEqual([]);
    expect(window.localStorage.getItem(HISTORY_STORAGE_KEY)).toBeNull();
  });

  it('respeita limite MAX_UNDO na pilha de desfazer', () => {
    const store = createCadStore();
    for (let i = 0; i < MAX_UNDO + 10; i += 1) {
      store.getState().selectPreset(i % 2 === 0 ? 'flange' : 'bucha');
    }
    expect(store.getState().undoStack.length).toBeLessThanOrEqual(MAX_UNDO);
  });

  it('trata no-ops, IR inválido, restauração com presetParams/preset desconhecido e commitCurrentToHistory', () => {
    const store = createCadStore();
    const firstId = store.getState().selectedPresetId;

    // No-ops quando pilhas estão vazias ou valores não mudam
    store.getState().undo();
    store.getState().redo();
    store.getState().selectPreset(firstId);
    store.getState().resetParams();
    store.getState().selectPreset('preset-inexistente');
    expect(store.getState().undoStack).toHaveLength(0);

    const currentLargura = store.getState().paramsByPreset[firstId]?.largura;
    if (currentLargura !== undefined) {
      store.getState().setParam('largura', currentLargura);
      expect(store.getState().undoStack).toHaveLength(0);
    }

    // commitAiModel com IR inválido é ignorado
    const invalidDoc = {
      schemaVersion: 1,
      units: 'mm',
      root: { id: 'bad', type: 'cube', size: [-1, 10, 10] },
    } as unknown as ModelSnapshot['doc'];
    store.getState().commitAiModel(invalidDoc, 'inválido');
    expect(store.getState().sourceMode).toBe('preset');

    // restoreHistoryItem com IR inválido é ignorado
    store.getState().restoreHistoryItem(makeSnapshot({ doc: invalidDoc }));
    expect(store.getState().sourceMode).toBe('preset');

    // restoreHistoryItem de preset com presetParams
    store.getState().restoreHistoryItem(
      makeSnapshot({
        id: 'snap-flange',
        source: 'preset',
        label: 'Flange custom',
        promptOrPresetId: 'flange',
        presetParams: { diametroExterno: 130 },
      }),
    );
    expect(store.getState().selectedPresetId).toBe('flange');
    expect(store.getState().paramsByPreset.flange?.diametroExterno).toBe(130);

    // restoreHistoryItem de preset sem presetParams volta aos padrões e zera aiFeedback
    store.getState().setAiFeedback({ status: 'error', message: 'Erro residual' });
    store.getState().restoreHistoryItem(
      makeSnapshot({
        id: 'snap-flange-default',
        source: 'preset',
        label: 'Flange padrão',
        promptOrPresetId: 'flange',
        presetParams: undefined,
      }),
    );
    const flangeDefault = PRESETS.find((p) => p.id === 'flange')?.defaultParams.diametroExterno;
    expect(store.getState().paramsByPreset.flange?.diametroExterno).toBe(flangeDefault);
    expect(store.getState().aiFeedback.status).toBe('idle');

    // restoreHistoryItem de preset desconhecido cai em fallback IA
    store.getState().restoreHistoryItem(
      makeSnapshot({
        id: 'snap-unknown-preset',
        source: 'preset',
        label: 'Preset Legado',
        promptOrPresetId: 'legado-inexistente',
      }),
    );
    expect(store.getState().sourceMode).toBe('ai');
    store.getState().commitCurrentToHistory();
    expect(store.getState().history[0]?.source).toBe('ai');

    // setParam a partir do modo IA volta para preset
    store.getState().setParam('diametroExterno', 115);
    expect(store.getState().sourceMode).toBe('preset');
    store.getState().commitCurrentToHistory();
    expect(store.getState().lastEditGroup).toBeNull();
    expect(store.getState().history[0]?.source).toBe('preset');
  });
});
