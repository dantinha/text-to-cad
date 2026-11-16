import { Check, Code2, Copy, Download, FileCode, FileJson } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import type { IRDocument, MeshData } from '@/core';
import {
  exportIrJsonBlob,
  exportScadBlob,
  exportStl,
  sanitizeFilename,
  triggerBlobDownload,
} from '@/export';
import { PT_BR } from '@/i18n/pt-BR';

export type InspectorTab = 'scad' | 'ir';

export interface InspectorPanelProps {
  readonly id?: string;
  readonly className?: string;
  readonly role?: 'tabpanel';
  readonly ariaLabelledBy?: string;
  readonly modelName: string;
  readonly modelSubtitle: string;
  readonly doc: IRDocument | null;
  readonly mesh: MeshData | null;
  readonly loading: boolean;
  readonly scadCode: string;
  readonly irJson: string;
}

interface ExportFeedback {
  readonly message: string;
  readonly isError: boolean;
}

const INSPECTOR_TABS: readonly { readonly id: InspectorTab; readonly label: string }[] = [
  { id: 'scad', label: PT_BR.inspector.tabScad },
  { id: 'ir', label: PT_BR.inspector.tabIr },
];

/**
 * Painel direito: exportação (.stl, .scad, .json) e inspetor de código com abas WAI-ARIA.
 */
export function InspectorPanel({
  id,
  className = 'flex h-full',
  role,
  ariaLabelledBy,
  modelName,
  modelSubtitle,
  doc,
  mesh,
  loading,
  scadCode,
  irJson,
}: InspectorPanelProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>('scad');
  const [copied, setCopied] = useState<boolean>(false);
  const [exportFeedback, setExportFeedback] = useState<ExportFeedback>({
    message: '',
    isError: false,
  });

  const mountedRef = useRef(true);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tabRefs = useRef<Record<InspectorTab, HTMLButtonElement | null>>({
    scad: null,
    ir: null,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      if (exportTimerRef.current !== null) clearTimeout(exportTimerRef.current);
    };
  }, []);

  const announceExport = (message: string, isError = false) => {
    setExportFeedback({ message, isError });
    if (exportTimerRef.current !== null) clearTimeout(exportTimerRef.current);
    exportTimerRef.current = setTimeout(() => {
      if (mountedRef.current) {
        setExportFeedback({ message: '', isError: false });
      }
    }, 2500);
  };

  const handleExportStl = () => {
    if (!mesh || loading) return;
    try {
      const filename = sanitizeFilename(modelName, 'stl');
      triggerBlobDownload(exportStl(mesh), filename);
      announceExport(`Arquivo ${filename} exportado.`);
    } catch (err) {
      announceExport(err instanceof Error ? err.message : 'Falha ao exportar STL.', true);
    }
  };

  const handleExportScad = () => {
    if (!doc) return;
    try {
      const filename = sanitizeFilename(modelName, 'scad');
      triggerBlobDownload(exportScadBlob(doc), filename);
      announceExport(`Arquivo ${filename} exportado.`);
    } catch (err) {
      announceExport(err instanceof Error ? err.message : 'Falha ao exportar OpenSCAD.', true);
    }
  };

  const handleExportJson = () => {
    if (!doc) return;
    try {
      const filename = sanitizeFilename(modelName, 'json');
      triggerBlobDownload(exportIrJsonBlob(doc), filename);
      announceExport(`Arquivo ${filename} exportado.`);
    } catch (err) {
      announceExport(err instanceof Error ? err.message : 'Falha ao exportar JSON.', true);
    }
  };

  const handleCopy = async () => {
    const text = activeTab === 'scad' ? scadCode : irJson;
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      if (!mountedRef.current) return;
      setCopied(true);
      if (copyTimerRef.current !== null) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 1800);
    } catch {
      if (mountedRef.current) setCopied(false);
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
    <aside
      id={id}
      role={role}
      aria-labelledby={ariaLabelledBy}
      aria-label={role ? undefined : 'Exportação e inspetor de código CAD'}
      className={`w-full shrink-0 flex-col border-t border-zinc-800 bg-zinc-900/50 lg:flex lg:h-auto lg:w-[380px] lg:flex-none lg:border-t-0 lg:border-l xl:w-[420px] ${className}`}
    >
      {/* Barra de exportação */}
      <div className="border-b border-zinc-800 px-3 py-2.5">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
            {PT_BR.inspector.exportTitle}
          </span>
          <span
            data-testid="export-status"
            role={exportFeedback.isError ? 'alert' : 'status'}
            aria-live={exportFeedback.isError ? 'assertive' : 'polite'}
            className={`truncate text-[11px] ${
              exportFeedback.isError ? 'text-red-400' : 'text-emerald-400'
            }`}
          >
            {exportFeedback.message}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            data-testid="export-stl"
            disabled={!mesh || loading}
            aria-label={PT_BR.inspector.downloadStlAria}
            onClick={handleExportStl}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-400 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{PT_BR.inspector.downloadStl}</span>
          </button>

          <button
            type="button"
            data-testid="export-scad"
            disabled={!doc}
            aria-label="Baixar código OpenSCAD (.scad)"
            onClick={handleExportScad}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileCode className="h-3.5 w-3.5" aria-hidden="true" />
            <span>.SCAD</span>
          </button>

          <button
            type="button"
            data-testid="export-json"
            disabled={!doc}
            aria-label="Baixar árvore IR em JSON"
            onClick={handleExportJson}
            className="inline-flex items-center gap-1 rounded border border-zinc-800 bg-zinc-900 px-2.5 py-1.5 text-xs font-medium text-zinc-200 transition-colors hover:bg-zinc-800 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <FileJson className="h-3.5 w-3.5" aria-hidden="true" />
            <span>.JSON</span>
          </button>
        </div>
      </div>

      {/* Cabeçalho das abas de código */}
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
        <div role="tablist" aria-label={PT_BR.inspector.tabsAriaLabel} className="flex gap-1">
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
              <span>{PT_BR.inspector.copied}</span>
            </>
          ) : (
            <>
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{PT_BR.inspector.copy}</span>
            </>
          )}
        </button>
        <span className="sr-only" aria-live="polite">
          {copied ? 'Código copiado para a área de transferência.' : ''}
        </span>
      </div>

      <div className="border-b border-zinc-800/80 bg-zinc-950/40 px-3 py-1.5 text-[11px] text-zinc-400">
        <span className="font-medium text-zinc-300">{modelName}</span>
        {' · '}
        <span className="font-mono">{modelSubtitle}</span>
      </div>

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
  );
}
