// @vitest-environment jsdom
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeshData } from '@/core';
import { ok } from '@/core/result';
import { PRESETS } from '@/presets';
import { cubeDoc } from '../fixtures/ir';
import { unitCubeMesh } from '../fixtures/mesh';

const mockEvaluate = vi.fn();
const mockDispose = vi.fn();

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

import { App } from '@/app/App';
import { InspectorPanel } from '@/app/InspectorPanel';
import { ParamPanel } from '@/app/ParamPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('ParamPanel e InspectorPanel (M3)', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    mockEvaluate.mockReset();
    mockDispose.mockReset();
    window.history.replaceState({}, '', '/');
  });

  afterEach(async () => {
    vi.useRealTimers();
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it('renderiza os 4 presets, sliders com aria-valuetext e dispara seleção, alteração e reset', async () => {
    const first = PRESETS[0];
    if (!first) throw new Error('PRESETS vazio');
    const onSelectPreset = vi.fn();
    const onChangeParam = vi.fn();
    const onResetParams = vi.fn();

    await act(async () => {
      root.render(
        <ParamPanel
          presets={PRESETS}
          selectedPreset={first}
          params={first.defaultParams}
          onSelectPreset={onSelectPreset}
          onChangeParam={onChangeParam}
          onResetParams={onResetParams}
        />,
      );
    });

    for (const preset of PRESETS) {
      expect(container.querySelector(`[data-testid="preset-${preset.id}"]`)).not.toBeNull();
    }

    const slider = container.querySelector(
      '[data-testid="param-slider-largura"]',
    ) as HTMLInputElement;
    expect(slider.getAttribute('aria-valuetext')).toBe('60 mm');

    const flangeBtn = container.querySelector('[data-testid="preset-flange"]') as HTMLButtonElement;
    await act(async () => {
      flangeBtn.click();
    });
    expect(onSelectPreset).toHaveBeenCalledWith('flange');

    const resetBtn = container.querySelector('[data-testid="reset-params"]') as HTMLButtonElement;
    await act(async () => {
      resetBtn.click();
    });
    expect(onResetParams).toHaveBeenCalledTimes(1);
  });

  it('alterna abas WAI-ARIA (ArrowRight/ArrowLeft/Home/End) e exporta STL/SCAD/JSON', async () => {
    const createUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    const revokeUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

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

    const status = container.querySelector('[data-testid="export-status"]');
    expect(status).not.toBeNull();
    expect(status?.textContent).toBe('');

    const stlBtn = container.querySelector('[data-testid="export-stl"]') as HTMLButtonElement;
    const scadBtn = container.querySelector('[data-testid="export-scad"]') as HTMLButtonElement;
    const jsonBtn = container.querySelector('[data-testid="export-json"]') as HTMLButtonElement;

    await act(async () => {
      stlBtn.click();
    });
    expect(status?.textContent).toBe('Arquivo Cubo.stl exportado.');

    await act(async () => {
      scadBtn.click();
    });
    expect(status?.textContent).toBe('Arquivo Cubo.scad exportado.');

    await act(async () => {
      jsonBtn.click();
    });
    expect(status?.textContent).toBe('Arquivo Cubo.json exportado.');
    expect(createUrlSpy).toHaveBeenCalledTimes(3);
    expect(revokeUrlSpy).toHaveBeenCalledTimes(3);

    const scadTab = container.querySelector('[data-testid="tab-scad"]') as HTMLButtonElement;
    const irTab = container.querySelector('[data-testid="tab-ir"]') as HTMLButtonElement;

    await act(async () => {
      scadTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(irTab.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      irTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(scadTab.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      scadTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(irTab.getAttribute('aria-selected')).toBe('true');

    await act(async () => {
      irTab.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    });
    expect(scadTab.getAttribute('aria-selected')).toBe('true');
  });

  it('App avalia imediatamente mesmo em StrictMode, navega para /lab e limpa worker ao desmontar', async () => {
    vi.useFakeTimers();
    mockEvaluate.mockResolvedValue(ok(unitCubeMesh(10)));

    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(mockEvaluate).toHaveBeenCalledTimes(1);
    const vp = container.querySelector('[data-testid="mock-viewport"]');
    expect(vp?.getAttribute('data-tris')).toBe('12');

    // Navega para /lab e aguarda avaliação sequencial dos 4 presets
    const labBtn = container.querySelector('[data-testid="nav-lab"]') as HTMLButtonElement;
    await act(async () => {
      labBtn.click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(window.location.pathname).toBe('/lab');
    expect(container.querySelector('[data-testid="lab-page"]')).not.toBeNull();
    for (const preset of PRESETS) {
      const cardVp = container.querySelector(
        `[data-testid="lab-card-${preset.id}"] [data-testid="mock-viewport"]`,
      );
      expect(cardVp?.getAttribute('data-tris')).toBe('12');
      expect(cardVp?.getAttribute('data-loading')).toBe('false');
    }

    await act(async () => {
      root.unmount();
    });
    expect(mockDispose).toHaveBeenCalled();
  });
});
