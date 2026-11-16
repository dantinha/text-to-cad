import { History, Trash2 } from 'lucide-react';
import { PT_BR } from '@/i18n/pt-BR';
import { MAX_HISTORY_ITEMS, type ModelSnapshot } from './history';

export interface HistoryPanelProps {
  readonly items: readonly ModelSnapshot[];
  readonly onRestore: (item: ModelSnapshot) => void;
  readonly onClear: () => void;
}

const TIME_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  hour: '2-digit',
  minute: '2-digit',
});

function formatShortTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  return TIME_FORMATTER.format(date);
}

/**
 * Painel de histórico local (até 20 modelos) com restauração rápida e limpeza.
 */
export function HistoryPanel({ items, onRestore, onClear }: HistoryPanelProps) {
  return (
    <section
      aria-label={PT_BR.history.title}
      className="shrink-0 border-t border-zinc-800 bg-zinc-950/40 p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          <History className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            {PT_BR.history.title} ({items.length}/{MAX_HISTORY_ITEMS})
          </span>
        </div>

        <button
          type="button"
          data-testid="history-clear"
          aria-label={PT_BR.history.clearAria}
          disabled={items.length === 0}
          onClick={onClear}
          className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
        >
          <Trash2 className="h-3 w-3" aria-hidden="true" />
          <span>{PT_BR.history.clear}</span>
        </button>
      </div>

      {items.length === 0 ? (
        <p
          data-testid="history-empty"
          className="rounded border border-zinc-800/80 bg-zinc-900/50 px-2.5 py-2 text-[11px] leading-relaxed text-zinc-400"
        >
          {PT_BR.history.empty}
        </p>
      ) : (
        <ul className="max-h-48 space-y-1 overflow-y-auto pr-0.5">
          {items.map((item, index) => (
            <li key={item.id}>
              <button
                type="button"
                data-testid={`history-item-${index}`}
                aria-label={`${PT_BR.history.restorePrefix}: ${item.label}`}
                onClick={() => onRestore(item)}
                className="w-full rounded border border-zinc-800 bg-zinc-900/80 px-2 py-1.5 text-left transition-colors hover:border-zinc-700 hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
              >
                <span
                  data-testid="history-item"
                  className="flex w-full items-center justify-between gap-2"
                >
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={`shrink-0 rounded border px-1 py-0.5 font-mono text-[10px] leading-none ${
                        item.source === 'ai'
                          ? 'border-indigo-500/40 bg-indigo-600/20 text-indigo-300'
                          : 'border-zinc-700 bg-zinc-800 text-zinc-300'
                      }`}
                    >
                      {item.source === 'ai' ? PT_BR.history.badgeAi : PT_BR.history.badgePreset}
                    </span>
                    <span className="truncate text-xs text-zinc-200">{item.label}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-400">
                    {formatShortTime(item.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
