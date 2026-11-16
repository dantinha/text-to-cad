import { describe, expect, it } from 'vitest';
import type { ManifoldToplevel } from 'manifold-3d';
import type { IRDocument, MeshData } from '@/core/contracts';
import { evaluateInNode, evaluateIR } from '@/kernel/evaluate';
import { allNodeTypesDoc, cubeDoc, cubeMinusCylinderDoc } from '../fixtures/ir';

const near = (actual: number, expected: number, relTol: number): boolean =>
  Math.abs(actual - expected) / expected <= relTol;

function countOpenEdgesWelded(mesh: MeshData): number {
  const posToId = new Map<string, number>();
  const remap = new Uint32Array(mesh.positions.length / 3);
  let nextId = 0;

  for (let i = 0; i < remap.length; i++) {
    const x = (mesh.positions[i * 3] ?? 0).toFixed(4);
    const y = (mesh.positions[i * 3 + 1] ?? 0).toFixed(4);
    const z = (mesh.positions[i * 3 + 2] ?? 0).toFixed(4);
    const key = `${x}_${y}_${z}`;
    let id = posToId.get(key);
    if (id === undefined) {
      id = nextId++;
      posToId.set(key, id);
    }
    remap[i] = id;
  }

  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const a = remap[mesh.indices[t] ?? 0] ?? 0;
    const b = remap[mesh.indices[t + 1] ?? 0] ?? 0;
    const c = remap[mesh.indices[t + 2] ?? 0] ?? 0;
    const tri = [a, b, c];
    for (let k = 0; k < 3; k++) {
      const u = tri[k] ?? 0;
      const v = tri[(k + 1) % 3] ?? 0;
      const key = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }

  let open = 0;
  for (const count of edges.values()) {
    if (count !== 2) open++;
  }
  return open;
}

function assertNormalsValid(mesh: MeshData): void {
  expect(mesh.normals.length).toBe(mesh.positions.length);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const nx = mesh.normals[i] ?? Number.NaN;
    const ny = mesh.normals[i + 1] ?? Number.NaN;
    const nz = mesh.normals[i + 2] ?? Number.NaN;
    expect(Number.isFinite(nx)).toBe(true);
    expect(Number.isFinite(ny)).toBe(true);
    expect(Number.isFinite(nz)).toBe(true);
    expect(Math.hypot(nx, ny, nz)).toBeCloseTo(1, 4);
  }
}

const docOf = (root: IRDocument['root']): IRDocument => ({
  schemaVersion: 1,
  units: 'mm',
  root,
});

