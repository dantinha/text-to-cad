import { castDraft, current, type Draft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { validateIR, type IRDocument } from '@/core';
import { PT_BR } from '@/i18n/pt-BR';
import { getPresetById, PRESETS, type ParamValues } from '@/presets';
import type { AiPromptFeedback } from './AiPromptPanel';
import {
  clearHistory as clearPersistedHistory,
  createSnapshotId,
  loadHistory,
  pushHistoryItem,
  saveHistory,
  type ModelSnapshot,
} from './history';

export type AppRoute = 'editor' | 'lab';
export type SourceMode = 'preset' | 'ai';
export type MobileTab = 'create' | 'view' | 'inspect';

export const MAX_UNDO = 30;

export interface AiModelState {
  readonly doc: IRDocument | null;
  readonly prompt: string;
  readonly evalSeq: number;
}

export interface UndoEntry {
  readonly sourceMode: SourceMode;
  readonly selectedPresetId: string;
  readonly paramsByPreset: Readonly<Record<string, ParamValues>>;
  readonly aiModel: AiModelState;
}

export interface CadState {
  readonly route: AppRoute;
  readonly sourceMode: SourceMode;
  readonly selectedPresetId: string;
  readonly paramsByPreset: Record<string, ParamValues>;
  readonly aiModel: AiModelState;
  readonly aiGenerating: boolean;
  readonly aiFeedback: AiPromptFeedback;
  readonly mobileTab: MobileTab;
  readonly history: ModelSnapshot[];
  readonly undoStack: UndoEntry[];
  readonly redoStack: UndoEntry[];
  readonly lastEditGroup: string | null;
  readonly immediateEvalNonce: number;
}

export interface CadActions {
  setRoute: (route: AppRoute) => void;
  setMobileTab: (tab: MobileTab) => void;
  setAiGenerating: (generating: boolean) => void;
  setAiFeedback: (feedback: AiPromptFeedback) => void;
  selectPreset: (presetId: string) => void;
  setParam: (key: string, value: number) => void;
  resetParams: () => void;
  commitAiModel: (doc: IRDocument, prompt: string) => void;
  restoreHistoryItem: (item: ModelSnapshot) => void;
  commitCurrentToHistory: () => void;
  clearHistory: () => void;
  undo: () => void;
  redo: () => void;
  resetWorkspace: () => void;
}

export type CadStore = CadState & CadActions;

const IDLE_FEEDBACK: AiPromptFeedback = { status: 'idle', message: '' };

function resolveDefaultPresetId(): string {
  const first = PRESETS[0];
  if (!first) {
    throw new Error('Nenhum preset paramétrico registrado.');
  }
  return first.id;
}

const DEFAULT_PRESET_ID = resolveDefaultPresetId();

function buildDefaultParamsByPreset(): Record<string, ParamValues> {
  return Object.fromEntries(PRESETS.map((p) => [p.id, { ...p.defaultParams }]));
}

function readInitialRoute(): AppRoute {
  return typeof window !== 'undefined' && window.location.pathname === '/lab' ? 'lab' : 'editor';
}

function cloneParamsByPreset(
  params: Readonly<Record<string, ParamValues>>,
): Record<string, ParamValues> {
  const cloned: Record<string, ParamValues> = {};
  for (const [presetId, values] of Object.entries(params)) {
    cloned[presetId] = { ...values };
  }
  return cloned;
}

function captureUndoEntry(state: CadState): UndoEntry {
  return {
    sourceMode: state.sourceMode,
    selectedPresetId: state.selectedPresetId,
    paramsByPreset: cloneParamsByPreset(state.paramsByPreset),
    aiModel: { ...state.aiModel },
  };
}

function pushUndoEntry(stack: UndoEntry[], entry: UndoEntry): void {
  stack.push(entry);
  if (stack.length > MAX_UNDO) {
    stack.splice(0, stack.length - MAX_UNDO);
  }
}

function applyUndoEntry(state: Draft<CadState>, entry: UndoEntry): void {
  state.sourceMode = entry.sourceMode;
  state.selectedPresetId = entry.selectedPresetId;
  state.paramsByPreset = cloneParamsByPreset(entry.paramsByPreset);
  state.aiModel = castDraft({ ...entry.aiModel });
  state.aiFeedback = IDLE_FEEDBACK;
  state.lastEditGroup = null;
  state.immediateEvalNonce += 1;
}

function paramsEqual(a: ParamValues, b: ParamValues): boolean {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => a[k] === b[k]);
}

