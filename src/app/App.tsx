import { FlaskConical, Layers3 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { emitScad, validateIR, type MeshData } from '@/core';
import { createKernelClient, type KernelClient } from '@/kernel';
import { getPresetById, PRESETS, type ParamValues } from '@/presets';
import { Viewport3D } from '@/viewer';
import { InspectorPanel } from './InspectorPanel';
import { LabPage } from './LabPage';
import { ParamPanel } from './ParamPanel';

type AppRoute = 'editor' | 'lab';

interface EvalState {
  readonly evalKey: string;
  readonly mesh: MeshData | null;
  readonly error: string | null;
}

const SLIDER_DEBOUNCE_MS = 120;

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
 * Shell do Marco 3: presets paramétricos com sliders (< 300 ms),
 * kernel Web Worker, viewport R3F, exportação STL/SCAD/JSON e rota `/lab`.
 */
export function App() {
  const [route, setRoute] = useState<AppRoute>(readCurrentRoute);
  const [selectedPresetId, setSelectedPresetId] = useState<string>(DEFAULT_PRESET.id);
  const [paramsByPreset, setParamsByPreset] = useState<Readonly<Record<string, ParamValues>>>(() =>
    Object.fromEntries(PRESETS.map((p) => [p.id, p.defaultParams])),
  );
  const [evalState, setEvalState] = useState<EvalState>({
    evalKey: '',
    mesh: null,
    error: null,
  });

  const clientRef = useRef<KernelClient | null>(null);
  const hasEvaluatedRef = useRef(false);

  useEffect(() => {
    const onPopState = () => setRoute(readCurrentRoute());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const navigate = (nextRoute: AppRoute) => {
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

  const rawDoc = useMemo(
    () => selectedPreset.buildIR(currentParams),
    [selectedPreset, currentParams],
  );

  const validatedDoc = useMemo(() => validateIR(rawDoc), [rawDoc]);

  const evalKey = useMemo(
    () => `${selectedPreset.id}:${JSON.stringify(currentParams)}`,
    [selectedPreset.id, currentParams],
  );

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
    const delay = hasEvaluatedRef.current ? SLIDER_DEBOUNCE_MS : 0;

    const timer = setTimeout(() => {
      hasEvaluatedRef.current = true;
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
  }, [route, validatedDoc, evalKey]);

  const isCurrentEval = evalState.evalKey === evalKey;
  const loading = route === 'editor' && validatedDoc.ok && !isCurrentEval;
  const error = validationError ?? (isCurrentEval ? evalState.error : null);
  const mesh = error ? null : evalState.mesh;

  const handleChangeParam = (key: string, value: number) => {
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
                M3 · Paramétrico &amp; STL
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              Presets paramétricos → manifold-3d (Worker) → Viewport 3D &amp; Exportação
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
        <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <ParamPanel
            presets={PRESETS}
            selectedPreset={selectedPreset}
            params={currentParams}
            onSelectPreset={setSelectedPresetId}
            onChangeParam={handleChangeParam}
            onResetParams={handleResetParams}
          />

          <div className="relative min-h-[360px] flex-1">
            <Viewport3D mesh={mesh} loading={loading} error={error} />
          </div>

          <InspectorPanel
            modelName={selectedPreset.name}
            modelSubtitle={selectedPreset.description}
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
