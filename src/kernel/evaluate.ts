import type { CrossSection, Manifold, ManifoldToplevel } from 'manifold-3d';
import type { IR, IRNode, KernelError, MeshData, Result } from '@/core/contracts';
import { err } from '@/core/result';
import { extractMeshData } from './mesh';

const DEFAULT_SEGMENTS = 48;

export interface WorkerRequest {
  readonly id: number;
  readonly ir: IR;
}

export interface WorkerResponse {
  readonly id: number;
  readonly result: Result<MeshData, KernelError>;
}

class CancelledError extends Error {
  constructor() {
    super('Avaliação cancelada.');
    this.name = 'CancelledError';
  }
}

const cancelledErr = (): Result<never, KernelError> =>
  err({ code: 'cancelled', message: 'Avaliação cancelada.' });

function checkAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new CancelledError();
  }
}

function deleteAll(items: ReadonlyArray<{ delete(): void }>): void {
  for (const item of items) {
    item.delete();
  }
}

function evaluateTorus(
  wasm: ManifoldToplevel,
  majorRadius: number,
  minorRadius: number,
  segments: number,
): Manifold {
  const circle = wasm.CrossSection.circle(minorRadius, segments);
  let ring: CrossSection | undefined;
  try {
    ring = circle.translate([majorRadius, 0]);
  } finally {
    circle.delete();
  }

  try {
    return wasm.Manifold.revolve(ring, segments);
  } finally {
    ring.delete();
  }
}

function evaluateExtrude(
  wasm: ManifoldToplevel,
  polygon: ReadonlyArray<readonly [number, number]>,
  height: number,
  center: boolean,
): Manifold {
  const contour: [number, number][] = polygon.map(([x, y]) => [x, y]);
  const cs = new wasm.CrossSection([contour], 'EvenOdd');
  try {
    return cs.extrude(height, undefined, undefined, undefined, center);
  } finally {
    cs.delete();
  }
}

function evaluateChildren(
  wasm: ManifoldToplevel,
  nodes: readonly IRNode[],
  signal?: AbortSignal,
): Manifold[] {
  const results: Manifold[] = [];
  try {
    for (const child of nodes) {
      results.push(evaluateNode(wasm, child, signal));
    }
    return results;
  } catch (error) {
    deleteAll(results);
    throw error;
  }
}

function evaluateNode(wasm: ManifoldToplevel, node: IRNode, signal?: AbortSignal): Manifold {
  checkAborted(signal);
  const { Manifold } = wasm;

  switch (node.type) {
    case 'cube':
      return Manifold.cube([node.size[0], node.size[1], node.size[2]], node.center ?? false);

    case 'cylinder':
      return Manifold.cylinder(
        node.height,
        node.radius,
        node.radius,
        node.segments ?? DEFAULT_SEGMENTS,
        node.center ?? false,
      );

    case 'sphere':
      return Manifold.sphere(node.radius, node.segments ?? DEFAULT_SEGMENTS);

    case 'cone':
      return Manifold.cylinder(
        node.height,
        node.radius,
        0,
        node.segments ?? DEFAULT_SEGMENTS,
        node.center ?? false,
      );

    case 'torus':
      return evaluateTorus(
        wasm,
        node.majorRadius,
        node.minorRadius,
        node.segments ?? DEFAULT_SEGMENTS,
      );

    case 'extrude':
      return evaluateExtrude(wasm, node.polygon, node.height, node.center ?? false);

    case 'translate': {
      const child = evaluateNode(wasm, node.child, signal);
      try {
        return child.translate([node.offset[0], node.offset[1], node.offset[2]]);
      } finally {
        child.delete();
      }
    }

    case 'rotate': {
      const child = evaluateNode(wasm, node.child, signal);
      try {
        return child.rotate([node.degrees[0], node.degrees[1], node.degrees[2]]);
      } finally {
        child.delete();
      }
    }

    case 'scale': {
      const child = evaluateNode(wasm, node.child, signal);
      try {
        return child.scale([node.factor[0], node.factor[1], node.factor[2]]);
      } finally {
        child.delete();
      }
    }

    case 'mirror': {
      const child = evaluateNode(wasm, node.child, signal);
      try {
        return child.mirror([node.normal[0], node.normal[1], node.normal[2]]);
      } finally {
        child.delete();
      }
    }

    case 'union': {
      const children = evaluateChildren(wasm, node.children, signal);
      try {
        if (children.length === 1 && children[0]) {
          const single = children[0];
          children.length = 0;
          return single;
        }
        return Manifold.union(children);
      } finally {
        deleteAll(children);
      }
    }

    case 'intersection': {
      const children = evaluateChildren(wasm, node.children, signal);
      try {
        if (children.length === 1 && children[0]) {
          const single = children[0];
          children.length = 0;
          return single;
        }
        return Manifold.intersection(children);
      } finally {
        deleteAll(children);
      }
    }

    case 'difference': {
      const base = evaluateNode(wasm, node.base, signal);
      let subs: Manifold[] = [];
      let keepBase = false;
      try {
        subs = evaluateChildren(wasm, node.subtract, signal);
        if (subs.length === 0) {
          keepBase = true;
          return base;
        }
        if (subs.length === 1 && subs[0]) {
          return base.subtract(subs[0]);
        }
        return Manifold.difference([base, ...subs]);
      } finally {
        if (!keepBase) {
          base.delete();
        }
        deleteAll(subs);
      }
    }
  }
}

/**
 * Avalia uma árvore IR síncronamente usando uma instância `manifold-3d` já inicializada.
 * Garante limpeza de todos os objetos WASM intermediários em blocos `try/finally`.
 */
export function evaluateIR(
  wasm: ManifoldToplevel,
  ir: IR,
  signal?: AbortSignal,
): Result<MeshData, KernelError> {
  if (signal?.aborted) {
    return cancelledErr();
  }

  let rootManifold: Manifold | undefined;
  try {
    rootManifold = evaluateNode(wasm, ir.root, signal);
    checkAborted(signal);
    return extractMeshData(rootManifold);
  } catch (error) {
    if (error instanceof CancelledError || signal?.aborted) {
      return cancelledErr();
    }
    const detail = error instanceof Error ? error.message : String(error);
    return err({ code: 'wasm_error', message: `Erro ao avaliar geometria no kernel: ${detail}` });
  } finally {
    rootManifold?.delete();
  }
}

let nodeWasmPromise: Promise<ManifoldToplevel> | undefined;

async function getNodeWasm(): Promise<ManifoldToplevel> {
  if (!nodeWasmPromise) {
    nodeWasmPromise = import('manifold-3d')
      .then(async ({ default: Module }) => {
        const wasm = await Module();
        wasm.setup();
        return wasm;
      })
      .catch((error: unknown) => {
        nodeWasmPromise = undefined;
        throw error;
      });
  }
  return nodeWasmPromise;
}

/**
 * Avalia um IR em ambiente Node usando um singleton WASM lazy (para testes sem Web Worker).
 */
export async function evaluateInNode(
  ir: IR,
  signal?: AbortSignal,
): Promise<Result<MeshData, KernelError>> {
  if (signal?.aborted) {
    return cancelledErr();
  }

  let wasm: ManifoldToplevel;
  try {
    wasm = await getNodeWasm();
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return err({ code: 'wasm_error', message: `Falha ao inicializar WASM: ${detail}` });
  }

  if (signal?.aborted) {
    return cancelledErr();
  }

  return evaluateIR(wasm, ir, signal);
}