function buildCurrentSnapshot(state: CadState): ModelSnapshot | null {
  if (state.sourceMode === 'ai' && state.aiModel.doc !== null) {
    const validated = validateIR(state.aiModel.doc);
    if (!validated.ok) return null;
    return {
      id: createSnapshotId(),
      source: 'ai',
      label: validated.value.name ?? 'Modelo IA',
      promptOrPresetId: state.aiModel.prompt,
      doc: validated.value,
      createdAt: new Date().toISOString(),
    };
  }

  const preset = getPresetById(state.selectedPresetId);
  if (!preset) return null;
  const params = state.paramsByPreset[preset.id] ?? preset.defaultParams;
  const validated = validateIR(preset.buildIR(params));
  if (!validated.ok) return null;

  return {
    id: createSnapshotId(),
    source: 'preset',
    label: preset.name,
    promptOrPresetId: preset.id,
    presetParams: { ...params },
    doc: validated.value,
    createdAt: new Date().toISOString(),
  };
}

function recordCurrentSnapshot(state: Draft<CadState>): void {
  const plainState = current(state);
  const snapshot = buildCurrentSnapshot(plainState);
  if (!snapshot) return;
  const nextHistory = pushHistoryItem(plainState.history, snapshot);
  state.history = castDraft(nextHistory);
  saveHistory(nextHistory);
}

function createInitialState(): CadState {
  return {
    route: readInitialRoute(),
    sourceMode: 'preset',
    selectedPresetId: DEFAULT_PRESET_ID,
    paramsByPreset: buildDefaultParamsByPreset(),
    aiModel: { doc: null, prompt: '', evalSeq: 0 },
    aiGenerating: false,
    aiFeedback: IDLE_FEEDBACK,
    mobileTab: 'create',
    history: loadHistory(),
    undoStack: [],
    redoStack: [],
    lastEditGroup: null,
    immediateEvalNonce: 0,
  };
}

