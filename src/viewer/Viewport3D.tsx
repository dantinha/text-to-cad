import { Canvas } from '@react-three/fiber';
import {
  AlertTriangle,
  Box,
  Cuboid,
  Focus,
  Grid3x3,
  Layers,
  Loader2,
  Ruler,
  ScanEye,
} from 'lucide-react';
import { type ComponentType, useCallback, useMemo, useRef, useState } from 'react';
import { CadHelpers, type DimensionAxis, type ProjectedDimensions } from './CadHelpers';
import { CadMesh } from './CadMesh';
import { computeMeshMetrics, formatMillimeters } from './geometry';
import { RENDER_MODES, type RenderMode, type Viewport3DProps } from './types';

const MODE_ICONS: Record<RenderMode, ComponentType<{ className?: string }>> = {
  solid: Box,
  wireframe: Grid3x3,
  clay: Layers,
  xray: ScanEye,
};

const INITIAL_CAMERA = {
  up: [0, 0, 1] as [number, number, number],
  position: [60, -60, 45] as [number, number, number],
  fov: 42,
};

const CANVAS_DPR: [number, number] = [1, 1.5];

/**
 * Viewport 3D interativo (Z-up, 4 modos de renderização, grade milimétrica,
 * cotas e métricas técnicas) com suporte a controle externo ou estado interno.
 */
