// @vitest-environment jsdom
import { act, type ReactNode, type Ref, StrictMode, useImperativeHandle } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as geometryModule from '@/viewer/geometry';
import { CadMesh } from '@/viewer/CadMesh';
import { Viewport3D } from '@/viewer/Viewport3D';
import type { RenderMode, Viewport3DProps } from '@/viewer/types';
import { unitCubeMesh } from '../fixtures/mesh';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const canvasCalls: Array<Record<string, unknown>> = [];
const mockCameraPositionSet = vi.fn();
const mockCameraPositionCopy = vi.fn();
const mockCameraPositionLerp = vi.fn();
const mockCameraDistanceToSquared = vi.fn(() => 10);
const mockControlsTargetSet = vi.fn();
const mockControlsTargetCopy = vi.fn();
const mockControlsTargetLerp = vi.fn();
const mockControlsTargetDistanceToSquared = vi.fn(() => 10);
const mockControlsUpdate = vi.fn();
const mockListenToKeyEvents = vi.fn();
const mockStopListenToKeyEvents = vi.fn();
const mockInvalidate = vi.fn();
const mockMatchMediaAdd = vi.fn();
const mockMatchMediaRemove = vi.fn();

let reducedMotionMatches = false;
let capturedFrameCallback: ((state: unknown, delta: number) => void) | null = null;
let capturedOrbitOnStart: (() => void) | undefined;

vi.mock('@react-three/fiber', () => ({
  Canvas: ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    canvasCalls.push(props);
    return (
      <div
        data-testid="mock-r3f-canvas"
        data-frameloop={String(props.frameloop)}
        data-dpr={JSON.stringify(props.dpr)}
      >
        {children}
      </div>
    );
  },
  useThree: () => ({
    camera: {
      position: {
        x: 60,
        y: -60,
        z: 45,
        set: mockCameraPositionSet,
        copy: mockCameraPositionCopy,
        lerp: mockCameraPositionLerp,
        distanceToSquared: mockCameraDistanceToSquared,
      },
      fov: 42,
      up: { set: vi.fn() },
      matrixWorldInverse: new THREE.Matrix4(),
      projectionMatrix: new THREE.Matrix4(),
    },
    controls: null,
    invalidate: mockInvalidate,
    size: { width: 800, height: 600 },
  }),
  useFrame: (cb: (state: unknown, delta: number) => void) => {
    capturedFrameCallback = cb;
  },
}));

vi.mock('@react-three/drei', () => ({
  OrbitControls: ({ ref, onStart }: { ref?: Ref<unknown>; onStart?: () => void }) => {
    capturedOrbitOnStart = onStart;
    useImperativeHandle(ref, () => ({
      target: {
        x: 0,
        y: 0,
        z: 0,
        set: mockControlsTargetSet,
        copy: mockControlsTargetCopy,
        lerp: mockControlsTargetLerp,
        distanceToSquared: mockControlsTargetDistanceToSquared,
      },
      update: mockControlsUpdate,
      listenToKeyEvents: mockListenToKeyEvents,
      stopListenToKeyEvents: mockStopListenToKeyEvents,
    }));
    return <div data-testid="mock-orbit-controls" />;
  },
}));

const R3F_JSDOM_WARNING_RE =
  /is unrecognized in this browser|is using incorrect casing|React does not recognize the `%s` prop|Received `%s` for a non-boolean attribute/;