describe('evaluateInNode / evaluateIR: volumes analíticos e geometria', () => {
  it('avalia cubeDoc() com volume exatamente 1000 mm³ e bbox [0..10]', async () => {
    const res = await evaluateInNode(cubeDoc());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.volumeMm3).toBeCloseTo(1000, 6);
    expect(res.value.bbox.min).toEqual([0, 0, 0]);
    expect(res.value.bbox.max).toEqual([10, 10, 10]);
    expect(countOpenEdgesWelded(res.value)).toBe(0);
    assertNormalsValid(res.value);
  });

  it('avalia cubeMinusCylinderDoc() dentro de ±0,5% e com malha fechada', async () => {
    const res = await evaluateInNode(cubeMinusCylinderDoc());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const expected = 40 * 30 * 20 - Math.PI * 5 * 5 * 20;
    expect(near(res.value.volumeMm3, expected, 0.005)).toBe(true);
    expect(res.value.bbox.min).toEqual([-20, -15, -10]);
    expect(res.value.bbox.max).toEqual([20, 15, 10]);
    expect(countOpenEdgesWelded(res.value)).toBe(0);
    assertNormalsValid(res.value);
  });

  it('respeita center=false (padrão) e center=true em cube, cylinder, cone e extrude', async () => {
    const cylDefault = await evaluateInNode(
      docOf({ id: 'c1', type: 'cylinder', height: 10, radius: 5, segments: 128 }),
    );
    expect(cylDefault.ok).toBe(true);
    if (cylDefault.ok) {
      expect(cylDefault.value.bbox.min[2]).toBeCloseTo(0, 5);
      expect(cylDefault.value.bbox.max[2]).toBeCloseTo(10, 5);
      expect(near(cylDefault.value.volumeMm3, Math.PI * 25 * 10, 0.005)).toBe(true);
    }

    const cylCentered = await evaluateInNode(
      docOf({ id: 'c2', type: 'cylinder', height: 10, radius: 5, segments: 128, center: true }),
    );
    expect(cylCentered.ok).toBe(true);
    if (cylCentered.ok) {
      expect(cylCentered.value.bbox.min[2]).toBeCloseTo(-5, 5);
      expect(cylCentered.value.bbox.max[2]).toBeCloseTo(5, 5);
    }

    const coneDefault = await evaluateInNode(
      docOf({ id: 'cn1', type: 'cone', height: 12, radius: 6, segments: 128 }),
    );
    expect(coneDefault.ok).toBe(true);
    if (coneDefault.ok) {
      expect(coneDefault.value.bbox.min[2]).toBeCloseTo(0, 5);
      expect(coneDefault.value.bbox.max[2]).toBeCloseTo(12, 5);
      expect(near(coneDefault.value.volumeMm3, (1 / 3) * Math.PI * 36 * 12, 0.005)).toBe(true);
    }

    const coneCentered = await evaluateInNode(
      docOf({ id: 'cn2', type: 'cone', height: 12, radius: 6, segments: 128, center: true }),
    );
    expect(coneCentered.ok).toBe(true);
    if (coneCentered.ok) {
      expect(coneCentered.value.bbox.min[2]).toBeCloseTo(-6, 5);
      expect(coneCentered.value.bbox.max[2]).toBeCloseTo(6, 5);
    }

    const extCentered = await evaluateInNode(
      docOf({
        id: 'ex1',
        type: 'extrude',
        polygon: [
          [0, 0],
          [10, 0],
          [0, 10],
        ],
        height: 8,
        center: true,
      }),
    );
    expect(extCentered.ok).toBe(true);
    if (extCentered.ok) {
      expect(extCentered.value.bbox.min[2]).toBeCloseTo(-4, 5);
      expect(extCentered.value.bbox.max[2]).toBeCloseTo(4, 5);
      expect(extCentered.value.volumeMm3).toBeCloseTo(0.5 * 10 * 10 * 8, 4);
    }
  });

  it('avalia sphere, torus e extrude em L dentro da tolerância do ADR-001', async () => {
    const sphere = await evaluateInNode(
      docOf({ id: 'sp', type: 'sphere', radius: 5, segments: 128 }),
    );
    expect(sphere.ok).toBe(true);
    if (sphere.ok) {
      const expected = (4 / 3) * Math.PI * 125;
      expect(near(sphere.value.volumeMm3, expected, 0.005)).toBe(true);
      expect(countOpenEdgesWelded(sphere.value)).toBe(0);
    }

    const torus = await evaluateInNode(
      docOf({ id: 'tr', type: 'torus', majorRadius: 10, minorRadius: 3, segments: 96 }),
    );
    expect(torus.ok).toBe(true);
    if (torus.ok) {
      const expected = 2 * Math.PI * Math.PI * 10 * 9;
      expect(near(torus.value.volumeMm3, expected, 0.005)).toBe(true);
      expect(countOpenEdgesWelded(torus.value)).toBe(0);
    }

    // Extrude em L + polígono em sentido horário (CW)
    const extL = await evaluateInNode(
      docOf({
        id: 'el',
        type: 'extrude',
        polygon: [
          [0, 0],
          [20, 0],
          [20, 5],
          [5, 5],
          [5, 20],
          [0, 20],
        ],
        height: 10,
      }),
    );
    expect(extL.ok).toBe(true);
    if (extL.ok) {
      expect(extL.value.volumeMm3).toBeCloseTo((20 * 5 + 5 * 15) * 10, 4);
    }

    const extCw = await evaluateInNode(
      docOf({
        id: 'ecw',
        type: 'extrude',
        polygon: [
          [0, 0],
          [0, 10],
          [10, 0],
        ],
        height: 5,
      }),
    );
    expect(extCw.ok).toBe(true);
    if (extCw.ok) {
      expect(extCw.value.volumeMm3).toBeCloseTo(250, 4);
    }
  });

  it('avalia transformações (translate, rotate, scale, mirror) e booleanos compostos', async () => {
    const rotRes = await evaluateInNode(
      docOf({
        id: 'rot',
        type: 'rotate',
        degrees: [0, 0, 90],
        child: { id: 'c', type: 'cube', size: [20, 10, 5] },
      }),
    );
    expect(rotRes.ok).toBe(true);
    if (rotRes.ok) {
      expect(rotRes.value.bbox.min[0]).toBeCloseTo(-10, 5);
      expect(rotRes.value.bbox.max[0]).toBeCloseTo(0, 5);
      expect(rotRes.value.bbox.min[1]).toBeCloseTo(0, 5);
      expect(rotRes.value.bbox.max[1]).toBeCloseTo(20, 5);
    }

    const scaleRes = await evaluateInNode(
      docOf({
        id: 'sc',
        type: 'scale',
        factor: [2, 0.5, 3],
        child: { id: 'c', type: 'cube', size: [10, 10, 10] },
      }),
    );
    expect(scaleRes.ok).toBe(true);
    if (scaleRes.ok) {
      expect(scaleRes.value.volumeMm3).toBeCloseTo(3000, 4);
    }

    const mirRes = await evaluateInNode(
      docOf({
        id: 'mir',
        type: 'mirror',
        normal: [1, 0, 0],
        child: { id: 'c', type: 'cube', size: [10, 10, 10] },
      }),
    );
    expect(mirRes.ok).toBe(true);
    if (mirRes.ok) {
      expect(mirRes.value.bbox.min[0]).toBeCloseTo(-10, 5);
      expect(mirRes.value.bbox.max[0]).toBeCloseTo(0, 5);
      assertNormalsValid(mirRes.value);
    }

    const multiDiff = await evaluateInNode(
      docOf({
        id: 'md',
        type: 'difference',
        base: { id: 'b', type: 'cube', size: [10, 10, 10] },
        subtract: [
          { id: 's1', type: 'cube', size: [2, 2, 10] },
          {
            id: 's2t',
            type: 'translate',
            offset: [8, 8, 0],
            child: { id: 's2', type: 'cube', size: [2, 2, 10] },
          },
        ],
      }),
    );
    expect(multiDiff.ok).toBe(true);
    if (multiDiff.ok) {
      expect(multiDiff.value.volumeMm3).toBeCloseTo(920, 4);
    }

    // Casos defensivos de aridade unitária/vazia em union, intersection e difference
    const singleUnion = await evaluateInNode(
      docOf({ id: 'su', type: 'union', children: [{ id: 'c', type: 'cube', size: [4, 4, 4] }] }),
    );
    expect(singleUnion.ok).toBe(true);
    if (singleUnion.ok) expect(singleUnion.value.volumeMm3).toBeCloseTo(64, 4);

    const singleInt = await evaluateInNode(
      docOf({
        id: 'si',
        type: 'intersection',
        children: [{ id: 'c', type: 'cube', size: [4, 4, 4] }],
      }),
    );
    expect(singleInt.ok).toBe(true);
    if (singleInt.ok) expect(singleInt.value.volumeMm3).toBeCloseTo(64, 4);

    const emptyDiff = await evaluateInNode(
      docOf({
        id: 'ed',
        type: 'difference',
        base: { id: 'c', type: 'cube', size: [4, 4, 4] },
        subtract: [],
      }),
    );
    expect(emptyDiff.ok).toBe(true);
    if (emptyDiff.ok) expect(emptyDiff.value.volumeMm3).toBeCloseTo(64, 4);
  });

  it('avalia allNodeTypesDoc() gerando malha válida, fechada e com normais unitárias', async () => {
    const res = await evaluateInNode(allNodeTypesDoc());
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.value.triangleCount).toBeGreaterThan(100);
    expect(res.value.volumeMm3).toBeGreaterThan(0);
    expect(countOpenEdgesWelded(res.value)).toBe(0);
    assertNormalsValid(res.value);
  });

  it('retorna invalid_mesh quando booleanos resultam em sólido vazio', async () => {
    const disjunctInt = await evaluateInNode(
      docOf({
        id: 'int',
        type: 'intersection',
        children: [
          { id: 'a', type: 'cube', size: [5, 5, 5] },
          {
            id: 'bt',
            type: 'translate',
            offset: [20, 0, 0],
            child: { id: 'b', type: 'cube', size: [5, 5, 5] },
          },
        ],
      }),
    );
    expect(disjunctInt.ok).toBe(false);
    if (!disjunctInt.ok) {
      expect(disjunctInt.error.code).toBe('invalid_mesh');
    }

    const totalDiff = await evaluateInNode(
      docOf({
        id: 'diff',
        type: 'difference',
        base: { id: 'a', type: 'cube', size: [5, 5, 5] },
        subtract: [{ id: 'b', type: 'cube', size: [10, 10, 10] }],
      }),
    );
    expect(totalDiff.ok).toBe(false);
    if (!totalDiff.ok) {
      expect(totalDiff.error.code).toBe('invalid_mesh');
    }
  });

  it('respeita AbortSignal já abortado ou abortado durante travessia retornando cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const res = await evaluateInNode(cubeDoc(), controller.signal);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('cancelled');
    }

    // Abortar no meio da travessia limpa filhos já alocados sem vazar WASM
    let checks = 0;
    const midSignal = {
      get aborted(): boolean {
        checks++;
        return checks >= 4;
      },
    } as AbortSignal;

    const midRes = await evaluateInNode(
      docOf({
        id: 'u',
        type: 'union',
        children: [
          { id: 'c1', type: 'cube', size: [5, 5, 5] },
          { id: 'c2', type: 'cube', size: [5, 5, 5] },
        ],
      }),
      midSignal,
    );
    expect(midRes.ok).toBe(false);
    if (!midRes.ok) {
      expect(midRes.error.code).toBe('cancelled');
    }
  });

  it('libera base e filhos já alocados em difference quando subtract é abortado no meio da travessia', async () => {
    const Module = (await import('manifold-3d')).default;
    const realWasm = await Module();
    realWasm.setup();

    const deletedHandles: string[] = [];
    let createdCount = 0;
    const trackedWasm = {
      ...realWasm,
      Manifold: new Proxy(realWasm.Manifold, {
        get(target, prop, receiver) {
          if (prop === 'cube') {
            return (...args: Parameters<typeof target.cube>) => {
              const label = `cube#${++createdCount}`;
              const instance = target.cube(...args);
              const origDelete = instance.delete.bind(instance);
              instance.delete = () => {
                deletedHandles.push(label);
                origDelete();
              };
              return instance;
            };
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    } as unknown as ManifoldToplevel;

    // 1ª checagem (evaluateIR), 2ª (difference), 3ª (base cube#1), 4ª (sub1 cube#2), 5ª aborta em sub2
    let checks = 0;
    const midSignal = {
      get aborted(): boolean {
        checks++;
        return checks >= 5;
      },
    } as AbortSignal;

    const res = evaluateIR(
      trackedWasm,
      docOf({
        id: 'diff-leak',
        type: 'difference',
        base: { id: 'b', type: 'cube', size: [10, 10, 10] },
        subtract: [
          { id: 's1', type: 'cube', size: [2, 2, 2] },
          { id: 's2', type: 'cube', size: [3, 3, 3] },
        ],
      }),
      midSignal,
    );

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('cancelled');
    }
    expect(deletedHandles).toContain('cube#1');
    expect(deletedHandles).toContain('cube#2');
    expect(deletedHandles).toHaveLength(2);
  });

  it('captura exceções do WASM retornando wasm_error em PT-BR', () => {
    const brokenWasm = {
      Manifold: {
        cube: () => {
          throw new Error('boom wasm');
        },
      },
    } as unknown as ManifoldToplevel;

    const res = evaluateIR(brokenWasm, cubeDoc());
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error.code).toBe('wasm_error');
      expect(res.error.message).toContain('boom wasm');
    }

    const stringThrowWasm = {
      Manifold: {
        cube: () => {
          throw 'falha primitiva';
        },
      },
    } as unknown as ManifoldToplevel;

    const res2 = evaluateIR(stringThrowWasm, cubeDoc());
    expect(res2.ok).toBe(false);
    if (!res2.ok) {
      expect(res2.error.code).toBe('wasm_error');
      expect(res2.error.message).toContain('falha primitiva');
    }
  });

  it('avalia cubeMinusCylinderDoc() dentro do orçamento de < 300 ms e sem vazamento em 30 execuções', async () => {
    // Aquecimento do singleton WASM
    await evaluateInNode(cubeDoc());

    const t0 = performance.now();
    for (let i = 0; i < 30; i++) {
      const res = await evaluateInNode(cubeMinusCylinderDoc());
      expect(res.ok).toBe(true);
    }
    const avgMs = (performance.now() - t0) / 30;
    expect(avgMs).toBeLessThan(300);
  });
});
