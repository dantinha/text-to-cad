import { FlaskConical, Layers3, Redo2, Undo2 } from 'lucide-react';
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { generateIR, getByokKey } from '@/ai';
import { emitScad, validateIR, type MeshData } from '@/core';
import { PT_BR } from '@/i18n/pt-BR';
import { createKernelClient, type KernelClient } from '@/kernel';
import { getPresetById, PRESETS } from '@/presets';
import { Viewport3D } from '@/viewer';
import { AiPromptPanel } from './AiPromptPanel';
import { HistoryPanel } from './HistoryPanel';
import { InspectorPanel } from './InspectorPanel';
import { LabPage } from './LabPage';
import { ParamPanel } from './ParamPanel';
import { type AppRoute, type MobileTab, useCadStore } from './store';

interface EvalState {
  readonly evalKey: string;
  readonly mesh: MeshData | null;
  readonly error: string | null;
}

const SLIDER_DEBOUNCE_MS = 120;

const IDLE_FEEDBACK = {
  status: 'idle' as const,
  message: '',
};

const MOBILE_TABS: readonly {
  readonly id: MobileTab;
  readonly label: string;
  readonly controls: string;
}[] = [
  { id: 'create', label: PT_BR.mobileTabs.create, controls: 'editor-panel-create' },
  { id: 'view', label: PT_BR.mobileTabs.view, controls: 'editor-panel-view' },
  { id: 'inspect', label: PT_BR.mobileTabs.inspect, controls: 'editor-panel-inspect' },
];

function resolveDefaultPreset() {
  const first = PRESETS[0];
  if (!first) {
    throw new Error('Nenhum preset paramétrico registrado.');
  }
  return first;
}

const DEFAULT_PRESET = resolveDefaultPreset();

const readCurrentRoute = (): AppRoute =>
  typeof window !== 'undefined' && window.location.pathname === '/lab' ? 'lab' : 'editor';

const MOBILE_MEDIA_QUERY = '(max-width: 1023px)';

function subscribeIsMobile(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(MOBILE_MEDIA_QUERY);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getIsMobileSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
}

function getIsMobileServerSnapshot(): boolean {
  return false;
}

const EDITABLE_INPUT_TYPES = new Set([
  'text',
  'password',
  'search',
  'email',
  'url',
  'tel',
  'number',
]);

function isEditableElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
    return true;
  }
  if (target instanceof HTMLInputElement) {
    return EDITABLE_INPUT_TYPES.has((target.type || 'text').toLowerCase());
  }
  return false;
}

/**
 * Shell v1 (M5): Prompt IA (Gemini) + Presets paramétricos + Histórico + Undo/Redo,
 * kernel Web Worker, viewport R3F, exportação STL/SCAD/JSON, abas mobile e `/lab`.
 */
