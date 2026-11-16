// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenError, GenOptions, IR, MeshData, Result } from '@/core';
import { err, ok } from '@/core/result';
import type * as AiModule from '@/ai';
import { BYOK_SESSION_KEY } from '@/ai/byok';
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
import { useCadStore } from '@/app/store';
import { PT_BR } from '@/i18n/pt-BR';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function setControlValue(el: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const proto = Object.getPrototypeOf(el) as { value?: string };
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  descriptor?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('Integração M4: AiPromptPanel e modo IA no App', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    window.localStorage.clear();
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
    window.sessionStorage.clear();
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  async function flushMicrotasks() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }

  it('gera modelo com sucesso via generateIR, avalia no KernelClient e habilita exportação', async () => {
    const aiDoc: IR = {
      ...cubeDoc(),
      name: 'Suporte IA',
    };
    mockGenerateIR.mockResolvedValueOnce(ok(aiDoc));

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const statusBadge = container.querySelector('[data-testid="app-status"]');
    expect(statusBadge?.textContent).toBe(PT_BR.app.statusBadge);

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();

    await act(async () => {
      setControlValue(textarea, 'Cubo técnico 40x40x40 mm');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    expect(generateBtn.disabled).toBe(false);

    mockEvaluate.mockClear();
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    expect(mockGenerateIR).toHaveBeenCalledWith('Cubo técnico 40x40x40 mm', {
      signal: expect.any(AbortSignal),
      userKey: undefined,
    });
    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    expect(mockEvaluate).toHaveBeenCalledWith(aiDoc, expect.any(AbortSignal));

    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('Modelo gerado pela IA e validado.');

    const inspector = container.querySelector('[data-testid="inspector-code"]');
    expect(inspector?.textContent).toContain('cube(');

    const exportStlBtn = container.querySelector('[data-testid="export-stl"]') as HTMLButtonElement;
    const exportScadBtn = container.querySelector(
      '[data-testid="export-scad"]',
    ) as HTMLButtonElement;
    const exportJsonBtn = container.querySelector(
      '[data-testid="export-json"]',
    ) as HTMLButtonElement;
    expect(exportStlBtn.disabled).toBe(false);
    expect(exportScadBtn.disabled).toBe(false);
    expect(exportJsonBtn.disabled).toBe(false);
  });

  it('exibe erro com role="alert" em ai-feedback quando generateIR falha (repair_failed / rate_limited)', async () => {
    mockGenerateIR.mockResolvedValueOnce(
      err({
        code: 'repair_failed',
        message: 'Não foi possível gerar um modelo 3D válido após as tentativas de correção.',
      }),
    );

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Peça impossível');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('alert');
    expect(feedback?.textContent).toContain('Não foi possível gerar um modelo 3D válido');
    expect(feedback?.textContent).toContain('Simplifique o prompt ou escolha um preset abaixo.');

    mockGenerateIR.mockResolvedValueOnce(
      err({
        code: 'rate_limited',
        message: 'Limite de requisições atingido.',
      }),
    );
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    expect(feedback?.getAttribute('role')).toBe('alert');
    expect(feedback?.textContent).toContain('Limite de requisições atingido.');
  });

  it('aborta AbortSignal passado a generateIR ao clicar em ai-cancel-btn', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolvePending: ((value: Result<IR, GenError>) => void) | undefined;

    mockGenerateIR.mockImplementation((_prompt, opts) => {
      capturedSignal = opts?.signal;
      return new Promise((resolve) => {
        resolvePending = resolve;
      });
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Suporte em L 80x40 mm');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });

    expect(capturedSignal).toBeDefined();
    expect(capturedSignal?.aborted).toBe(false);

    const cancelBtn = container.querySelector('[data-testid="ai-cancel-btn"]') as HTMLButtonElement;
    expect(cancelBtn).not.toBeNull();
    expect(generateBtn.disabled).toBe(true);

    await act(async () => {
      cancelBtn.click();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(container.querySelector('[data-testid="ai-cancel-btn"]')).toBeNull();
    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(feedback?.textContent).toContain('Geração cancelada.');

    await act(async () => {
      resolvePending?.(err({ code: 'cancelled', message: 'Geração cancelada pelo usuário.' }));
    });
    await flushMicrotasks();
  });

  it('gerencia BYOK exclusivamente em sessionStorage, envia userKey e nunca grava em localStorage', async () => {
    mockGenerateIR.mockResolvedValueOnce(ok({ ...cubeDoc(), name: 'Cubo BYOK' }));

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const toggleBtn = container.querySelector(
      '[data-testid="ai-byok-toggle"]',
    ) as HTMLButtonElement;
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('[data-testid="ai-byok-input"]')).toBeNull();

    await act(async () => {
      toggleBtn.click();
    });
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');

    const byokInput = container.querySelector('[data-testid="ai-byok-input"]') as HTMLInputElement;
    expect(byokInput).not.toBeNull();
    expect(byokInput.type).toBe('password');
    expect(byokInput.getAttribute('autocomplete')).toBe('off');

    await act(async () => {
      setControlValue(byokInput, 'AIza-chave-teste-sessao');
    });

    expect(window.sessionStorage.getItem(BYOK_SESSION_KEY)).toBe('AIza-chave-teste-sessao');
    expect(window.localStorage.length).toBe(0);

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Cubo 20 mm');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    expect(mockGenerateIR).toHaveBeenCalledWith('Cubo 20 mm', {
      signal: expect.any(AbortSignal),
      userKey: 'AIza-chave-teste-sessao',
    });
    expect(window.localStorage.getItem(BYOK_SESSION_KEY)).toBeNull();
    expect(window.localStorage.getItem('text-to-cad:history:v1') ?? '').not.toContain(
      'AIza-chave-teste-sessao',
    );

    const clearBtn = container.querySelector('[data-testid="ai-byok-clear"]') as HTMLButtonElement;
    await act(async () => {
      clearBtn.click();
    });

    expect(byokInput.value).toBe('');
    expect(window.sessionStorage.getItem(BYOK_SESSION_KEY)).toBeNull();
  });

  it('alterna do modo IA de volta para preset ao clicar em preset-flange', async () => {
    mockGenerateIR.mockResolvedValueOnce(ok({ ...cubeDoc(), name: 'Modelo IA Personalizado' }));

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Cubo 15 mm');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    for (const preset of PRESETS) {
      const btn = container.querySelector(`[data-testid="preset-${preset.id}"]`);
      expect(btn?.getAttribute('aria-pressed')).toBe('false');
    }

    mockEvaluate.mockClear();
    const flangeBtn = container.querySelector('[data-testid="preset-flange"]') as HTMLButtonElement;
    await act(async () => {
      flangeBtn.click();
    });
    await flushMicrotasks();

    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('[data-testid="param-slider-diametroExterno"]')).not.toBeNull();
    expect(mockEvaluate).toHaveBeenCalledTimes(1);

    const inspector = container.querySelector('[data-testid="inspector-code"]');
    expect(inspector?.textContent).toContain('Flange com furação');
  });

  it('preenche prompt pelo chip de sugestão e envia via Ctrl+Enter', async () => {
    const aiDoc: IR = { ...cubeDoc(), name: 'Cubo Chip' };
    mockGenerateIR.mockResolvedValueOnce(ok(aiDoc));

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const chip = container.querySelector(
      'button[aria-label="Usar sugestão: Cubo 40 mm com furo Ø16"]',
    ) as HTMLButtonElement;
    expect(chip).not.toBeNull();

    await act(async () => {
      chip.click();
    });

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Cubo 40 mm com furo Ø16');

    await act(async () => {
      textarea.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }),
      );
    });
    await flushMicrotasks();

    expect(mockGenerateIR).toHaveBeenCalledWith('Cubo 40 mm com furo Ø16', {
      signal: expect.any(AbortSignal),
      userKey: undefined,
    });
  });

  it('exibe erro em ai-feedback se generateIR retornar IR que falha em validateIR', async () => {
    const invalidDoc = {
      schemaVersion: 1,
      units: 'mm',
      root: { id: 'bad', type: 'cube', size: [-5, 10, 10] },
    } as unknown as IR;
    mockGenerateIR.mockResolvedValueOnce(ok(invalidDoc));

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    mockEvaluate.mockClear();
    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Cubo inválido');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });
    await flushMicrotasks();

    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.getAttribute('role')).toBe('alert');
    expect(feedback?.textContent).toContain('root.size[0]');
    expect(mockEvaluate).not.toHaveBeenCalled();
  });

  it('aborta geração em andamento e limpa ai-feedback ao clicar em preset', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGenerateIR.mockImplementation((_prompt, opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {});
    });

    await act(async () => {
      root.render(<App />);
    });
    await flushMicrotasks();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Peça em andamento');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });

    const feedback = container.querySelector('[data-testid="ai-feedback"]');
    expect(feedback?.textContent).toContain('Gerando e validando geometria via Gemini...');

    const flangeBtn = container.querySelector('[data-testid="preset-flange"]') as HTMLButtonElement;
    await act(async () => {
      flangeBtn.click();
    });
    await flushMicrotasks();

    expect(capturedSignal?.aborted).toBe(true);
    expect(feedback?.textContent).toBe('');
    expect(feedback?.getAttribute('role')).toBe('status');
    expect(flangeBtn.getAttribute('aria-pressed')).toBe('true');
  });

  it('aborta requisição IA pendente ao desmontar em StrictMode', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockGenerateIR.mockImplementation((_prompt, opts) => {
      capturedSignal = opts?.signal;
      return new Promise(() => {});
    });

    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await flushMicrotasks();

    const textarea = container.querySelector(
      '[data-testid="ai-prompt-input"]',
    ) as HTMLTextAreaElement;
    await act(async () => {
      setControlValue(textarea, 'Teste StrictMode');
    });

    const generateBtn = container.querySelector(
      '[data-testid="ai-generate-btn"]',
    ) as HTMLButtonElement;
    await act(async () => {
      generateBtn.click();
    });

    expect(capturedSignal?.aborted).toBe(false);

    await act(async () => {
      root.unmount();
    });

    expect(capturedSignal?.aborted).toBe(true);
  });
});
