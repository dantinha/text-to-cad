import Module from 'manifold-3d';
import type { ManifoldToplevel } from 'manifold-3d';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MeshData } from '@/core/contracts';
import { extractMeshData } from '@/kernel/mesh';

let wasm: ManifoldToplevel;

beforeAll(async () => {
  wasm = await Module();
  wasm.setup();
});

/** Conta arestas abertas (com contagem != 2) soldando vértices por posição. */
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
      const edgeKey = u < v ? `${u}_${v}` : `${v}_${u}`;
      edges.set(edgeKey, (edges.get(edgeKey) ?? 0) + 1);
    }
  }

  let open = 0;
  for (const count of edges.values()) {
    if (count !== 2) open++;
  }
  return open;
}

function assertValidUnitNormals(mesh: MeshData): void {
  expect(mesh.normals.length).toBe(mesh.positions.length);
  expect(mesh.positions.length % 3).toBe(0);
  for (let i = 0; i < mesh.normals.length; i += 3) {
    const nx = mesh.normals[i] ?? Number.NaN;
    const ny = mesh.normals[i + 1] ?? Number.NaN;
    const nz = mesh.normals[i + 2] ?? Number.NaN;
    expect(Number.isFinite(nx)).toBe(true);
    expect(Number.isFinite(ny)).toBe(true);
    expect(Number.isFinite(nz)).toBe(true);
    const len = Math.hypot(nx, ny, nz);
    expect(len).toBeCloseTo(1, 4);
  }
}

describe('extractMeshData', () => {
  it('extrai MeshData válida de um cubo centrado com normais unitárias e malha fechada', () => {
    const cube = wasm.Manifold.cube([10, 10, 10], true);
    try {
      const result = extractMeshData(cube);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const mesh = result.value;
      expect(mesh.positions).toBeInstanceOf(Float32Array);
      expect(mesh.normals).toBeInstanceOf(Float32Array);
      expect(mesh.indices).toBeInstanceOf(Uint32Array);
      expect(mesh.triangleCount).toBe(12);
      expect(mesh.indices.length).toBe(36);
      expect(mesh.volumeMm3).toBeCloseTo(1000, 4);
      expect(mesh.bbox.min).toEqual([-5, -5, -5]);
      expect(mesh.bbox.max).toEqual([5, 5, 5]);
      assertValidUnitNormals(mesh);
      expect(countOpenEdgesWelded(mesh)).toBe(0);

      // Todas as normais do cubo centrado devem apontar para fora: dot(pos, normal) > 0
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const dot =
          (mesh.positions[i] ?? 0) * (mesh.normals[i] ?? 0) +
          (mesh.positions[i + 1] ?? 0) * (mesh.normals[i + 1] ?? 0) +
          (mesh.positions[i + 2] ?? 0) * (mesh.normals[i + 2] ?? 0);
        expect(dot).toBeGreaterThan(0);
      }
    } finally {
      cube.delete();
    }
  });

  it('mantém normais apontando para fora após mirror', () => {
    const mirrored = wasm.Manifold.cube([10, 10, 10], true).mirror([1, 0, 0]);
    try {
      const result = extractMeshData(mirrored);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const mesh = result.value;
      assertValidUnitNormals(mesh);
      expect(countOpenEdgesWelded(mesh)).toBe(0);
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const dot =
          (mesh.positions[i] ?? 0) * (mesh.normals[i] ?? 0) +
          (mesh.positions[i + 1] ?? 0) * (mesh.normals[i + 1] ?? 0) +
          (mesh.positions[i + 2] ?? 0) * (mesh.normals[i + 2] ?? 0);
        expect(dot).toBeGreaterThan(0);
      }
    } finally {
      mirrored.delete();
    }
  });

  it('gera normais suaves compartilhadas em superfícies curvas como esfera', () => {
    const sphere = wasm.Manifold.sphere(10, 32);
    try {
      const result = extractMeshData(sphere);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const mesh = result.value;
      assertValidUnitNormals(mesh);
      expect(countOpenEdgesWelded(mesh)).toBe(0);

      // Não deve duplicar todos os vértices por triângulo em superfície suave
      const vertexCount = mesh.positions.length / 3;
      expect(vertexCount).toBeLessThan(mesh.triangleCount * 3);

      // Em esfera centrada na origem, a normal suave deve alinhar com o vetor radial
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const px = mesh.positions[i] ?? 0;
        const py = mesh.positions[i + 1] ?? 0;
        const pz = mesh.positions[i + 2] ?? 0;
        const r = Math.hypot(px, py, pz);
        const dot =
          (px / r) * (mesh.normals[i] ?? 0) +
          (py / r) * (mesh.normals[i + 1] ?? 0) +
          (pz / r) * (mesh.normals[i + 2] ?? 0);
        expect(dot).toBeGreaterThan(0.95);
      }
    } finally {
      sphere.delete();
    }
  });

  it('retorna invalid_mesh em PT-BR para sólido vazio (diferença total)', () => {
    const small = wasm.Manifold.cube([2, 2, 2], true);
    const big = wasm.Manifold.cube([10, 10, 10], true);
    const empty = small.subtract(big);
    try {
      const result = extractMeshData(empty);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_mesh');
      expect(result.error.message.length).toBeGreaterThan(5);
    } finally {
      small.delete();
      big.delete();
      empty.delete();
    }
  });

  it('retorna invalid_mesh para construção inválida (status != NoError)', () => {
    const cw = wasm.Manifold.extrude(
      [
        [
          [0, 0],
          [0, 10],
          [10, 0],
        ],
      ],
      5,
    );
    try {
      const result = extractMeshData(cw);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_mesh');
    } finally {
      cw.delete();
    }
  });

  it('retorna invalid_mesh para mirror com normal nula', () => {
    const invalid = wasm.Manifold.cube([10, 10, 10]).mirror([0, 0, 0]);
    try {
      const result = extractMeshData(invalid);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error.code).toBe('invalid_mesh');
    } finally {
      invalid.delete();
    }
  });
});
