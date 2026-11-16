import { RotateCcw, SlidersHorizontal } from 'lucide-react';
import type { ParamValues, PresetDefinition } from '@/presets';

export interface ParamPanelProps {
  readonly presets: readonly PresetDefinition[];
  readonly selectedPreset: PresetDefinition;
  readonly params: ParamValues;
  readonly isAiActive?: boolean;
  readonly onSelectPreset: (presetId: string) => void;
  readonly onChangeParam: (key: string, value: number) => void;
  readonly onResetParams: () => void;
}

const VALUE_FORMATTER = new Intl.NumberFormat('pt-BR', {
  maximumFractionDigits: 2,
});

function formatParamValue(value: number, unit: 'mm' | 'un'): string {
  const formatted = VALUE_FORMATTER.format(value);
  return unit === 'mm' ? `${formatted} mm` : formatted;
}

/**
 * Painel esquerdo (M3/M4): seleção dos 4 presets e sliders paramétricos em mm/un.
 */
export function ParamPanel({
  presets,
  selectedPreset,
  params,
  isAiActive = false,
  onSelectPreset,
  onChangeParam,
  onResetParams,
}: ParamPanelProps) {
  return (
    <section aria-label="Presets e parâmetros do modelo" className="flex shrink-0 flex-col">
      {/* Lista de presets */}
      <div className="border-b border-zinc-800 p-3">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          Modelos Paramétricos
        </p>
        <div
          role="group"
          aria-label="Selecionar modelo paramétrico"
          className="grid grid-cols-2 gap-1.5 lg:grid-cols-1"
        >
          {presets.map((preset) => {
            const active = !isAiActive && preset.id === selectedPreset.id;
            return (
              <button
                key={preset.id}
                type="button"
                aria-pressed={active}
                data-testid={`preset-${preset.id}`}
                onClick={() => onSelectPreset(preset.id)}
                className={`flex flex-col rounded border px-2.5 py-2 text-left transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                  active
                    ? 'border-indigo-500/60 bg-indigo-600/15 text-zinc-100'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-300 hover:border-zinc-700 hover:bg-zinc-800/80'
                }`}
              >
                <span className="text-xs font-medium">{preset.name}</span>
                <span className="mt-0.5 line-clamp-1 text-[11px] text-zinc-400">
                  {preset.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Sliders paramétricos */}
      <div className="flex flex-col p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Parâmetros</span>
          </div>

          {!isAiActive ? (
            <button
              type="button"
              data-testid="reset-params"
              aria-label="Restaurar parâmetros padrão"
              onClick={onResetParams}
              className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              <span>Padrão</span>
            </button>
          ) : null}
        </div>

        {isAiActive ? (
          <p className="rounded border border-zinc-800 bg-zinc-900/70 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400">
            Modelo gerado por IA ativo. Selecione um preset acima para ajustar parâmetros manuais.
          </p>
        ) : (
          <div className="space-y-3">
            {selectedPreset.parameters.map((spec) => {
              const current = params[spec.key] ?? spec.defaultValue;
              const formattedCurrent = formatParamValue(current, spec.unit);
              const inputId = `param-${selectedPreset.id}-${spec.key}`;
              return (
                <div key={spec.key} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <label htmlFor={inputId} className="text-xs text-zinc-300">
                      {spec.label}
                    </label>
                    <span
                      data-testid={`param-value-${spec.key}`}
                      className="font-mono text-xs font-medium tabular-nums text-indigo-300"
                    >
                      {formattedCurrent}
                    </span>
                  </div>
                  <input
                    id={inputId}
                    type="range"
                    data-testid={`param-slider-${spec.key}`}
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={current}
                    aria-label={`${spec.label} (${spec.unit})`}
                    aria-valuetext={formattedCurrent}
                    onChange={(e) => onChangeParam(spec.key, Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-zinc-800 accent-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
                  />
                  <div className="flex justify-between font-mono text-[10px] tabular-nums text-zinc-400">
                    <span>{formatParamValue(spec.min, spec.unit)}</span>
                    <span>{formatParamValue(spec.max, spec.unit)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );
}
