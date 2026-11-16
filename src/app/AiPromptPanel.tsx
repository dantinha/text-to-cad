import { ChevronDown, ChevronRight, Cpu, KeyRound, Loader2, Send, X } from 'lucide-react';
import { type FormEvent, type KeyboardEvent, useId, useState } from 'react';
import { clearByokKey, getByokKey, MAX_PROMPT_LENGTH, setByokKey } from '@/ai';
import { PT_BR } from '@/i18n/pt-BR';

export interface AiPromptFeedback {
  readonly status: 'idle' | 'loading' | 'success' | 'error';
  readonly message: string;
}

export interface AiPromptPanelProps {
  readonly generating: boolean;
  readonly feedback: AiPromptFeedback;
  readonly onGenerate: (prompt: string) => void;
  readonly onCancel: () => void;
}

const PROMPT_SUGGESTIONS: readonly string[] = ['Cubo 40 mm com furo Ø16', 'Flange Ø110 mm 6 furos'];

/**
 * Painel compacto de geração de modelos 3D via IA (Gemini) com suporte BYOK em sessionStorage.
 */
export function AiPromptPanel({ generating, feedback, onGenerate, onCancel }: AiPromptPanelProps) {
  const [prompt, setPrompt] = useState<string>('');
  const [byokOpen, setByokOpen] = useState<boolean>(false);
  const [byokValue, setByokValue] = useState<string>(() => getByokKey());

  const promptId = useId();
  const byokRegionId = useId();
  const byokInputId = useId();

  const canSubmit = prompt.trim().length > 0 && !generating;

  const submitPrompt = () => {
    const trimmed = prompt.trim();
    if (!trimmed || generating) return;
    onGenerate(trimmed);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitPrompt();
  };

  const handleTextareaKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      submitPrompt();
    }
  };

  const handleByokChange = (nextKey: string) => {
    setByokValue(nextKey);
    setByokKey(nextKey);
  };

  const handleClearByok = () => {
    setByokValue('');
    clearByokKey();
  };

  const isError = feedback.status === 'error';

  return (
    <section
      aria-label="Geração de modelo por IA"
      className="shrink-0 border-b border-zinc-800 bg-zinc-950/60 p-3"
    >
      <form onSubmit={handleSubmit} className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label
            htmlFor={promptId}
            className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-zinc-300"
          >
            <Cpu className="h-3.5 w-3.5 text-indigo-400" aria-hidden="true" />
            <span>{PT_BR.ai.sectionTitle}</span>
          </label>
          <span className="font-mono text-[10px] tabular-nums text-zinc-400">
            {PT_BR.ai.shortcutHint} · {prompt.length}/{MAX_PROMPT_LENGTH}
          </span>
        </div>

        <textarea
          id={promptId}
          data-testid="ai-prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          maxLength={MAX_PROMPT_LENGTH}
          rows={2}
          aria-keyshortcuts="Control+Enter Meta+Enter"
          placeholder={PT_BR.ai.placeholder}
          className="w-full resize-none rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs leading-relaxed text-zinc-100 placeholder:text-zinc-400 focus:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        />

        {/* Chips curtos de sugestão */}
        <div className="flex flex-wrap items-center gap-1">
          {PROMPT_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={generating}
              aria-label={`Usar sugestão: ${suggestion}`}
              onClick={() => setPrompt(suggestion)}
              className="rounded border border-zinc-800 bg-zinc-900 px-2 py-0.5 text-[11px] text-zinc-300 transition-colors hover:border-zinc-700 hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {suggestion}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="submit"
            data-testid="ai-generate-btn"
            disabled={!canSubmit}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            {generating ? (
              <Loader2
                className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span>{generating ? 'Gerando...' : PT_BR.ai.generate}</span>
          </button>

          {generating ? (
            <button
              type="button"
              data-testid="ai-cancel-btn"
              onClick={onCancel}
              aria-label="Cancelar geração em andamento"
              className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{PT_BR.ai.cancel}</span>
            </button>
          ) : null}
        </div>
      </form>

      {/* Seção colapsável BYOK */}
      <div className="mt-2.5 border-t border-zinc-800/80 pt-2">
        <button
          type="button"
          data-testid="ai-byok-toggle"
          aria-expanded={byokOpen}
          aria-controls={byokRegionId}
          onClick={() => setByokOpen((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 rounded py-0.5 text-left text-[11px] font-medium text-zinc-300 transition-colors hover:text-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
        >
          <span className="inline-flex items-center gap-1.5">
            <KeyRound className="h-3 w-3 text-zinc-400" aria-hidden="true" />
            <span>{PT_BR.ai.byokToggle}</span>
            {byokValue.trim().length > 0 ? (
              <span className="rounded bg-indigo-600/20 px-1 py-0.5 font-mono text-[10px] text-indigo-300">
                {PT_BR.ai.byokActive}
              </span>
            ) : null}
          </span>
          {byokOpen ? (
            <ChevronDown className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden="true" />
          )}
        </button>

        {byokOpen ? (
          <div id={byokRegionId} className="mt-2 space-y-1.5">
            <label htmlFor={byokInputId} className="block text-[11px] text-zinc-400">
              {PT_BR.ai.byokLabel}
            </label>
            <div className="flex items-center gap-1.5">
              <input
                id={byokInputId}
                type="password"
                data-testid="ai-byok-input"
                autoComplete="off"
                value={byokValue}
                onChange={(e) => handleByokChange(e.target.value)}
                placeholder="AIza..."
                className="min-w-0 flex-1 rounded border border-zinc-800 bg-zinc-900 px-2 py-1 font-mono text-xs text-zinc-100 placeholder:text-zinc-400 focus:border-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500"
              />
              <button
                type="button"
                data-testid="ai-byok-clear"
                aria-label={PT_BR.ai.byokClearAria}
                disabled={byokValue.length === 0}
                onClick={handleClearByok}
                className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {PT_BR.ai.byokClear}
              </button>
            </div>
            <p className="text-[10px] leading-snug text-zinc-400">{PT_BR.ai.byokPrivacyNote}</p>
          </div>
        ) : null}
      </div>

      {/* Área de feedback sempre montada com aria-live */}
      <div
        data-testid="ai-feedback"
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        aria-atomic="true"
        className={`mt-2 min-h-[1rem] text-[11px] leading-snug ${
          isError
            ? 'rounded border border-red-900/60 bg-red-950/30 px-2 py-1.5 text-red-300'
            : feedback.status === 'success'
              ? 'text-emerald-400'
              : feedback.status === 'loading'
                ? 'text-indigo-300'
                : 'text-zinc-400'
        }`}
      >
        {feedback.status === 'loading'
          ? PT_BR.ai.loadingMessage
          : feedback.status === 'success'
            ? PT_BR.ai.successMessage
            : isError
              ? `${feedback.message} ${PT_BR.ai.errorTip}`
              : feedback.message}
      </div>
    </section>
  );
}
