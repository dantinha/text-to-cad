import type { MeshData } from '@/core/contracts';

/** Modos de renderização disponíveis no viewport 3D. */
export type RenderMode = 'solid' | 'wireframe' | 'clay' | 'xray';

export interface RenderModeMeta {
  readonly id: RenderMode;
  readonly label: string;
  readonly ariaLabel: string;
  readonly shortHint: string;
}

/** Metadados e rótulos em PT-BR para os 4 modos de renderização. */
export const RENDER_MODES: readonly RenderModeMeta[] = [
  {
    id: 'solid',
    label: 'Sólido',
    ariaLabel: 'Modo de renderização Sólido',
    shortHint: 'Superfície metálica iluminada',
  },
  {
    id: 'wireframe',
    label: 'Wireframe',
    ariaLabel: 'Modo de renderização Wireframe',
    shortHint: 'Malha de triângulos técnica',
  },
  {
    id: 'clay',
    label: 'Argila',
    ariaLabel: 'Modo de renderização Argila',
    shortHint: 'Acabamento fosco para inspeção de forma',
  },
  {
    id: 'xray',
    label: 'Raio-X',
    ariaLabel: 'Modo de renderização Raio-X',
    shortHint: 'Transparência para cavidades internas',
  },
] as const;

export const RENDER_MODE_LABELS: Record<RenderMode, string> = {
  solid: 'Sólido',
  wireframe: 'Wireframe',
  clay: 'Argila',
  xray: 'Raio-X',
};

/** Métricas técnicas derivadas da malha para o HUD de cotas e câmera. */
export interface MeshMetrics {
  readonly sizeX: number;
  readonly sizeY: number;
  readonly sizeZ: number;
  readonly center: readonly [number, number, number];
  readonly radius: number;
  readonly volumeCm3: number;
  readonly triangleCount: number;
  readonly formattedDimensions: string;
  readonly formattedVolume: string;
  readonly formattedTriangles: string;
}

/** Propriedades do componente Viewport3D (suporta uso controlado e não-controlado). */
export interface Viewport3DProps {
  readonly mesh: MeshData | null;
  readonly loading?: boolean;
  readonly error?: string | null;
  readonly renderMode?: RenderMode;
  readonly onRenderModeChange?: (mode: RenderMode) => void;
  readonly showHelpers?: boolean;
  readonly onToggleHelpers?: () => void;
  readonly className?: string;
}
