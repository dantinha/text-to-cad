import type { Manifold } from 'manifold-3d';
import type { KernelError, MeshData, Result, Vec3 } from '@/core/contracts';
import { err, ok } from '@/core/result';

const DEFAULT_CREASE_ANGLE_DEG = 35;
const COS_CREASE_THRESHOLD = Math.cos((DEFAULT_CREASE_ANGLE_DEG * Math.PI) / 180);
const NORMAL_MATCH_DOT = 0.9999;

interface CreasedBuffers {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly indices: Uint32Array;
}

const invalidMesh = (message: string): Result<never, KernelError> =>
  err({ code: 'invalid_mesh', message });

const at = (arr: ArrayLike<number>, index: number): number => arr[index] ?? 0;

function computeFaceNormals(
  vertProps: Float32Array,
  triVerts: Uint32Array,
  numTri: number,
  stride: number,
): { faceNormals: Float64Array; unitNormals: Float64Array } {
  const faceNormals = new Float64Array(numTri * 3);
  const unitNormals = new Float64Array(numTri * 3);

  for (let t = 0; t < numTri; t++) {
    const i0 = at(triVerts, t * 3) * stride;
    const i1 = at(triVerts, t * 3 + 1) * stride;
    const i2 = at(triVerts, t * 3 + 2) * stride;

    const p0x = at(vertProps, i0);
    const p0y = at(vertProps, i0 + 1);
    const p0z = at(vertProps, i0 + 2);

    const ux = at(vertProps, i1) - p0x;
    const uy = at(vertProps, i1 + 1) - p0y;
    const uz = at(vertProps, i1 + 2) - p0z;

    const vx = at(vertProps, i2) - p0x;
    const vy = at(vertProps, i2 + 1) - p0y;
    const vz = at(vertProps, i2 + 2) - p0z;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz);

    const o = t * 3;
    if (len > 1e-12 && Number.isFinite(len)) {
      faceNormals[o] = nx;
      faceNormals[o + 1] = ny;
      faceNormals[o + 2] = nz;
      unitNormals[o] = nx / len;
      unitNormals[o + 1] = ny / len;
      unitNormals[o + 2] = nz / len;
    } else {
      unitNormals[o] = 0;
      unitNormals[o + 1] = 0;
      unitNormals[o + 2] = 1;
    }
  }

  return { faceNormals, unitNormals };
}

function buildVertexAdjacency(
  triVerts: Uint32Array,
  numVert: number,
  numTri: number,
): { offsets: Uint32Array; vertTris: Uint32Array } {
  const counts = new Uint32Array(numVert);
  for (let k = 0; k < numTri * 3; k++) {
    const v = at(triVerts, k);
    counts[v] = at(counts, v) + 1;
  }

  const offsets = new Uint32Array(numVert + 1);
  for (let v = 0; v < numVert; v++) {
    offsets[v + 1] = at(offsets, v) + at(counts, v);
  }

  const cursor = new Uint32Array(offsets.subarray(0, numVert));
  const vertTris = new Uint32Array(numTri * 3);
  for (let t = 0; t < numTri; t++) {
    for (let c = 0; c < 3; c++) {
      const v = at(triVerts, t * 3 + c);
      const pos = at(cursor, v);
      vertTris[pos] = t;
      cursor[v] = pos + 1;
    }
  }

  return { offsets, vertTris };
}

