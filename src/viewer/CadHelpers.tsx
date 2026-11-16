import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import {
  type ComponentRef,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import type { MeshData } from '@/core/contracts';
import {
  computeBboxLabelPositions,
  computeFitCameraPose,
  projectPointToScreen,
  type ScreenProjection,
} from './geometry';
import type { MeshMetrics, RenderMode } from './types';

export type DimensionAxis = 'x' | 'y' | 'z';
export type ProjectedDimensions = Record<DimensionAxis, ScreenProjection>;

export interface CadHelpersProps {
  readonly mesh: MeshData | null;
  readonly metrics: MeshMetrics | null;
  readonly renderMode: RenderMode;
  readonly showHelpers: boolean;
  readonly fitRequestId: number;
  readonly keyEventsTarget?: RefObject<HTMLElement | null>;
  readonly onProjectDimensions?: (projections: ProjectedDimensions) => void;
}

const GRID_ROTATION: [number, number, number] = [Math.PI / 2, 0, 0];
const MAIN_GRID_ARGS: [number, number, string, string] = [200, 20, '#3f3f46', '#27272a'];
const FINE_GRID_ARGS: [number, number, string, string] = [100, 100, '#27272a', '#18181b'];
const MAIN_GRID_POS: [number, number, number] = [0, 0, -0.01];
const FINE_GRID_POS: [number, number, number] = [0, 0, -0.02];

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReducedMotion(onStoreChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener('change', onStoreChange);
  return () => mq.removeEventListener('change', onStoreChange);
}

function getReducedMotionSnapshot(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getReducedMotionServerSnapshot(): boolean {
  return false;
}

interface FitAnimationState {
  active: boolean;
  goalPosition: THREE.Vector3;
  goalTarget: THREE.Vector3;
}

type OrbitControlsInstance = ComponentRef<typeof OrbitControls> & {
  listenToKeyEvents?: (domElement: HTMLElement) => void;
  stopListenToKeyEvents?: () => void;
};

/**
 * Auxiliares técnicos Z-up: grade XY (10 mm / 1 mm), eixos XYZ,
 * bounding box, projeção de cotas em mm e fit-to-view com `prefers-reduced-motion`.
 */
export function CadHelpers({
  mesh,
  metrics,
  renderMode,
  showHelpers,
  fitRequestId,
  keyEventsTarget,
  onProjectDimensions,
}: CadHelpersProps) {
  const controlsRef = useRef<OrbitControlsInstance | null>(null);
  const { camera, invalidate, size } = useThree();
  const prefersReducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotionSnapshot,
    getReducedMotionServerSnapshot,
  );

  const animRef = useRef<FitAnimationState>({
    active: false,
    goalPosition: new THREE.Vector3(60, -60, 45),
    goalTarget: new THREE.Vector3(0, 0, 0),
  });

  const lastFitRef = useRef<{
    mesh: MeshData | null;
    fitRequestId: number;
    controls: OrbitControlsInstance | null;
  }>({
    mesh: null,
    fitRequestId: 0,
    controls: null,
  });

  const labelPositions = useMemo(
    () => (mesh ? computeBboxLabelPositions(mesh.bbox) : null),
    [mesh],
  );

  const syncDimensionOverlay = (): void => {
    if (!onProjectDimensions || !labelPositions || !showHelpers) return;

    const cam = camera as THREE.Camera & { updateMatrixWorld?: () => void };
    if (typeof cam.updateMatrixWorld === 'function') {
      cam.updateMatrixWorld();
    }
    const width = size?.width ?? 0;
    const height = size?.height ?? 0;

    onProjectDimensions({
      x: projectPointToScreen(labelPositions.x, camera, width, height),
      y: projectPointToScreen(labelPositions.y, camera, width, height),
      z: projectPointToScreen(labelPositions.z, camera, width, height),
    });
  };

  const bboxGeometry = useMemo(() => {
    if (!metrics) return null;
    const box = new THREE.BoxGeometry(
      Math.max(metrics.sizeX, 0.001),
      Math.max(metrics.sizeY, 0.001),
      Math.max(metrics.sizeZ, 0.001),
    );
    const edges = new THREE.EdgesGeometry(box);
    box.dispose();
    return edges;
  }, [metrics]);

  useEffect(() => {
    return () => {
      bboxGeometry?.dispose();
    };
  }, [bboxGeometry]);

  useEffect(() => {
    invalidate();
  }, [mesh, renderMode, showHelpers, fitRequestId, invalidate]);

  useEffect(() => {
    const targetEl = keyEventsTarget?.current;
    const controls = controlsRef.current;
    if (!targetEl || !controls || typeof controls.listenToKeyEvents !== 'function') {
      return;
    }
    controls.listenToKeyEvents(targetEl);
    return () => {
      controls.stopListenToKeyEvents?.();
    };
  }, [keyEventsTarget]);

  useEffect(() => {
    const anim = animRef.current;
    if (!mesh || !metrics) {
      return () => {
        anim.active = false;
      };
    }

    const controls = controlsRef.current;
    const isManualFit = fitRequestId !== lastFitRef.current.fitRequestId;
    const isNewMesh = mesh !== lastFitRef.current.mesh;
    const isNewControls = controls !== lastFitRef.current.controls;

    if (!isManualFit && !isNewMesh && !isNewControls) {
      return () => {
        anim.active = false;
      };
    }

    lastFitRef.current = { mesh, fitRequestId, controls };

    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 42;

    let currentDir: readonly [number, number, number] | undefined;
    if (isManualFit && controls) {
      const dx = camera.position.x - controls.target.x;
      const dy = camera.position.y - controls.target.y;
      const dz = camera.position.z - controls.target.z;
      currentDir = [dx, dy, dz];
    }

    const pose = computeFitCameraPose(metrics.center, metrics.radius, fov, currentDir);

    if (prefersReducedMotion) {
      anim.active = false;
      camera.position.set(pose.position[0], pose.position[1], pose.position[2]);
      if (controls) {
        controls.target.set(pose.target[0], pose.target[1], pose.target[2]);
        controls.update();
      }
      syncDimensionOverlay();
      invalidate();
      return () => {
        anim.active = false;
        lastFitRef.current.controls = null;
      };
    }

    anim.goalPosition.set(pose.position[0], pose.position[1], pose.position[2]);
    anim.goalTarget.set(pose.target[0], pose.target[1], pose.target[2]);
    anim.active = true;
    syncDimensionOverlay();
    invalidate();

    return () => {
      anim.active = false;
      lastFitRef.current.controls = null;
    };
  });

  useEffect(() => {
    syncDimensionOverlay();
  });

  useFrame((_, delta) => {
    const anim = animRef.current;
    if (anim.active) {
      const controls = controlsRef.current;
      const alpha = 1 - Math.exp(-12 * Math.min(delta, 0.1));

      camera.position.lerp(anim.goalPosition, alpha);
      if (controls) {
        controls.target.lerp(anim.goalTarget, alpha);
        controls.update();
      }

      const posDone = camera.position.distanceToSquared(anim.goalPosition) < 0.005;
      const targetDone = !controls || controls.target.distanceToSquared(anim.goalTarget) < 0.005;
      if (posDone && targetDone) {
        camera.position.copy(anim.goalPosition);
        if (controls) {
          controls.target.copy(anim.goalTarget);
          controls.update();
        }
        anim.active = false;
      }

      invalidate();
    }

    syncDimensionOverlay();
  });

  const axisSize = metrics ? Math.max(25, Math.ceil(metrics.radius * 1.4)) : 30;

  return (
    <>
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping={!prefersReducedMotion}
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={2500}
        onStart={() => {
          animRef.current.active = false;
        }}
        onChange={() => {
          syncDimensionOverlay();
        }}
      />

      {showHelpers ? (
        <group>
          {/* Plano XY em z = 0: grade principal 10 mm e grade fina 1 mm */}
          <gridHelper args={MAIN_GRID_ARGS} rotation={GRID_ROTATION} position={MAIN_GRID_POS} />
          <gridHelper args={FINE_GRID_ARGS} rotation={GRID_ROTATION} position={FINE_GRID_POS} />

          {/* Eixos XYZ: X vermelho, Y verde, Z azul para cima */}
          <axesHelper args={[axisSize]} />

          {/* Bounding box */}
          {mesh && metrics && bboxGeometry ? (
            <lineSegments
              geometry={bboxGeometry}
              position={[metrics.center[0], metrics.center[1], metrics.center[2]]}
            >
              <lineBasicMaterial color="#71717a" transparent opacity={0.75} />
            </lineSegments>
          ) : null}
        </group>
      ) : null}
    </>
  );
}
