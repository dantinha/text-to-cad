import { Download } from 'lucide-react';
import { useEffect, useState } from 'react';
import { validateIR, type MeshData } from '@/core';
import { exportStl, sanitizeFilename, triggerBlobDownload } from '@/export';
import { createKernelClient } from '@/kernel';
import { PRESETS } from '@/presets';
import { Viewport3D } from '@/viewer';

interface LabEntryState {
  readonly mesh: MeshData | null;
  readonly loading: boolean;
  readonly error: string | null;
  readonly durationMs: number | null;
}

const INITIAL_ENTRY: LabEntryState = {
  mesh: null,
  loading: true,
  error: null,
  durationMs: null,
};

/**
 * Rota `/lab`: avalia e exibe todos os presets paramétricos lado a lado
 * para inspeção visual e validação de desempenho.
 */
export function LabPage() {
  const [entries, setEntries] = useState<Readonly<Record<string, LabEntryState>>>(() =>
    Object.fromEntries(PRESETS.map((p) => [p.id, INITIAL_ENTRY])),
  );

  useEffect(() => {
    const client = createKernelClient();
    const controller = new AbortController();

    const runAll = async (): Promise<void> => {
      for (const preset of PRESETS) {
        if (controller.signal.aborted) break;
        const doc = preset.buildIR(preset.defaultParams);
        const checked = validateIR(doc);
        if (!checked.ok) {
          setEntries((prev) => ({
            ...prev,
            [preset.id]: {
              mesh: null,
              loading: false,
              error: checked.error.map((i) => `${i.path}: ${i.message}`).join(' '),
              durationMs: null,
            },
          }));
          continue;
        }

        const t0 = performance.now();
        const res = await client.evaluate(checked.value, controller.signal);
        const durationMs = Math.round(performance.now() - t0);
        if (controller.signal.aborted) break;

        setEntries((prev) => ({
          ...prev,
          [preset.id]: res.ok
            ? { mesh: res.value, loading: false, error: null, durationMs }
            : { mesh: null, loading: false, error: res.error.message, durationMs },
        }));
      }
    };

    void runAll();

    return () => {
      controller.abort();
      client.dispose();
    };
  }, []);

  return (
    <main
      data-testid="lab-page"
      className="min-h-0 flex-1 overflow-y-auto bg-zinc-950 p-4 text-zinc-100"
    >
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold">Laboratório de Presets (/lab)</h2>
          <p className="text-xs text-zinc-400">
            Inspeção lado a lado dos {PRESETS.length} presets paramétricos avaliados no kernel
            manifold-3d
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {PRESETS.map((preset) => {
          const state = entries[preset.id] ?? INITIAL_ENTRY;
          return (
            <section
              key={preset.id}
              data-testid={`lab-card-${preset.id}`}
              aria-label={`Preset ${preset.name}`}
              className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-900/60"
            >
              <header className="flex items-center justify-between gap-2 border-b border-zinc-800 px-3 py-2">
                <div>
                  <h3 className="text-xs font-semibold text-zinc-100">{preset.name}</h3>
                  <p className="text-[11px] text-zinc-400">{preset.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  {state.durationMs !== null ? (
                    <span className="rounded border border-zinc-800 bg-zinc-950 px-2 py-0.5 font-mono text-[11px] tabular-nums text-zinc-300">
                      {state.durationMs} ms
                    </span>
                  ) : null}
                  <button
                    type="button"
                    data-testid={`lab-export-${preset.id}`}
                    aria-label={`Baixar modelo ${preset.name} em formato STL binário`}
                    disabled={!state.mesh || state.loading}
                    onClick={() => {
                      if (!state.mesh) return;
                      try {
                        triggerBlobDownload(
                          exportStl(state.mesh),
                          sanitizeFilename(preset.name, 'stl'),
                        );
                      } catch (err) {
                        const msg = err instanceof Error ? err.message : 'Falha ao exportar STL.';
                        setEntries((prev) => ({
                          ...prev,
                          [preset.id]: { ...state, error: msg },
                        }));
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] font-medium text-zinc-200 transition-colors hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    <Download className="h-3 w-3" aria-hidden="true" />
                    <span>.STL</span>
                  </button>
                </div>
              </header>

              <div className="h-80 w-full">
                <Viewport3D
                  mesh={state.mesh}
                  loading={state.loading}
                  error={state.error}
                  showHelpers={false}
                />
              </div>
            </section>
          );
        })}
      </div>
    </main>
  );
}
