import { Check, Code2, Copy, FileJson, Layers3 } from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { emitScad, validateIR, type MeshData } from '@/core';
import { createKernelClient, type KernelClient } from '@/kernel';
import { Viewport3D } from '@/viewer';
import { M2_DEMO_MODELS } from './demoModels';

type InspectorTab = 'scad' | 'ir';

interface EvalState {
  readonly modelId: string;
  readonly mesh: MeshData | null;
  readonly error: string | null;
}

const INSPECTOR_TABS: readonly { readonly id: InspectorTab; readonly label: string }[] = [
  { id: 'scad', label: 'OpenSCAD (.scad)' },
  { id: 'ir', label: 'IR (JSON)' },
];

/**
 * Shell do Marco 2: valida o IR, avalia no Web Worker (manifold-3d),
 * transpila para OpenSCAD (.scad) e renderiza no Viewport 3D R3F.
 */
export function App() {
  const [selectedId, setSelectedId] = useState<string>(M2_DEMO_MODELS[0]?.id ?? 'cubo-furo');
  const [activeTab, setActiveTab] = useState<InspectorTab>('scad');
  const [evalState, setEvalState] = useState<EvalState>({
    modelId: '',
    mesh: null,
    error: null,
  });
  const [copied, setCopied] = useState<boolean>(false);

  const clientRef = useRef<KernelClient | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({
    scad: null,
    ir: null,
  });

  const selectedModel = useMemo(
    () => M2_DEMO_MODELS.find((m) => m.id === selectedId) ?? M2_DEMO_MODELS[0],
    [selectedId],
  );

  const validatedDoc = useMemo(() => {
    if (!selectedModel) return null;
    return validateIR(selectedModel.doc);
  }, [selectedModel]);

  const scadCode = useMemo(() => {
    if (!validatedDoc || !validatedDoc.ok) return '';
    return emitScad(validatedDoc.value);
  }, [validatedDoc]);

  const irJson = useMemo(() => {
    if (!validatedDoc || !validatedDoc.ok) return '';
    return JSON.stringify(validatedDoc.value, null, 2);
  }, [validatedDoc]);

  const validationError = useMemo(() => {
    if (!validatedDoc || validatedDoc.ok) return null;
    return validatedDoc.error.map((i) => `${i.path}: ${i.message}`).join(' ');
  }, [validatedDoc]);

  useEffect(() => {
    const client = createKernelClient();
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!selectedModel || !validatedDoc || !validatedDoc.ok) return;

    const client = clientRef.current;
    if (!client) return;

    const modelId = selectedModel.id;
    const controller = new AbortController();

    void client.evaluate(validatedDoc.value, controller.signal).then((res) => {
      if (controller.signal.aborted) return;
      if (res.ok) {
        setEvalState({ modelId, mesh: res.value, error: null });
      } else if (res.error.code !== 'cancelled') {
        setEvalState({ modelId, mesh: null, error: res.error.message });
      }
    });

    return () => {
      controller.abort();
    };
  }, [selectedModel, validatedDoc]);

  const isCurrentModel = selectedModel !== undefined && evalState.modelId === selectedModel.id;
  const loading = Boolean(validatedDoc?.ok) && !isCurrentModel;
  const error = validationError ?? (isCurrentModel ? evalState.error : null);
  const mesh = error ? null : evalState.mesh;

  const handleCopy = async () => {
    const text = activeTab === 'scad' ? scadCode : irJson;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    let nextIndex: number;
    if (event.key === 'ArrowRight') {
      nextIndex = (currentIndex + 1) % INSPECTOR_TABS.length;
    } else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + INSPECTOR_TABS.length) % INSPECTOR_TABS.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = INSPECTOR_TABS.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const nextTab = INSPECTOR_TABS[nextIndex];
    if (nextTab) {
      setActiveTab(nextTab.id);
      tabRefs.current[nextTab.id]?.focus();
    }
  };

  const activeTabButtonId = `inspector-tab-${activeTab}`;

  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
      {/* Cabeçalho compacto */}
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
                M2 · Pipeline CSG
              </span>
            </div>
            <p className="text-[11px] text-zinc-400">
              IR paramétrico → manifold-3d (Worker) → Viewport 3D &amp; OpenSCAD
            </p>
          </div>
        </div>

        {/* Seletor rápido de modelos de demonstração */}
        <nav aria-label="Modelos de demonstração" className="flex flex-wrap items-center gap-1.5">
          {M2_DEMO_MODELS.map((model) => {
            const active = model.id === selectedId;
            return (
              <button
                key={model.id}
                type="button"
                data-testid={`demo-model-${model.id}`}
                aria-pressed={active}
                onClick={() => setSelectedId(model.id)}
                className={`rounded border px-2.5 py-1 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                  active
                    ? 'border-indigo-500/60 bg-indigo-600/20 text-indigo-200'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800'
                }`}
              >
                {model.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Área principal: Viewport 3D + Inspetor de Código */}
      <main className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="relative min-h-[380px] flex-1 border-b border-zinc-800 lg:border-r lg:border-b-0">
          <Viewport3D mesh={mesh} loading={loading} error={error} />
        </div>

        <aside
          aria-label="Inspetor de código CAD"
          className="flex h-72 w-full flex-col bg-zinc-900/50 lg:h-auto lg:w-[420px] xl:w-[460px]"
        >
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <div role="tablist" aria-label="Formato de inspeção" className="flex gap-1">
              {INSPECTOR_TABS.map((tab, idx) => {
                const isSelected = activeTab === tab.id;
                const Icon = tab.id === 'scad' ? Code2 : FileJson;
                return (
                  <button
                    key={tab.id}
                    ref={(el) => {
                      tabRefs.current[tab.id] = el;
                    }}
                    id={`inspector-tab-${tab.id}`}
                    type="button"
                    role="tab"
                    data-testid={`tab-${tab.id}`}
                    aria-selected={isSelected}
                    aria-controls="inspector-panel"
                    tabIndex={isSelected ? 0 : -1}
                    onClick={() => setActiveTab(tab.id)}
                    onKeyDown={(e) => handleTabKeyDown(e, idx)}
                    className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                      isSelected ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            <button
              type="button"
              data-testid="copy-code"
              aria-label={
                copied ? 'Código copiado para a área de transferência' : 'Copiar código exibido'
              }
              onClick={() => void handleCopy()}
              className="inline-flex items-center gap-1.5 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  <span>Copiado</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copiar</span>
                </>
              )}
            </button>
            <span className="sr-only" aria-live="polite">
              {copied ? 'Código copiado para a área de transferência.' : ''}
            </span>
          </div>

          {selectedModel ? (
            <div className="border-b border-zinc-800/80 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-400">
              <span className="font-medium text-zinc-300">{selectedModel.label}</span>
              {' · '}
              <span className="font-mono">{selectedModel.subtitle}</span>
            </div>
          ) : null}

          <div
            id="inspector-panel"
            role="tabpanel"
            aria-labelledby={activeTabButtonId}
            tabIndex={0}
            className="min-h-0 flex-1 overflow-auto p-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-indigo-500"
          >
            <pre
              data-testid="inspector-code"
              className="font-mono text-xs leading-relaxed text-zinc-300"
            >
              <code>{activeTab === 'scad' ? scadCode : irJson}</code>
            </pre>
          </div>
        </aside>
      </main>
    </div>
  );
}
