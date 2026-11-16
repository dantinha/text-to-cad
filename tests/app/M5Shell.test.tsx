// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as AiModule from '@/ai';
import type { GenError, GenOptions, IR, MeshData, Result } from '@/core';
import { err, ok } from '@/core/result';
import * as exportModule from '@/export';
import { PT_BR } from '@/i18n/pt-BR';
import { PRESETS } from '@/presets';
import { cubeDoc } from '../fixtures/ir';
import { unitCubeMesh } from '../fixtures/mesh';

const mockEvaluate = vi.fn();
const mockDispose = vi.fn();
const mockGenerateIR =
  vi.fn<(prompt: string, opts?: GenOptions) => Promise<Result<IR, GenError>>>();

vi.mock('@/kernel', () => ({
  createKernelClient: () => ({
    evaluate: mockEvaluate,
    dispose: mockDispose,
  }),
}));

vi.mock('@/viewer', () => ({
  Viewport3D: ({
    mesh,
    loading,
    error,
  }: {
    mesh: MeshData | null;
    loading?: boolean;
    error?: string | null;
  }) => (
    <div
      data-testid="mock-viewport"
      data-loading={String(Boolean(loading))}
      data-error={error ?? ''}
      data-tris={mesh ? String(mesh.triangleCount) : '0'}
    />
  ),
}));

vi.mock('@/ai', async () => {
  const actual = await vi.importActual<typeof AiModule>('@/ai');
  return {
    ...actual,
    generateIR: (prompt: string, opts?: GenOptions) => mockGenerateIR(prompt, opts),
  };
});

