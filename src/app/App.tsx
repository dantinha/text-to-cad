import { FlaskConical, Layers3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { generateIR, getByokKey } from '@/ai';
import { emitScad, validateIR, type IRDocument, type MeshData } from '@/core';
import { createKernelClient, type KernelClient } from '@/kernel';
import { getPresetById, PRESETS, type ParamValues } from '@/presets';
import { Viewport3D } from '@/viewer';
import { type AiPromptFeedback, AiPromptPanel } from './AiPromptPanel';
import { InspectorPanel } from './InspectorPanel';
import { LabPage } from './LabPage';
import { ParamPanel } from './ParamPanel';

type AppRoute = 'editor' | 'lab';
type SourceMode = 'preset' | 'ai';

interface EvalState {
  readonly evalKey: string;
  readonly mesh: MeshData | null;
  readonly error: string | null;
}

interface AiModelState {
  readonly doc: IRDocument | null;
  readonly prompt: string;
  readonly evalSeq: number;
}

const SLIDER_DEBOUNCE_MS = 120;

const IDLE_FEEDBACK: AiPromptFeedback = {
  status: 'idle',
  message: '',
};

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

/**
 * Shell do Marco 4: Prompt IA (Gemini) + presets paramétricos,
 * kernel Web Worker, viewport R3F, exportação STL/SCAD/JSON e rota `/lab`.
 */
export function App() {
  const [route, setRoute] = useState<AppRoute>(readCurrentRoute);
  const [sourceMode, setSourceMode] = useState<SourceMode>('preset');
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_PRESET.id);
  const [paramsByPreset, setParamsByPreset] = useState<Readonly<Record<string, ParamValues>>>(() =>
    Object.fromEntries(PRESETS.map((p) => [p.id, p.defaultParams])),
  );
  const [evalState, setEvalState] = useState<EvalState>({
    evalKey: '',
    mesh: null,
    error: null,
  });

  const [aiModel, setAiModel] = useState<AiModelState>({
    doc: null,
    prompt: '',
    evalSeq: 0,
  });
  const [aiGenerating, setAiGenerating] = useState<boolean>(false);
  const [aiFeedback, setAiFeedback] = useState<AiPromptFeedback>(IDLE_FEEDBACK);

  const clientRef = useRef<KernelClient | null>(null);
  const hasEvaluatedRef = useRef(false);
  const immediateEvalRef = useRef(false);
  const aiAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const onPopState = () => setRoute(readCurrentRoute());
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
    if (!aiAbortRef.current && !aiGenerating) return;
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiGenerating(false);
    setAiFeedback(IDLE_FEEDBACK);
  };

  const navigate = (nextRoute: AppRoute) => {
    if (nextRoute === 'lab') {
      abortInFlightAi();
    }
    const targetPath = nextRoute === 'lab' ? '/lab' : '/';
    if (window.location.pathname !== targetPath) {
      window.history.pushState({}, '', targetPath);
    }
    setRoute(nextRoute);
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
    const delay =
      sourceMode === 'preset' && hasEvaluatedRef.current && !immediateEvalRef.current
        ? SLIDER_DEBOUNCE_MS
        : 0;

    const timer = setTimeout(() => {
      hasEvaluatedRef.current = true;
      immediateEvalRef.current = false;
      void client.evaluate(validatedDoc.value, controller.signal).then((res) => {
        if (controller.signal.aborted) return;
        if (res.ok) {
          setEvalState({ evalKey, mesh: res.value, error: null });
        } else if (res.error.code !== 'cancelled') {
          setEvalState({ evalKey, mesh: null, error: res.error.message });
        }
      });
    }, delay);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [route, sourceMode, validatedDoc, evalKey]);

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

    setAiGenerating(true);
    setAiFeedback({ status: 'loading', message: 'Gerando e validando geometria via Gemini...' });

    const userKey = getByokKey() || undefined;
    const res = await generateIR(promptText, {
      signal: controller.signal,
      userKey,
    });

    if (controller.signal.aborted || aiAbortRef.current !== controller) {
      return;
    }
    aiAbortRef.current = null;

    if (!res.ok) {
      setAiGenerating(false);
      if (res.error.code === 'cancelled') {
        setAiFeedback({ status: 'idle', message: 'Geração cancelada.' });
      } else {
        setAiFeedback({ status: 'error', message: res.error.message });
      }
      return;
    }

    const validated = validateIR(res.value);
    if (!validated.ok) {
      setAiGenerating(false);
      setAiFeedback({
        status: 'error',
        message: validated.error.map((i) => `${i.path}: ${i.message}`).join(' '),
      });
      return;
    }

    setAiModel((prev) => ({
      doc: validated.value,
      prompt: promptText,
      evalSeq: prev.evalSeq + 1,
    }));
    setSourceMode('ai');
    setAiGenerating(false);
    setAiFeedback({ status: 'success', message: 'Modelo gerado pela IA e validado.' });
  };

  const handleAiCancel = () => {
    aiAbortRef.current?.abort();
    aiAbortRef.current = null;
    setAiGenerating(false);
    setAiFeedback({ status: 'idle', message: 'Geração cancelada.' });
  };

  const handleSelectPreset = (presetId: string) => {
    abortInFlightAi();
    immediateEvalRef.current = true;
    setSourceMode('preset');
    setSelectedPresetId(presetId);
  };

  const handleChangeParam = (key: string, value: number) => {
    abortInFlightAi();
    setSourceMode('preset');
    setParamsByPreset((prev) => {
      const current = prev[selectedPreset.id] ?? selectedPreset.defaultParams;
      const clamped = selectedPreset.clampParams({ ...current, [key]: value });
      return { ...prev, [selectedPreset.id]: clamped };
    });
  };

  const handleResetParams = () => {
    setParamsByPreset((prev) => ({
      ...prev,
      [selectedPreset.id]: selectedPreset.defaultParams,
    }));
  };

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
      {/* Cabeçalho */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900/80 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-7 w-7 items-center justify-center rounded border border-zinc-700 bg-zinc-800 text-indigo-400">
            <Layers3 className="h-4 w-4" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 data-testid="app-title" className="text-sm font-semibold tracking-tight">
                Text-to-CAD
              </h1>
              <span
                data-testid="app-status"
                className="rounded border border-zinc-700 bg-zinc-800/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-300"
              >
                M4 · IA Gemini, Paramétrico &amp; STL
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Prompt IA (Gemini) &amp; Presets → manifold-3d (Worker) → Viewport 3D &amp; Exportação
            </p>
          </div>
        </div>

        <nav aria-label="Navegação principal" className="flex items-center gap-1.5">
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
            Editor
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
            <span>Lab (/lab)</span>
          </button>
        </nav>
      </header>

      {route === 'lab' ? (
        <LabPage />
      ) : (
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <aside
            aria-label="Prompt IA, presets e parâmetros do modelo"
            className="flex max-h-80 w-full shrink-0 flex-col overflow-y-auto border-b border-zinc-800 bg-zinc-900/50 lg:max-h-none lg:w-72 lg:border-r lg:border-b-0 xl:w-80"
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
          </aside>

          <div className="relative min-h-[360px] flex-1">
            <Viewport3D mesh={mesh} loading={loading} error={error} />
          </div>

          <InspectorPanel
            modelName={modelName}
            modelSubtitle={modelSubtitle}
            doc={validatedDoc.ok ? validatedDoc.value : null}
            mesh={mesh}
            loading={loading}
            scadCode={scadCode}
            irJson={irJson}
          />
        </main>
      )}
    </div>
  );
}