function buildCreasedBuffers(
  vertProps: Float32Array,
  triVerts: Uint32Array,
  numVert: number,
  numTri: number,
  stride: number,
): CreasedBuffers {
  const { faceNormals, unitNormals } = computeFaceNormals(vertProps, triVerts, numTri, stride);
  const { offsets, vertTris } = buildVertexAdjacency(triVerts, numVert, numTri);

  const maxVerts = numTri * 3;
  const outPos = new Float32Array(maxVerts * 3);
  const outNorm = new Float32Array(maxVerts * 3);
  const outIndices = new Uint32Array(numTri * 3);

  const firstOut = new Int32Array(numVert).fill(-1);
  const extraVerts = new Map<number, number[]>();
  let outCount = 0;

  const matchesNormal = (outIdx: number, nx: number, ny: number, nz: number): boolean => {
    const o = outIdx * 3;
    const dot = at(outNorm, o) * nx + at(outNorm, o + 1) * ny + at(outNorm, o + 2) * nz;
    return dot >= NORMAL_MATCH_DOT;
  };

  const emitVertex = (srcVert: number, nx: number, ny: number, nz: number): number => {
    const idx = outCount++;
    const s = srcVert * stride;
    const o = idx * 3;
    outPos[o] = at(vertProps, s);
    outPos[o + 1] = at(vertProps, s + 1);
    outPos[o + 2] = at(vertProps, s + 2);
    outNorm[o] = nx;
    outNorm[o + 1] = ny;
    outNorm[o + 2] = nz;
    return idx;
  };

  for (let t = 0; t < numTri; t++) {
    const to = t * 3;
    const unx = at(unitNormals, to);
    const uny = at(unitNormals, to + 1);
    const unz = at(unitNormals, to + 2);

    for (let c = 0; c < 3; c++) {
      const cornerIdx = to + c;
      const v = at(triVerts, cornerIdx);
      const start = at(offsets, v);
      const end = at(offsets, v + 1);

      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (let p = start; p < end; p++) {
        const t2 = at(vertTris, p);
        const t2o = t2 * 3;
        const dot =
          unx * at(unitNormals, t2o) +
          uny * at(unitNormals, t2o + 1) +
          unz * at(unitNormals, t2o + 2);
        if (dot >= COS_CREASE_THRESHOLD) {
          sx += at(faceNormals, t2o);
          sy += at(faceNormals, t2o + 1);
          sz += at(faceNormals, t2o + 2);
        }
      }

      const len = Math.hypot(sx, sy, sz);
      const valid = len > 1e-12 && Number.isFinite(len);
      const nx = valid ? sx / len : unx;
      const ny = valid ? sy / len : uny;
      const nz = valid ? sz / len : unz;

      const first = at(firstOut, v);
      if (first === -1) {
        const created = emitVertex(v, nx, ny, nz);
        firstOut[v] = created;
        outIndices[cornerIdx] = created;
        continue;
      }

      if (matchesNormal(first, nx, ny, nz)) {
        outIndices[cornerIdx] = first;
        continue;
      }

      let extras = extraVerts.get(v);
      let matched = -1;
      if (extras) {
        for (const candidate of extras) {
          if (matchesNormal(candidate, nx, ny, nz)) {
            matched = candidate;
            break;
          }
        }
      }

      if (matched !== -1) {
        outIndices[cornerIdx] = matched;
      } else {
        const created = emitVertex(v, nx, ny, nz);
        if (!extras) {
          extras = [];
          extraVerts.set(v, extras);
        }
        extras.push(created);
        outIndices[cornerIdx] = created;
      }
    }
  }

  return {
    positions: outPos.slice(0, outCount * 3),
    normals: outNorm.slice(0, outCount * 3),
    indices: outIndices,
  };
}

/**
 * Extrai e valida `MeshData` a partir de um `Manifold` avaliado.
 * Garante malha não vazia, volume positivo, bbox finito e normais unitárias com arestas nítidas.
 */
export function extractMeshData(manifold: Manifold): Result<MeshData, KernelError> {
  const status = manifold.status();
  if (status !== 'NoError') {
    return invalidMesh(`A geometria gerada é inválida (status: ${status}).`);
  }

  if (manifold.isEmpty() || manifold.numTri() === 0) {
    return invalidMesh('O modelo resultou em um sólido vazio (nenhum triângulo gerado).');
  }

  const volumeMm3 = manifold.volume();
  if (!Number.isFinite(volumeMm3) || volumeMm3 <= 0) {
    return invalidMesh('O modelo resultou em um sólido com volume inválido ou nulo.');
  }

  const rawBox = manifold.boundingBox();
  const min: Vec3 = [rawBox.min[0], rawBox.min[1], rawBox.min[2]];
  const max: Vec3 = [rawBox.max[0], rawBox.max[1], rawBox.max[2]];
  if (![...min, ...max].every((n) => Number.isFinite(n))) {
    return invalidMesh('A caixa delimitadora do modelo contém valores não finitos.');
  }

  const rawMesh = manifold.getMesh();
  const numTri = rawMesh.numTri;
  const numVert = rawMesh.numVert;

  const { positions, normals, indices } = buildCreasedBuffers(
    rawMesh.vertProperties,
    rawMesh.triVerts,
    numVert,
    numTri,
    rawMesh.numProp,
  );

  return ok({
    positions,
    normals,
    indices,
    bbox: { min, max },
    volumeMm3,
    triangleCount: numTri,
  });
}