describe('Viewport3D', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeAll(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: reducedMotionMatches,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: mockMatchMediaAdd,
        removeEventListener: mockMatchMediaRemove,
        dispatchEvent: vi.fn(),
      })),
    });
  });

  beforeEach(() => {
    canvasCalls.length = 0;
    reducedMotionMatches = false;
    capturedFrameCallback = null;
    capturedOrbitOnStart = undefined;

    mockCameraPositionSet.mockClear();
    mockCameraPositionCopy.mockClear();
    mockCameraPositionLerp.mockClear();
    mockCameraDistanceToSquared.mockReturnValue(10);
    mockControlsTargetSet.mockClear();
    mockControlsTargetCopy.mockClear();
    mockControlsTargetLerp.mockClear();
    mockControlsTargetDistanceToSquared.mockReturnValue(10);
    mockControlsUpdate.mockClear();
    mockListenToKeyEvents.mockClear();
    mockStopListenToKeyEvents.mockClear();
    mockInvalidate.mockClear();
    mockMatchMediaAdd.mockClear();
    mockMatchMediaRemove.mockClear();

    const originalError = console.error;
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const first = typeof args[0] === 'string' ? args[0] : '';
      if (R3F_JSDOM_WARNING_RE.test(first)) return;
      originalError(...args);
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  async function renderViewport(props: Viewport3DProps, strict = false) {
    await act(async () => {
      root.render(
        strict ? (
          <StrictMode>
            <Viewport3D {...props} />
          </StrictMode>
        ) : (
          <Viewport3D {...props} />
        ),
      );
    });
  }

  it('exibe estado vazio em PT-BR quando mesh é null', async () => {
    await renderViewport({ mesh: null });

    const emptyEl = container.querySelector('[data-testid="viewport-empty"]');
    expect(emptyEl).not.toBeNull();
    expect(emptyEl?.textContent).toContain('Nenhum modelo 3D');
    expect(container.querySelector('[data-testid="viewport-metrics"]')).toBeNull();

    const fitBtn = container.querySelector('[data-testid="viewport-fit"]') as HTMLButtonElement;
    expect(fitBtn).not.toBeNull();
    expect(fitBtn.disabled).toBe(true);
  });

  it('exibe estado de carregamento acessível quando loading=true', async () => {
    await renderViewport({ mesh: null, loading: true });

    const loadingEl = container.querySelector('[data-testid="viewport-loading"]');
    expect(loadingEl).not.toBeNull();
    expect(loadingEl?.getAttribute('role')).toBe('status');
    expect(loadingEl?.textContent).toContain('Gerando malha');
  });

  it('exibe estado de erro com role="alert", select-text e oculta viewport-metrics', async () => {
    await renderViewport({
      mesh: unitCubeMesh(10),
      loading: false,
      error: 'Tempo limite do kernel excedido',
    });

    const errorEl = container.querySelector('[data-testid="viewport-error"]');
    expect(errorEl).not.toBeNull();
    expect(errorEl?.getAttribute('role')).toBe('alert');
    expect(errorEl?.className).toContain('select-text');
    expect(errorEl?.textContent).toContain('Tempo limite do kernel excedido');
    expect(container.querySelector('[data-testid="viewport-metrics"]')).toBeNull();
  });

  it('exibe métricas, cotas em 3 arestas distintas e configura Canvas frameloop="demand" e dpr=[1, 1.5]', async () => {
    const mesh = unitCubeMesh(10);
    await renderViewport({ mesh });

    const metricsEl = container.querySelector('[data-testid="viewport-metrics"]');
    expect(metricsEl).not.toBeNull();
    expect(metricsEl?.className).toContain('select-text');
    expect(metricsEl?.textContent).toContain('10,0 × 10,0 × 10,0 mm');
    expect(metricsEl?.textContent).toContain('1,00 cm³');
    expect(metricsEl?.textContent).toContain('12');

    const dimX = container.querySelector('[data-testid="dim-label-x"]');
    const dimY = container.querySelector('[data-testid="dim-label-y"]');
    const dimZ = container.querySelector('[data-testid="dim-label-z"]');
    expect(dimX?.textContent).toBe('X 10,0 mm');
    expect(dimY?.textContent).toBe('Y 10,0 mm');
    expect(dimZ?.textContent).toBe('Z 10,0 mm');

    expect(canvasCalls.length).toBeGreaterThan(0);
    const lastCanvasProps = canvasCalls[canvasCalls.length - 1];
    expect(lastCanvasProps?.frameloop).toBe('demand');
    expect(lastCanvasProps?.dpr).toEqual([1, 1.5]);
    expect(lastCanvasProps?.camera).toEqual({
      up: [0, 0, 1],
      position: [60, -60, 45],
      fov: 42,
    });
  });

  it('alterna os 4 modos de renderização com aria-pressed, aria-label em PT-BR e invalida frame', async () => {
    await renderViewport({ mesh: unitCubeMesh(10) });
    mockInvalidate.mockClear();

    const modes: ReadonlyArray<{ id: RenderMode; label: string }> = [
      { id: 'solid', label: 'Sólido' },
      { id: 'wireframe', label: 'Wireframe' },
      { id: 'clay', label: 'Argila' },
      { id: 'xray', label: 'Raio-X' },
    ];

    const initialSolid = container.querySelector('[data-testid="render-mode-solid"]');
    expect(initialSolid?.getAttribute('aria-pressed')).toBe('true');

    for (const mode of modes) {
      const btn = container.querySelector(
        `[data-testid="render-mode-${mode.id}"]`,
      ) as HTMLButtonElement | null;
      expect(btn).not.toBeNull();
      expect(btn?.getAttribute('aria-label')).toContain(mode.label);

      await act(async () => {
        btn?.click();
      });

      for (const other of modes) {
        const otherBtn = container.querySelector(`[data-testid="render-mode-${other.id}"]`);
        expect(otherBtn?.getAttribute('aria-pressed')).toBe(
          other.id === mode.id ? 'true' : 'false',
        );
      }
    }

    expect(mockInvalidate).toHaveBeenCalled();
  });

  it('suporta modo controlado para renderMode e showHelpers', async () => {
    const onRenderModeChange = vi.fn();
    const onToggleHelpers = vi.fn();

    await renderViewport({
      mesh: unitCubeMesh(10),
      renderMode: 'clay',
      onRenderModeChange,
      showHelpers: false,
      onToggleHelpers,
    });

    expect(container.querySelector('[data-testid="dim-label-x"]')).toBeNull();

    const clayBtn = container.querySelector('[data-testid="render-mode-clay"]');
    expect(clayBtn?.getAttribute('aria-pressed')).toBe('true');

    const xrayBtn = container.querySelector(
      '[data-testid="render-mode-xray"]',
    ) as HTMLButtonElement;
    await act(async () => {
      xrayBtn.click();
    });
    expect(onRenderModeChange).toHaveBeenCalledWith('xray');

    const helpersBtn = container.querySelector(
      '[data-testid="viewport-helpers"]',
    ) as HTMLButtonElement;
    expect(helpersBtn.getAttribute('aria-pressed')).toBe('false');
    await act(async () => {
      helpersBtn.click();
    });
    expect(onToggleHelpers).toHaveBeenCalledTimes(1);
  });

  it('conecta controle por teclado no container focável e remove listener de matchMedia no unmount', async () => {
    await renderViewport({ mesh: unitCubeMesh(10) });

    const region = container.querySelector('[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute('tabindex')).toBe('0');
    expect(mockListenToKeyEvents).toHaveBeenCalledWith(region);

    expect(mockMatchMediaAdd).toHaveBeenCalledWith('change', expect.any(Function));
    const addedListener = mockMatchMediaAdd.mock.calls[0]?.[1];

    await act(async () => {
      root.unmount();
    });

    expect(mockStopListenToKeyEvents).toHaveBeenCalled();
    expect(mockMatchMediaRemove).toHaveBeenCalledWith('change', addedListener);
  });

  it('anima fit-to-view em useFrame com invalidate e cancela ao iniciar órbita manual (onStart)', async () => {
    reducedMotionMatches = false;
    await renderViewport({ mesh: unitCubeMesh(10) });

    expect(capturedFrameCallback).not.toBeNull();
    expect(mockInvalidate).toHaveBeenCalled();

    mockCameraPositionLerp.mockClear();
    mockControlsTargetLerp.mockClear();
    mockInvalidate.mockClear();

    // Frame durante animação interpola câmera e target e solicita próximo frame
    act(() => {
      capturedFrameCallback?.({}, 0.016);
    });
    expect(mockCameraPositionLerp).toHaveBeenCalledTimes(1);
    expect(mockControlsTargetLerp).toHaveBeenCalledTimes(1);
    expect(mockControlsUpdate).toHaveBeenCalled();
    expect(mockInvalidate).toHaveBeenCalledTimes(1);

    // Usuário inicia interação manual -> cancela animação em andamento
    expect(capturedOrbitOnStart).toBeDefined();
    act(() => {
      capturedOrbitOnStart?.();
    });

    mockCameraPositionLerp.mockClear();
    act(() => {
      capturedFrameCallback?.({}, 0.016);
    });
    expect(mockCameraPositionLerp).not.toHaveBeenCalled();
  });

  it('mantém alinhamento de câmera e OrbitControls em StrictMode (com e sem reduced-motion)', async () => {
    reducedMotionMatches = true;
    await renderViewport({ mesh: unitCubeMesh(10) }, true);

    expect(mockCameraPositionSet).toHaveBeenCalled();
    expect(mockControlsTargetSet).toHaveBeenCalledWith(0, 0, 0);
    expect(mockControlsUpdate).toHaveBeenCalled();

    // Em StrictMode com movimento habilitado, o segundo mount deve reativar a animação após cleanup
    reducedMotionMatches = false;
    mockCameraPositionLerp.mockClear();
    await renderViewport({ mesh: unitCubeMesh(20) }, true);

    act(() => {
      capturedFrameCallback?.({}, 0.016);
    });
    expect(mockCameraPositionLerp).toHaveBeenCalledTimes(1);
  });

  it('reutiliza BufferGeometry e instâncias de Material ao alternar modos e descarta tudo no unmount', async () => {
    const geomSpy = vi.spyOn(geometryModule, 'meshDataToBufferGeometry');
    const geomDisposeSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'dispose');
    const matDisposeSpy = vi.spyOn(THREE.Material.prototype, 'dispose');
    const mesh = unitCubeMesh(10);

    await act(async () => {
      root.render(<CadMesh mesh={mesh} renderMode="solid" />);
    });
    expect(geomSpy).toHaveBeenCalledTimes(1);

    for (const mode of ['wireframe', 'clay', 'xray', 'solid'] as const) {
      await act(async () => {
        root.render(<CadMesh mesh={mesh} renderMode={mode} />);
      });
    }

    expect(geomSpy).toHaveBeenCalledTimes(1);
    expect(geomDisposeSpy).not.toHaveBeenCalled();
    expect(matDisposeSpy).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    expect(geomDisposeSpy).toHaveBeenCalledTimes(1);
    expect(matDisposeSpy).toHaveBeenCalledTimes(4);
  });
});