export function Viewport3D({
  mesh,
  loading = false,
  error = null,
  renderMode,
  onRenderModeChange,
  showHelpers,
  onToggleHelpers,
  className = '',
}: Viewport3DProps) {
  const [internalMode, setInternalMode] = useState<RenderMode>('solid');
  const [internalShowHelpers, setInternalShowHelpers] = useState<boolean>(true);
  const [fitRequestId, setFitRequestId] = useState<number>(0);
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const dimensionRefs = useRef<Record<DimensionAxis, HTMLSpanElement | null>>({
    x: null,
    y: null,
    z: null,
  });

  const handleProjectDimensions = useCallback((projections: ProjectedDimensions) => {
    for (const axis of ['x', 'y', 'z'] as const) {
      const el = dimensionRefs.current[axis];
      if (!el) continue;
      const proj = projections[axis];
      if (!proj.visible) {
        el.style.setProperty('opacity', '0');
        continue;
      }
      el.style.setProperty('opacity', '1');
      el.style.setProperty(
        'transform',
        `translate3d(${proj.x.toFixed(1)}px, ${proj.y.toFixed(1)}px, 0) translate(-50%, -50%)`,
      );
    }
  }, []);

  const activeMode = renderMode ?? internalMode;
  const effectiveShowHelpers = showHelpers ?? internalShowHelpers;

  const metrics = useMemo(() => (mesh ? computeMeshMetrics(mesh) : null), [mesh]);

  const handleSelectMode = (mode: RenderMode) => {
    if (renderMode === undefined) {
      setInternalMode(mode);
    }
    onRenderModeChange?.(mode);
  };

  const handleToggleHelpers = () => {
    if (showHelpers === undefined) {
      setInternalShowHelpers((prev) => !prev);
    }
    onToggleHelpers?.();
  };

  const handleFitView = () => {
    setFitRequestId((id) => id + 1);
  };

  const hasError = Boolean(error);
  const isEmpty = !mesh && !loading && !hasError;

  return (
    <section
      aria-label="Viewport 3D interativo"
      className={`relative flex h-full min-h-[340px] w-full flex-col overflow-hidden bg-zinc-950 text-zinc-100 ${className}`}
    >
      {/* Barra superior de controles técnicos */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-wrap items-center justify-between gap-2 p-3 select-none">
        <div
          role="group"
          aria-label="Modos de renderização"
          className="pointer-events-auto inline-flex items-center gap-0.5 rounded-md border border-zinc-800 bg-zinc-900/95 p-0.5 backdrop-blur-sm"
        >
          {RENDER_MODES.map((mode) => {
            const Icon = MODE_ICONS[mode.id];
            const isActive = activeMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                data-testid={`render-mode-${mode.id}`}
                aria-label={mode.ariaLabel}
                aria-pressed={isActive}
                title={mode.shortHint}
                onClick={() => handleSelectMode(mode.id)}
                className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{mode.label}</span>
              </button>
            );
          })}
        </div>

        <div className="pointer-events-auto inline-flex items-center gap-1.5">
          <button
            type="button"
            data-testid="viewport-fit"
            aria-label="Centralizar visualização no modelo"
            disabled={!mesh || loading}
            onClick={handleFitView}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/95 px-2.5 py-1.5 text-xs font-medium text-zinc-200 backdrop-blur-sm transition-colors duration-150 hover:bg-zinc-800 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Focus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Centralizar</span>
          </button>

          <button
            type="button"
            data-testid="viewport-helpers"
            aria-label="Alternar cotas e grade"
            aria-pressed={effectiveShowHelpers}
            onClick={handleToggleHelpers}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium backdrop-blur-sm transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-500 ${
              effectiveShowHelpers
                ? 'border-indigo-500/60 bg-zinc-900/95 text-indigo-300 hover:bg-zinc-800'
                : 'border-zinc-800 bg-zinc-900/95 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
            }`}
          >
            <Ruler className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Cotas e Grade</span>
          </button>
        </div>
      </div>

      {/* Cena 3D React Three Fiber focável para controle por teclado */}
      <div
        ref={canvasContainerRef}
        tabIndex={0}
        role="region"
        aria-label="Cena 3D interativa. Arraste para orbitar, use a roda do mouse para zoom e as setas do teclado para mover."
        className="relative h-full w-full flex-1 select-none focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-indigo-500"
      >
        <Canvas frameloop="demand" camera={INITIAL_CAMERA} dpr={CANVAS_DPR}>
          <color attach="background" args={['#09090b']} />
          <ambientLight intensity={0.55} />
          <directionalLight position={[80, -60, 120]} intensity={1.15} />
          <directionalLight position={[-70, 80, -40]} intensity={0.4} color="#cbd5e1" />
          <CadHelpers
            mesh={mesh}
            metrics={metrics}
            renderMode={activeMode}
            showHelpers={effectiveShowHelpers}
            fitRequestId={fitRequestId}
            keyEventsTarget={canvasContainerRef}
            onProjectDimensions={handleProjectDimensions}
          />
          {mesh ? <CadMesh mesh={mesh} renderMode={activeMode} /> : null}
        </Canvas>

        {/* Etiquetas de cotas X/Y/Z projetadas diretamente sobre o canvas */}
        {mesh && metrics && effectiveShowHelpers && !(hasError && !loading) ? (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <span
              ref={(el) => {
                dimensionRefs.current.x = el;
              }}
              data-testid="dim-label-x"
              className="absolute top-0 left-0 whitespace-nowrap rounded border border-red-500/40 bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-200"
            >
              X {formatMillimeters(metrics.sizeX)} mm
            </span>
            <span
              ref={(el) => {
                dimensionRefs.current.y = el;
              }}
              data-testid="dim-label-y"
              className="absolute top-0 left-0 whitespace-nowrap rounded border border-emerald-500/40 bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-200"
            >
              Y {formatMillimeters(metrics.sizeY)} mm
            </span>
            <span
              ref={(el) => {
                dimensionRefs.current.z = el;
              }}
              data-testid="dim-label-z"
              className="absolute top-0 left-0 whitespace-nowrap rounded border border-blue-500/40 bg-zinc-900/90 px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-zinc-200"
            >
              Z {formatMillimeters(metrics.sizeZ)} mm
            </span>
          </div>
        ) : null}
      </div>

      {/* Estado vazio */}
      {isEmpty ? (
        <div
          data-testid="viewport-empty"
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-6"
        >
          <div className="flex max-w-xs flex-col items-center rounded-lg border border-zinc-800 bg-zinc-900/90 px-5 py-4 text-center backdrop-blur-sm">
            <Cuboid className="mb-2 h-6 w-6 text-zinc-400" aria-hidden="true" />
            <p className="text-sm font-medium text-zinc-200">Nenhum modelo 3D carregado</p>
            <p className="mt-1 text-xs leading-relaxed text-zinc-400">
              Descreva uma peça ou escolha um preset para visualizar a geometria paramétrica.
            </p>
          </div>
        </div>
      ) : null}

      {/* Estado carregando */}
      {loading ? (
        <div
          data-testid="viewport-loading"
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/65 p-6 backdrop-blur-[1px]"
        >
          <div className="flex items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-3">
            <Loader2
              className="h-4 w-4 animate-spin text-indigo-400 motion-reduce:animate-none"
              aria-hidden="true"
            />
            <div className="text-left">
              <p className="text-xs font-medium text-zinc-100">Gerando malha 3D...</p>
              <p className="text-[11px] text-zinc-400">Avaliando geometria sólida no kernel</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* Estado de erro */}
      {hasError && !loading ? (
        <div
          data-testid="viewport-error"
          role="alert"
          aria-live="assertive"
          className="absolute inset-0 z-20 flex items-center justify-center bg-zinc-950/75 p-6 select-text"
        >
          <div className="flex max-w-sm items-start gap-3 rounded-lg border border-red-900/70 bg-zinc-900 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden="true" />
            <div className="text-left">
              <p className="text-xs font-semibold text-red-300">Falha ao avaliar geometria 3D</p>
              <p className="mt-1 text-xs leading-relaxed text-zinc-300">{error}</p>
            </div>
          </div>
        </div>
      ) : null}

      {/* HUD inferior: métricas técnicas e legenda sem sobreposição */}
      <div className="pointer-events-none absolute inset-x-3 bottom-3 z-10 flex flex-wrap items-end justify-between gap-2">
        {metrics && !(hasError && !loading) ? (
          <div
            data-testid="viewport-metrics"
            className="pointer-events-auto rounded-md border border-zinc-800 bg-zinc-900/90 px-3 py-2 backdrop-blur-sm select-text"
          >
            <dl className="grid grid-cols-3 gap-x-4 gap-y-0.5 text-[11px]">
              <div>
                <dt className="uppercase tracking-wider text-zinc-400">Dimensões</dt>
                <dd className="font-mono font-medium tabular-nums text-zinc-100">
                  {metrics.formattedDimensions}
                </dd>
              </div>
              <div className="text-right">
                <dt className="uppercase tracking-wider text-zinc-400">Volume</dt>
                <dd className="font-mono font-medium tabular-nums text-zinc-100">
                  {metrics.formattedVolume}
                </dd>
              </div>
              <div className="text-right">
                <dt className="uppercase tracking-wider text-zinc-400">Triângulos</dt>
                <dd className="font-mono font-medium tabular-nums text-zinc-100">
                  {metrics.formattedTriangles}
                </dd>
              </div>
            </dl>
          </div>
        ) : (
          <span />
        )}

        <div className="hidden rounded border border-zinc-800/80 bg-zinc-900/80 px-2 py-1 font-mono text-[10px] text-zinc-400 select-none sm:block">
          Z↑ · Arrastar: orbitar · Roda: zoom · Direito / Setas: mover
        </div>
      </div>
    </section>
  );
}