export function App() {
  const route = useCadStore((s) => s.route);
  const sourceMode = useCadStore((s) => s.sourceMode);
  const selectedPresetId = useCadStore((s) => s.selectedPresetId);
  const paramsByPreset = useCadStore((s) => s.paramsByPreset);
  const aiModel = useCadStore((s) => s.aiModel);
  const aiGenerating = useCadStore((s) => s.aiGenerating);
  const aiFeedback = useCadStore((s) => s.aiFeedback);
  const mobileTab = useCadStore((s) => s.mobileTab);
  const history = useCadStore((s) => s.history);
  const canUndo = useCadStore((s) => s.undoStack.length > 0);
  const canRedo = useCadStore((s) => s.redoStack.length > 0);
  const immediateEvalNonce = useCadStore((s) => s.immediateEvalNonce);
  const isMobile = useSyncExternalStore(
    subscribeIsMobile,
    getIsMobileSnapshot,
    getIsMobileServerSnapshot,
  );

  const [evalState, setEvalState] = useState<EvalState>({
    evalKey: '',
    mesh: null,
    error: null,
  });

  const clientRef = useRef<KernelClient | null>(null);
  const hasEvaluatedRef = useRef(false);
  const lastImmediateNonceRef = useRef(immediateEvalNonce);
  const aiAbortRef = useRef<AbortController | null>(null);
  const mobileTabRefs = useRef<Record<MobileTab, HTMLButtonElement | null>>({
    create: null,
    view: null,
    inspect: null,
  });

  useEffect(() => {
    useCadStore.getState().setRoute(readCurrentRoute());
    const onPopState = () => useCadStore.getState().setRoute(readCurrentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    return () => {
      aiAbortRef.current?.abort();
      aiAbortRef.current = null;
    };
  }, []);

  const abortInFlightAi = () => {
    const state = useCadStore.getState();
    if (!aiAbortRef.current && !state.aiGenerating) return;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    state.setAiGenerating(false);
    state.setAiFeedback(IDLE_FEEDBACK);
  };

  // Atalhos globais de Desfazer (Ctrl/Cmd+Z) e Refazer (Ctrl/Cmd+Shift+Z ou Ctrl/Cmd+Y).
  useEffect(() => {
    if (route !== 'editor') return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (isEditableElement(document.activeElement) || isEditableElement(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === 'z' && !event.shiftKey) {
        if (useCadStore.getState().undoStack.length === 0) return;
        event.preventDefault();
        abortInFlightAi();
        useCadStore.getState().undo();
      } else if ((key === 'z' && event.shiftKey) || (key === 'y' && !event.shiftKey)) {
        if (useCadStore.getState().redoStack.length === 0) return;
        event.preventDefault();
        abortInFlightAi();
        useCadStore.getState().redo();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [route]);

  const navigate = (nextRoute: AppRoute) => {
    if (nextRoute === 'lab') {
      abortInFlightAi();
    }
    const targetPath = nextRoute === 'lab' ? '/lab' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    useCadStore.getState().setRoute(nextRoute);
  };

  const selectedPreset = useMemo(
    () => getPresetById(selectedPresetId) ?? DEFAULT_PRESET,
    [selectedPresetId],
  );

  const currentParams = useMemo(
    () => paramsByPreset[selectedPreset.id] ?? selectedPreset.defaultParams,
    [paramsByPreset, selectedPreset],
  );

  const presetRawDoc = useMemo(
    () => selectedPreset.buildIR(currentParams),
    [selectedPreset, currentParams],
  );

  const validatedDoc = useMemo(() => {
    if (sourceMode === 'ai' && aiModel.doc !== null) {
      return { ok: true as const, value: aiModel.doc };
    }
    return validateIR(presetRawDoc);
  }, [sourceMode, aiModel.doc, presetRawDoc]);

  const evalKey = useMemo(() => {
    if (sourceMode === 'ai' && aiModel.doc !== null) {
      return `ai:${aiModel.evalSeq}`;
    }
    return `preset:${selectedPreset.id}:${JSON.stringify(currentParams)}`;
  }, [sourceMode, aiModel.doc, aiModel.evalSeq, selectedPreset.id, currentParams]);

  const scadCode = useMemo(() => {
    if (!validatedDoc.ok) return '';
    return emitScad(validatedDoc.value);
  }, [validatedDoc]);

  const irJson = useMemo(() => {
    if (!validatedDoc.ok) return '';
    return JSON.stringify(validatedDoc.value, null, 2);
  }, [validatedDoc]);

  const validationError = useMemo(() => {
    if (validatedDoc.ok) return null;
    return validatedDoc.error.map((i) => `${i.path}: ${i.message}`).join(' ');
  }, [validatedDoc]);

  useEffect(() => {
    if (route !== 'editor') return;
    const client = createKernelClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, [route]);

  useEffect(() => {
    if (route !== 'editor' || !validatedDoc.ok) return;

    const client = clientRef.current;
    if (!client) return;

    const controller = new AbortController();
    const isImmediate =
      sourceMode === 'ai' ||
      !hasEvaluatedRef.current ||
      immediateEvalNonce !== lastImmediateNonceRef.current;
    const delay = isImmediate ? 0 : SLIDER_DEBOUNCE_MS;

    const timer = setTimeout(() => {
      hasEvaluatedRef.current = true;
      lastImmediateNonceRef.current = immediateEvalNonce;
      void client.evaluate(validatedDoc.value, controller.signal).then((res) => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          setEvalState({ evalKey, mesh: res.value, error: null });
          if (useCadStore.getState().lastEditGroup !== null) {
            useCadStore.getState().commitCurrentToHistory();
          }
        } else if (res.error.code !== 'cancelled') {
          setEvalState({ evalKey, mesh: null, error: res.error.message });
        }
      });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [route, sourceMode, validatedDoc, evalKey, immediateEvalNonce]);

  const isCurrentEval = evalState.evalKey === evalKey;
  const kernelEvaluating = route === 'editor' && validatedDoc.ok && !isCurrentEval;
  const loading = aiGenerating || kernelEvaluating;
  const error = validationError ?? (isCurrentEval ? evalState.error : null);
  const mesh = error ? null : evalState.mesh;

  const isAiActive = sourceMode === 'ai' && aiModel.doc !== null;
  const modelName = isAiActive ? (aiModel.doc.name ?? 'Modelo IA') : selectedPreset.name;
  const modelSubtitle = isAiActive ? aiModel.prompt : selectedPreset.description;

  const handleAiGenerate = async (promptText: string) => {
    aiAbortRef.current?.abort();
    const controller = new AbortController();
    aiAbortRef.current = controller;

    const store = useCadStore.getState();
    store.setAiGenerating(true);
    store.setAiFeedback({ status: 'loading', message: PT_BR.ai.loadingMessage });

    const userKey = getByokKey() || undefined;
    let res: Awaited<ReturnType<typeof generateIR>>;
    try {
      res = await generateIR(promptText, {
        signal: controller.signal,
        userKey,
      });
    } catch (cause) {
      if (controller.signal.aborted || aiAbortRef.current !== controller) {
        return;
      }
      aiAbortRef.current = null;
      store.setAiGenerating(false);
      store.setAiFeedback({
        status: 'error',
        message: cause instanceof Error ? cause.message : 'Erro inesperado ao gerar modelo via IA.',
      });
      return;
    }

    if (controller.signal.aborted || aiAbortRef.current !== controller) {
      return;
    }
    aiAbortRef.current = null;

    if (!res.ok) {
      store.setAiGenerating(false);
      if (res.error.code === 'cancelled') {
        store.setAiFeedback({ status: 'idle', message: PT_BR.ai.cancelledMessage });
      } else {
        store.setAiFeedback({ status: 'error', message: res.error.message });
      }
      return;
    }

    const validated = validateIR(res.value);
    if (!validated.ok) {
      store.setAiGenerating(false);
      store.setAiFeedback({
        status: 'error',
        message: validated.error.map((i) => `${i.path}: ${i.message}`).join(' '),
      });
      return;
    }

    store.commitAiModel(validated.value, promptText);
  };

  const handleAiCancel = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    const store = useCadStore.getState();
    store.setAiGenerating(false);
    store.setAiFeedback({ status: 'idle', message: PT_BR.ai.cancelledMessage });
  };

  const handleSelectPreset = (presetId: string) => {
    abortInFlightAi();
    useCadStore.getState().selectPreset(presetId);
  };

  const handleChangeParam = (key: string, value: number) => {
    abortInFlightAi();
    useCadStore.getState().setParam(key, value);
  };

  const handleResetParams = () => {
    abortInFlightAi();
    useCadStore.getState().resetParams();
  };

  const handleUndo = () => {
    abortInFlightAi();
    useCadStore.getState().undo();
  };

  const handleRedo = () => {
    abortInFlightAi();
    useCadStore.getState().redo();
  };

  const handleMobileTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % MOBILE_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + MOBILE_TABS.length) % MOBILE_TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = MOBILE_TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = MOBILE_TABS[nextIndex];
    if (target) {
      useCadStore.getState().setMobileTab(target.id);
      mobileTabRefs.current[target.id]?.focus();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
      <a
        href="#editor-main"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-indigo-600 focus:px-3 focus:py-1.5 focus:text-xs focus:font-medium focus:text-white focus:outline-2 focus:outline-offset-2 focus:outline-white"
      >
        {PT_BR.app.skipToMain}
      </a>

      {/* Cabeçalho */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-indigo-400">
            <Layers3 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 data-testid="app-title" className="text-sm font-semibold tracking-tight">
                {PT_BR.app.title}
              </h1>
              <span
                data-testid="app-status"
                className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
              >
                {PT_BR.app.statusBadge}
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">{PT_BR.app.subtitle}</p>
          </div>
        </div>

        <nav aria-label={PT_BR.nav.mainAriaLabel} className="flex items-center gap-1.5">
          <button
            type="button"
            data-testid="undo-btn"
            aria-label={PT_BR.nav.undoShortcutLabel}
            title={PT_BR.nav.undoShortcutLabel}
            disabled={!canUndo || route !== 'editor'}
            onClick={handleUndo}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{PT_BR.nav.undo}</span>
          </button>

          <button
            type="button"
            data-testid="redo-btn"
            aria-label={PT_BR.nav.redoShortcutLabel}
            title={PT_BR.nav.redoShortcutLabel}
            disabled={!canRedo || route !== 'editor'}
            onClick={handleRedo}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-xs text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">{PT_BR.nav.redo}</span>
          </button>

          <span className="mx-0.5 h-4 w-px bg-zinc-800" aria-hidden="true" />

          <button
            type="button"
            data-testid="nav-editor"
            aria-current={route === 'editor' ? 'page' : undefined}
            onClick={() => navigate('editor')}
            className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              route === 'editor'
                ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-200'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            {PT_BR.nav.editor}
          </button>
          <button
            type="button"
            data-testid="nav-lab"
            aria-current={route === 'lab' ? 'page' : undefined}
            onClick={() => navigate('lab')}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              route === 'lab'
                ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-200'
                : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{PT_BR.nav.lab}</span>
          </button>
        </nav>
      </header>

      {route === 'lab' ? (
        <LabPage />
      ) : (
        <>
          {/* Abas responsivas no mobile (< 1024px) */}
          <div
            role="tablist"
            aria-label={PT_BR.mobileTabs.ariaLabel}
            className="flex shrink-0 border-b border-zinc-800 bg-zinc-900/90 px-2 lg:hidden"
          >
            {MOBILE_TABS.map((tab, idx) => {
              const isSelected = mobileTab === tab.id;
              return (
                <button
                  key={tab.id}
                  ref={(el) => {
                    mobileTabRefs.current[tab.id] = el;
                  }}
                  id={`mobile-tab-${tab.id}`}
                  type="button"
                  role="tab"
                  data-testid={`mobile-tab-${tab.id}`}
                  aria-selected={isSelected}
                  aria-controls={tab.controls}
                  tabIndex={isSelected ? 0 : -1}
                  onClick={() => useCadStore.getState().setMobileTab(tab.id)}
                  onKeyDown={(e) => handleMobileTabKeyDown(e, idx)}
                  className={`flex-1 border-b-2 px-2 py-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500 ${
                    isSelected
                      ? 'border-indigo-500 text-zinc-100'
                      : 'border-transparent text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <main
            id="editor-main"
            tabIndex={-1}
            className="flex min-h-0 flex-1 flex-col overflow-hidden focus:outline-none lg:flex-row"
          >
            <aside
              id="editor-panel-create"
              role={isMobile ? 'tabpanel' : undefined}
              aria-labelledby={isMobile ? 'mobile-tab-create' : undefined}
              aria-label={isMobile ? undefined : 'Prompt IA, presets e histórico'}
              className={`${
                mobileTab === 'create' ? 'flex min-h-0 flex-1' : 'hidden'
              } w-full shrink-0 flex-col overflow-y-auto border-b border-zinc-800 bg-zinc-900/50 lg:flex lg:w-72 lg:flex-none lg:border-r lg:border-b-0 xl:w-80`}
            >
              <AiPromptPanel
                generating={aiGenerating}
                feedback={aiFeedback}
                onGenerate={(promptText) => void handleAiGenerate(promptText)}
                onCancel={handleAiCancel}
              />
              <ParamPanel
                presets={PRESETS}
                selectedPreset={selectedPreset}
                params={currentParams}
                isAiActive={isAiActive}
                onSelectPreset={handleSelectPreset}
                onChangeParam={handleChangeParam}
                onResetParams={handleResetParams}
              />
              <HistoryPanel
                items={history}
                onRestore={(item) => {
                  abortInFlightAi();
                  useCadStore.getState().restoreHistoryItem(item);
                }}
                onClear={() => useCadStore.getState().clearHistory()}
              />
            </aside>

            <div
              id="editor-panel-view"
              role={isMobile ? 'tabpanel' : undefined}
              aria-labelledby={isMobile ? 'mobile-tab-view' : undefined}
              className={`${
                mobileTab === 'view' ? 'flex min-h-0 flex-1' : 'hidden'
              } relative min-h-[340px] flex-1 lg:flex`}
            >
              <Viewport3D mesh={mesh} loading={loading} error={error} />
            </div>

            <InspectorPanel
              id="editor-panel-inspect"
              role={isMobile ? 'tabpanel' : undefined}
              ariaLabelledBy={isMobile ? 'mobile-tab-inspect' : undefined}
              className={mobileTab === 'inspect' ? 'flex min-h-0 flex-1' : 'hidden'}
              modelName={modelName}
              modelSubtitle={modelSubtitle}
              doc={validatedDoc.ok ? validatedDoc.value : null}
              mesh={mesh}
              loading={loading}
              scadCode={scadCode}
              irJson={irJson}
            />
          </main>
        </>
      )}
    </div>
  );
}