/** Cria uma instância isolada do store Zustand + Immer (útil para testes). */
export function createCadStore() {
  return create<CadStore>()(
    immer((set) => ({
      ...createInitialState(),

      setRoute: (route) =>
        set((state) => {
          state.route = route;
        }),

      setMobileTab: (tab) =>
        set((state) => {
          state.mobileTab = tab;
        }),

      setAiGenerating: (generating) =>
        set((state) => {
          state.aiGenerating = generating;
        }),

      setAiFeedback: (feedback) =>
        set((state) => {
          state.aiFeedback = feedback;
        }),

      selectPreset: (presetId) =>
        set((state) => {
          const preset = getPresetById(presetId);
          if (!preset) return;
          state.lastEditGroup = null;
          if (state.sourceMode === 'preset' && state.selectedPresetId === preset.id) {
            return;
          }
          pushUndoEntry(state.undoStack, captureUndoEntry(state));
          state.redoStack = [];
          state.sourceMode = 'preset';
          state.selectedPresetId = preset.id;
          state.immediateEvalNonce += 1;
          recordCurrentSnapshot(state);
        }),

      setParam: (key, value) =>
        set((state) => {
          const preset = getPresetById(state.selectedPresetId);
          if (!preset) return;
          const current = state.paramsByPreset[preset.id] ?? preset.defaultParams;
          const clamped = preset.clampParams({ ...current, [key]: value });
          if (state.sourceMode === 'preset' && paramsEqual(current, clamped)) {
            return;
          }
          const groupKey = `param:${preset.id}:${key}`;
          if (state.lastEditGroup !== groupKey || state.sourceMode !== 'preset') {
            pushUndoEntry(state.undoStack, captureUndoEntry(state));
            state.redoStack = [];
            state.lastEditGroup = groupKey;
          }
          state.sourceMode = 'preset';
          state.paramsByPreset[preset.id] = clamped;
        }),

      resetParams: () =>
        set((state) => {
          const preset = getPresetById(state.selectedPresetId);
          if (!preset) return;
          const current = state.paramsByPreset[preset.id] ?? preset.defaultParams;
          state.lastEditGroup = null;
          if (state.sourceMode === 'preset' && paramsEqual(current, preset.defaultParams)) {
            return;
          }
          pushUndoEntry(state.undoStack, captureUndoEntry(state));
          state.redoStack = [];
          state.sourceMode = 'preset';
          state.paramsByPreset[preset.id] = { ...preset.defaultParams };
          state.immediateEvalNonce += 1;
          recordCurrentSnapshot(state);
        }),

      commitAiModel: (doc, prompt) =>
        set((state) => {
          const validated = validateIR(doc);
          if (!validated.ok) return;
          pushUndoEntry(state.undoStack, captureUndoEntry(state));
          state.redoStack = [];
          state.lastEditGroup = null;
          state.sourceMode = 'ai';
          state.aiModel = castDraft({
            doc: validated.value,
            prompt,
            evalSeq: state.aiModel.evalSeq + 1,
          });
          state.aiGenerating = false;
          state.aiFeedback = { status: 'success', message: PT_BR.ai.successMessage };
          state.immediateEvalNonce += 1;
          recordCurrentSnapshot(state);
        }),

      restoreHistoryItem: (item) =>
        set((state) => {
          const validated = validateIR(item.doc);
          if (!validated.ok) return;
          pushUndoEntry(state.undoStack, captureUndoEntry(state));
          state.redoStack = [];
          state.lastEditGroup = null;

          if (item.source === 'preset') {
            const preset = getPresetById(item.promptOrPresetId);
            if (preset) {
              state.sourceMode = 'preset';
              state.selectedPresetId = preset.id;
              state.paramsByPreset[preset.id] = item.presetParams
                ? preset.clampParams(item.presetParams)
                : { ...preset.defaultParams };
            } else {
              state.sourceMode = 'ai';
              state.aiModel = castDraft({
                doc: validated.value,
                prompt: item.label,
                evalSeq: state.aiModel.evalSeq + 1,
              });
            }
          } else {
            state.sourceMode = 'ai';
            state.aiModel = castDraft({
              doc: validated.value,
              prompt: item.promptOrPresetId,
              evalSeq: state.aiModel.evalSeq + 1,
            });
          }

          state.aiFeedback = IDLE_FEEDBACK;
          state.immediateEvalNonce += 1;
          recordCurrentSnapshot(state);
        }),

      commitCurrentToHistory: () =>
        set((state) => {
          recordCurrentSnapshot(state);
          state.lastEditGroup = null;
        }),

      clearHistory: () =>
        set((state) => {
          clearPersistedHistory();
          state.history = [];
        }),

      undo: () =>
        set((state) => {
          const prev = state.undoStack.pop();
          if (!prev) return;
          pushUndoEntry(state.redoStack, captureUndoEntry(state));
          applyUndoEntry(state, prev);
        }),

      redo: () =>
        set((state) => {
          const next = state.redoStack.pop();
          if (!next) return;
          pushUndoEntry(state.undoStack, captureUndoEntry(state));
          applyUndoEntry(state, next);
        }),

      resetWorkspace: () =>
        set(() => ({
          ...createInitialState(),
        })),
    })),
  );
}

/** Store principal da aplicação usado pelo `App`. */
export const useCadStore = createCadStore();
