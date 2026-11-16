import { describe, expect, it } from 'vitest';
import { irJsonSchema } from '@/core/ir/json-schema';
import { err, ok } from '@/core/result';
import { validateIR } from '@/core/ir/validate';
import { MAX_NODES } from '@/core/ir/limits';
import { allNodeTypesDoc, cubeDoc, cubeMinusCylinderDoc } from '../fixtures/ir';
import { meshBytes, unitCubeMesh } from '../fixtures/mesh';

describe('result helpers', () => {
  it('ok e err constroem as duas variantes', () => {
    expect(ok(1)).toEqual({ ok: true, value: 1 });
    expect(err('x')).toEqual({ ok: false, error: 'x' });
  });
});

describe('irJsonSchema', () => {
  const schema = irJsonSchema() as Record<string, unknown>;

  it('é JSON puro (serializável) e descreve o documento', () => {
    expect(() => JSON.stringify(schema)).not.toThrow();
    const props = schema['properties'] as Record<string, unknown>;
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['schemaVersion', 'units', 'root']));
  });

  it('descreve os 13 tipos de nó pelo discriminador "type"', () => {
    const text = JSON.stringify(schema);
    for (const t of [
      'cube',
      'cylinder',
      'sphere',
      'cone',
      'torus',
      'extrude',
      'translate',
      'rotate',
      'scale',
      'mirror',
      'union',
      'intersection',
      'difference',
    ]) {
      expect(text).toContain(`"const":"${t}"`);
    }
  });

  it('expressa a recursão com referências (sem expandir infinitamente)', () => {
    expect(JSON.stringify(schema)).toContain('$ref');
    expect(JSON.stringify(schema).length).toBeLessThan(60_000);
  });

  it('não vaza o limite estrutural de nós (validado só no validateIR)', () => {
    expect(JSON.stringify(schema)).not.toContain(String(MAX_NODES));
  });
});

describe('fixtures compartilhadas', () => {
  it('todos os documentos de fixture são válidos', () => {
    for (const doc of [cubeDoc(), cubeMinusCylinderDoc(), allNodeTypesDoc()]) {
      expect(validateIR(doc).ok).toBe(true);
    }
  });

  it('malha-mock do cubo: 12 triângulos, volume s³ e bbox corretos', () => {
    const m = unitCubeMesh(10);
    expect(m.triangleCount).toBe(12);
    expect(m.indices.length).toBe(36);
    expect(m.volumeMm3).toBe(1000);
    expect(m.bbox).toEqual({ min: [-5, -5, -5], max: [5, 5, 5] });
    expect(m.positions.length).toBe(m.normals.length);
  });

  it('malha-mock é fechada: cada aresta (vértices soldados por posição) tem 2 triângulos', () => {
    const { indices, positions } = unitCubeMesh(10);
    const pos = (i: number) =>
      [0, 1, 2].map((k) => (positions[i * 3 + k] as number).toFixed(4)).join(',');
    const edges = new Map<string, number>();
    for (let i = 0; i < indices.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const a = pos(indices[i + k] as number);
        const b = pos(indices[i + ((k + 1) % 3)] as number);
        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    expect([...edges.values()].every((n) => n === 2)).toBe(true);
  });

  it('meshBytes soma os buffers transferíveis', () => {
    const m = unitCubeMesh(10);
    expect(meshBytes(m)).toBe(m.positions.byteLength + m.normals.byteLength + m.indices.byteLength);
  });
});