import { App } from '@/app/App';
import { HistoryPanel } from '@/app/HistoryPanel';
import { InspectorPanel } from '@/app/InspectorPanel';
import { LabPage } from '@/app/LabPage';
import { useCadStore } from '@/app/store';
import type { ModelSnapshot } from '@/app/history';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('Marco 5 (F8): Shell v1, Undo/Redo, Histórico, Abas Mobile e Cobertura', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    delete (window as { matchMedia?: unknown }).matchMedia;
    window.localStorage.clear();
    window.sessionStorage.clear();
    window.history.replaceState({}, '', '/');
    useCadStore.getState().resetWorkspace();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    mockEvaluate.mockReset();
    mockDispose.mockReset();
    mockGenerateIR.mockReset();
    mockEvaluate.mockResolvedValue(ok(unitCubeMesh(10)));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    window.localStorage.clear();
    window.sessionStorage.clear();
    vi.restoreAllMocks();
  });

  async function flushAsync(ms = 0) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it('suporta Desfazer e Refazer por clique e atalhos Ctrl+Z / Ctrl+Shift+Z, ignorando campos editáveis', async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const undoBtn = container.querySelector('[data-testid="undo-btn"]') as HTMLButtonElement;
    const redoBtn = container.querySelector('[data-testid="redo-btn"]') as HTMLButtonElement;
    expect(undoBtn.disabled).toBe(true);
    expect(redoBtn.disabled).toBe(true);

    // Seleciona Flange -> habilita Desfazer
    const flangeBtn = container.querySelector('[data-testid="preset-flange"]') as HTMLButtonElement;
    await act(async () => {
      flangeBtn.click();
    });
    await flushAsync();

    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(undoBtn.disabled).toBe(false);

    // Atalho dentro de <textarea> deve ser ignorado
    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    textarea.focus();
    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');

    // Move foco para fora e usa Ctrl+Z global -> desfaz para preset inicial
    textarea.blur();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    await flushAsync();

    const firstPresetBtn = container.querySelector(
      `[data-testid="preset-${PRESETS[0]?.id}"]`,
    ) as HTMLButtonElement;
    expect(firstPresetBtn.getAttribute('aria-pressed')).toBe('true');
    expect(redoBtn.disabled).toBe(false);

    // Ctrl+Shift+Z global -> refaz para Flange
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Z', ctrlKey: true, shiftKey: true }),
      );
    });
    await flushAsync();
    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');

    // Clique nos botões Desfazer / Refazer
    await act(async () => {
      undoBtn.click();
    });
    await flushAsync();
    expect(firstPresetBtn.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      redoBtn.click();
    });
    await flushAsync();
    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');

    // Ctrl+Y global após Ctrl+Z também refaz
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }));
    });
    await flushAsync();
    expect(firstPresetBtn.getAttribute('aria-pressed')).toBe('true');

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true }));
    });
    await flushAsync();
    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('alterna abas mobile com clique e teclado (ArrowRight/ArrowLeft/Home/End), foco e role="tabpanel"', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('1023px'),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const tabCreate = container.querySelector(
      '[data-testid="mobile-tab-create"]',
    ) as HTMLButtonElement;
    const tabView = container.querySelector('[data-testid="mobile-tab-view"]') as HTMLButtonElement;
    const tabInspect = container.querySelector(
      '[data-testid="mobile-tab-inspect"]',
    ) as HTMLButtonElement;

    const panelCreate = container.querySelector('#editor-panel-create') as HTMLElement;
    const panelView = container.querySelector('#editor-panel-view') as HTMLElement;
    const panelInspect = container.querySelector('#editor-panel-inspect') as HTMLElement;

    expect(tabCreate.getAttribute('aria-selected')).toBe('true');
    expect(tabCreate.tabIndex).toBe(0);
    expect(tabView.tabIndex).toBe(-1);
    expect(tabInspect.tabIndex).toBe(-1);
    expect(panelCreate.classList.contains('flex')).toBe(true);
    expect(panelCreate.classList.contains('hidden')).toBe(false);
    expect(panelView.classList.contains('hidden')).toBe(true);
    expect(panelInspect.classList.contains('lg:flex-none')).toBe(true);
    expect(panelCreate.getAttribute('role')).toBe('tabpanel');
    expect(panelCreate.getAttribute('aria-labelledby')).toBe('mobile-tab-create');

    // ArrowRight -> view + foco real + tabIndex atualizado
    tabCreate.focus();
    await act(async () => {
      tabCreate.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(tabView.getAttribute('aria-selected')).toBe('true');
    expect(tabView.tabIndex).toBe(0);
    expect(tabCreate.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(tabView);
    expect(panelView.classList.contains('flex')).toBe(true);
    expect(panelView.classList.contains('hidden')).toBe(false);
    expect(panelCreate.classList.contains('hidden')).toBe(true);

    // End -> inspect
    await act(async () => {
      tabView.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(tabInspect.getAttribute('aria-selected')).toBe('true');
    expect(tabInspect.tabIndex).toBe(0);
    expect(document.activeElement).toBe(tabInspect);
    expect(panelInspect.classList.contains('flex')).toBe(true);
    expect(panelInspect.getAttribute('role')).toBe('tabpanel');
    expect(panelInspect.getAttribute('aria-labelledby')).toBe('mobile-tab-inspect');

    // ArrowLeft -> view
    await act(async () => {
      tabInspect.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(tabView.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabView);

    // Home -> create
    await act(async () => {
      tabView.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(tabCreate.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tabCreate);

    // Clique direto na aba inspect
    await act(async () => {
      tabInspect.click();
    });
    expect(tabInspect.getAttribute('aria-selected')).toBe('true');
  });

  it('HistoryPanel exibe estado vazio, restaura item ao clicar e limpa histórico', async () => {
    const onRestore = vi.fn();
    const onClear = vi.fn();

    await act(async () => {
      root.render(<HistoryPanel items={[]} onRestore={onRestore} onClear={onClear} />);
    });

    const emptyEl = container.querySelector('[data-testid="history-empty"]');
    expect(emptyEl?.textContent).toBe(PT_BR.history.empty);
    const clearBtnEmpty = container.querySelector(
      '[data-testid="history-clear"]',
    ) as HTMLButtonElement;
    expect(clearBtnEmpty.disabled).toBe(true);

    const items: ModelSnapshot[] = [
      {
        id: 'h-1',
        source: 'ai',
        label: 'Suporte IA',
        promptOrPresetId: 'Suporte 60 mm',
        doc: cubeDoc(),
        createdAt: '2026-11-16T20:10:00.000Z',
      },
      {
        id: 'h-2',
        source: 'preset',
        label: 'Flange com furação',
        promptOrPresetId: 'flange',
        doc: cubeDoc(),
        createdAt: 'data-invalida',
      },
    ];

    await act(async () => {
      root.render(<HistoryPanel items={items} onRestore={onRestore} onClear={onClear} />);
    });

    expect(container.querySelectorAll('[data-testid="history-item"]')).toHaveLength(2);
    const firstBtn = container.querySelector('[data-testid="history-item-0"]') as HTMLButtonElement;
    expect(firstBtn.textContent).toContain('IA');
    expect(firstBtn.textContent).toContain('Suporte IA');

    const secondBtn = container.querySelector(
      '[data-testid="history-item-1"]',
    ) as HTMLButtonElement;
    expect(secondBtn.textContent).toContain('Preset');
    expect(secondBtn.textContent).toContain('--:--');

    await act(async () => {
      firstBtn.click();
    });
    expect(onRestore).toHaveBeenCalledWith(items[0]);

    const clearBtn = container.querySelector('[data-testid="history-clear"]') as HTMLButtonElement;
    expect(clearBtn.disabled).toBe(false);
    await act(async () => {
      clearBtn.click();
    });
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it('integra histórico no App ao trocar preset e limpar via history-clear', async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const flangeBtn = container.querySelector('[data-testid="preset-flange"]') as HTMLButtonElement;
    await act(async () => {
      flangeBtn.click();
    });
    await flushAsync();

    expect(
      container.querySelectorAll('[data-testid="history-item"]').length,
    ).toBeGreaterThanOrEqual(1);

    const clearBtn = container.querySelector('[data-testid="history-clear"]') as HTMLButtonElement;
    await act(async () => {
      clearBtn.click();
    });
    expect(container.querySelector('[data-testid="history-empty"]')).not.toBeNull();
  });

  it('InspectorPanel ignora cópia vazia, copia aba IR e ignora tecla não mapeada', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    await act(async () => {
      root.render(
        <InspectorPanel
          modelName="Vazio"
          modelSubtitle="sem código"
          doc={null}
          mesh={null}
          loading={false}
          scadCode=""
          irJson='{"schemaVersion":1}'
        />,
      );
    });

    const copyBtn = container.querySelector('[data-testid="copy-code"]') as HTMLButtonElement;
    await act(async () => {
      copyBtn.click();
    });
    expect(writeTextMock).not.toHaveBeenCalled();

    const scadTab = container.querySelector('[data-testid="tab-scad"]') as HTMLButtonElement;
    const irTab = container.querySelector('[data-testid="tab-ir"]') as HTMLButtonElement;
    await act(async () => {
      scadTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      irTab.click();
    });
    expect(irTab.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      copyBtn.click();
    });
    expect(writeTextMock).toHaveBeenCalledWith('{"schemaVersion":1}');
  });

  it('InspectorPanel copia código e trata falhas de clipboard e exportação', async () => {
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    });

    await act(async () => {
      root.render(
        <InspectorPanel
          modelName="Cubo"
          modelSubtitle="10x10x10 mm"
          doc={cubeDoc()}
          mesh={unitCubeMesh(10)}
          loading={false}
          scadCode="cube([10, 10, 10]);"
          irJson='{"schemaVersion":1}'
        />,
      );
    });

    const copyBtn = container.querySelector('[data-testid="copy-code"]') as HTMLButtonElement;
    await act(async () => {
      copyBtn.click();
    });
    expect(writeTextMock).toHaveBeenCalledWith('cube([10, 10, 10]);');
    expect(copyBtn.textContent).toContain(PT_BR.inspector.copied);

    // Após 1800ms volta para Copiar
    await flushAsync(1800);
    expect(copyBtn.textContent).toContain(PT_BR.inspector.copy);

    // Falha no clipboard não quebra
    writeTextMock.mockRejectedValueOnce(new Error('Sem permissão'));
    await act(async () => {
      copyBtn.click();
    });
    expect(copyBtn.textContent).toContain(PT_BR.inspector.copy);

    // Falha ao exportar STL / SCAD / JSON mostra role="alert" em export-status
    vi.spyOn(exportModule, 'triggerBlobDownload').mockImplementation(() => {
      throw new Error('Falha simulada de download');
    });

    const status = container.querySelector('[data-testid="export-status"]');
    const stlBtn = container.querySelector('[data-testid="export-stl"]') as HTMLButtonElement;
    await act(async () => {
      stlBtn.click();
    });
    expect(status?.getAttribute('role')).toBe('alert');
    expect(status?.textContent).toContain('Falha simulada de download');

    const scadBtn = container.querySelector('[data-testid="export-scad"]') as HTMLButtonElement;
    await act(async () => {
      scadBtn.click();
    });
    expect(status?.getAttribute('role')).toBe('alert');

    const jsonBtn = container.querySelector('[data-testid="export-json"]') as HTMLButtonElement;
    await act(async () => {
      jsonBtn.click();
    });
    expect(status?.getAttribute('role')).toBe('alert');

    await flushAsync(2500);
    expect(status?.textContent).toBe('');
  });

  it('LabPage exibe erro de avaliação e falha de exportação STL por cartão', async () => {
    mockEvaluate
      .mockResolvedValueOnce(err({ code: 'wasm_error', message: 'Erro simulado no kernel' }))
      .mockResolvedValue(ok(unitCubeMesh(10)));

    vi.spyOn(exportModule, 'triggerBlobDownload').mockImplementation(() => {
      throw new Error('Erro de exportação no Lab');
    });

    await act(async () => {
      root.render(<LabPage />);
    });
    await flushAsync();

    const firstId = PRESETS[0]?.id;
    const secondId = PRESETS[1]?.id;
    if (!firstId || !secondId) throw new Error('PRESETS insuficientes');

    const firstVp = container.querySelector(
      `[data-testid="lab-card-${firstId}"] [data-testid="mock-viewport"]`,
    );
    expect(firstVp?.getAttribute('data-error')).toBe('Erro simulado no kernel');

    const secondExportBtn = container.querySelector(
      `[data-testid="lab-export-${secondId}"]`,
    ) as HTMLButtonElement;
    expect(secondExportBtn.disabled).toBe(false);

    await act(async () => {
      secondExportBtn.click();
    });
    const secondVp = container.querySelector(
      `[data-testid="lab-card-${secondId}"] [data-testid="mock-viewport"]`,
    );
    expect(secondVp?.getAttribute('data-error')).toBe('Erro de exportação no Lab');
    expect(container.querySelector('#editor-main')?.getAttribute('tabindex')).toBe('-1');
  });

  it('permite Ctrl+Z com slider focado, bloqueia em input password, grava histórico pós-debounce e restaura ao clicar', async () => {
    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    // Skip link aponta para #editor-main focável (tabIndex=-1)
    const skipLink = container.querySelector('a[href="#editor-main"]') as HTMLAnchorElement;
    const editorMain = container.querySelector('#editor-main') as HTMLElement;
    expect(skipLink).not.toBeNull();
    expect(editorMain.getAttribute('tabindex')).toBe('-1');

    // Ajusta slider -> debounce 120ms -> avalia e registra histórico
    const slider = container.querySelector(
      '[data-testid="param-slider-largura"]',
    ) as HTMLInputElement;
    const initialValue = slider.value;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    await act(async () => {
      descriptor?.set?.call(slider, '95');
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await flushAsync(120);

    expect(slider.value).toBe('95');
    expect(
      container.querySelectorAll('[data-testid="history-item"]').length,
    ).toBeGreaterThanOrEqual(1);

    // Ctrl+Z com slider (type="range") focado DEVE desfazer!
    slider.focus();
    await act(async () => {
      slider.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }),
      );
    });
    await flushAsync();
    expect(slider.value).toBe(initialValue);

    // Ctrl+Z com input BYOK (type="password") focado NÃO deve refazer/desfazer
    const byokToggle = container.querySelector(
      '[data-testid="ai-byok-toggle"]',
    ) as HTMLButtonElement;
    await act(async () => {
      byokToggle.click();
    });
    const byokInput = container.querySelector('[data-testid="ai-byok-input"]') as HTMLInputElement;
    byokInput.focus();
    await act(async () => {
      byokInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true }),
      );
    });
    expect(slider.value).toBe(initialValue);

    // Restaura item do histórico clicando em history-item-0
    const firstHistoryBtn = container.querySelector(
      '[data-testid="history-item-0"]',
    ) as HTMLButtonElement;
    expect(firstHistoryBtn).not.toBeNull();
    await act(async () => {
      firstHistoryBtn.click();
    });
    await flushAsync();
    expect(slider.value).toBe('95');
  });

  it('trata exceção inesperada em generateIR no try/catch sem travar aiGenerating', async () => {
    mockGenerateIR.mockRejectedValueOnce(new Error('Falha inesperada de rede'));

    await act(async () => {
      root.render(<App />);
    });
    await flushAsync();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
    await act(async () => {
      descriptor?.set?.call(textarea, 'Suporte com erro inesperado');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });
    await flushAsync();

    expect(generateBtn.disabled).toBe(false);
    expect(container.querySelector('[data-testid="ai-cancel-btn"]')).toBeNull();
    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('alert');
    expect(feedback?.textContent).toContain('Falha inesperada de rede');
  });
});
