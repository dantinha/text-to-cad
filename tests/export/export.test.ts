import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BufferGeometry } from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import type { MeshData } from '@/core/contracts';
import { validateIR } from '@/core/ir/validate';
import { emitScad } from '@/core/scad/emit';
import {
  encodeBinaryStl,
  exportIrJsonBlob,
  exportScadBlob,
  exportStl,
  sanitizeFilename,
  triggerBlobDownload,
} from '@/export';
import { evaluateInNode } from '@/kernel';
import { allNodeTypesDoc, cubeDoc, cubeMinusCylinderDoc } from '../fixtures/ir';
import { unitCubeMesh } from '../fixtures/mesh';

/** Calcula o volume assinado de uma BufferGeometry lida pelo STLLoader: 1/6 * sum(v0 . (v1 x v2)). */
function signedVolumeFromGeometry(geometry: BufferGeometry): number {
  const pos = geometry.getAttribute('position');
  if (!pos) return 0;

  let sum = 0;
  for (let i = 0; i < pos.count; i += 3) {
    const x0 = pos.getX(i);
    const y0 = pos.getY(i);
    const z0 = pos.getZ(i);

    const x1 = pos.getX(i + 1);
    const y1 = pos.getY(i + 1);
    const z1 = pos.getZ(i + 1);

    const x2 = pos.getX(i + 2);
    const y2 = pos.getY(i + 2);
    const z2 = pos.getZ(i + 2);

    const cx = y1 * z2 - z1 * y2;
    const cy = z1 * x2 - x1 * z2;
    const cz = x1 * y2 - y1 * x2;
    sum += x0 * cx + y0 * cy + z0 * cz;
  }
  return sum / 6;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('exportStl / encodeBinaryStl', () => {
  it('gera buffer STL binário com header de 80 bytes, contagem uint32 e 50 bytes por triângulo', async () => {
    const mesh = unitCubeMesh(10);
    const buffer = encodeBinaryStl(mesh);
    expect(buffer.byteLength).toBe(84 + mesh.triangleCount * 50);

    const headerText = new TextDecoder('ascii').decode(new Uint8Array(buffer, 0, 80));
    expect(headerText.toLowerCase().startsWith('solid ')).toBe(false);
    expect(headerText).toContain('Text-to-CAD');

    const view = new DataView(buffer);
    expect(view.getUint32(80, true)).toBe(mesh.triangleCount);

    for (let t = 0; t < mesh.triangleCount; t++) {
      expect(view.getUint16(84 + t * 50 + 48, true)).toBe(0);
    }

    const blob = exportStl(mesh);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('model/stl');
    expect(blob.size).toBe(84 + mesh.triangleCount * 50);

    const parsed = new STLLoader().parse(await blob.arrayBuffer());
    const pos = parsed.getAttribute('position');
    const norm = parsed.getAttribute('normal');
    expect(pos.count).toBe(mesh.triangleCount * 3);
    expect(norm.count).toBe(mesh.triangleCount * 3);
    for (let i = 0; i < norm.count; i++) {
      const len = Math.hypot(norm.getX(i), norm.getY(i), norm.getZ(i));
      expect(len).toBeCloseTo(1, 5);
    }
    expect(signedVolumeFromGeometry(parsed)).toBeCloseTo(1000, 4);
  });

  it('exporta malha real do kernel (cubeMinusCylinderDoc) preservando volume dentro de ±0,5%', async () => {
    const evaluated = await evaluateInNode(cubeMinusCylinderDoc());
    expect(evaluated.ok).toBe(true);
    if (!evaluated.ok) return;

    const mesh = evaluated.value;
    const blob = exportStl(mesh);
    const parsed = new STLLoader().parse(await blob.arrayBuffer());

    const pos = parsed.getAttribute('position');
    expect(pos.count).toBe(mesh.triangleCount * 3);

    const stlVolume = signedVolumeFromGeometry(parsed);
    const relError = Math.abs(stlVolume - mesh.volumeMm3) / mesh.volumeMm3;
    expect(relError).toBeLessThanOrEqual(0.005);
  });

  it('usa normal fallback [0, 0, 1] para triângulo degenerado sem produzir NaN', async () => {
    const degenerate: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 2, 0, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2]),
      bbox: { min: [0, 0, 0], max: [2, 0, 0] },
      volumeMm3: 1,
      triangleCount: 1,
    };

    const parsed = new STLLoader().parse(await exportStl(degenerate).arrayBuffer());
    const norm = parsed.getAttribute('normal');
    expect(norm.getX(0)).toBeCloseTo(0, 6);
    expect(norm.getY(0)).toBeCloseTo(0, 6);
    expect(norm.getZ(0)).toBeCloseTo(1, 6);
  });

  it('lança erro em PT-BR para malha vazia, índices insuficientes ou índice fora dos limites', () => {
    const empty: MeshData = {
      positions: new Float32Array(0),
      normals: new Float32Array(0),
      indices: new Uint32Array(0),
      bbox: { min: [0, 0, 0], max: [0, 0, 0] },
      volumeMm3: 0,
      triangleCount: 0,
    };
    expect(() => exportStl(empty)).toThrow(/malha vazia/i);

    const shortIndices: MeshData = {
      ...unitCubeMesh(1),
      indices: new Uint32Array([0, 1, 2]),
      triangleCount: 12,
    };
    expect(() => exportStl(shortIndices)).toThrow(/insuficientes/i);

    const badIndex: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 99]),
      bbox: { min: [0, 0, 0], max: [1, 1, 0] },
      volumeMm3: 1,
      triangleCount: 1,
    };
    expect(() => exportStl(badIndex)).toThrow(/fora dos limites/i);
  });
});

describe('exportScadBlob / exportIrJsonBlob', () => {
  it('exportScadBlob gera Blob texto com saída idêntica a emitScad(ir)', async () => {
    const doc = cubeMinusCylinderDoc();
    const blob = exportScadBlob(doc);
    expect(blob.type).toBe('text/plain;charset=utf-8');
    expect(await blob.text()).toBe(emitScad(doc));
  });

  it('exportIrJsonBlob gera Blob JSON válido que passa em validateIR (roundtrip)', async () => {
    const doc = allNodeTypesDoc();
    const blob = exportIrJsonBlob(doc);
    expect(blob.type).toBe('application/json;charset=utf-8');

    const text = await blob.text();
    expect(text.endsWith('\n')).toBe(true);
    const parsed: unknown = JSON.parse(text);
    const validated = validateIR(parsed);
    expect(validated).toEqual({ ok: true, value: doc });
  });

  it('funciona com documento mínimo cubeDoc()', async () => {
    const doc = cubeDoc();
    const jsonText = await exportIrJsonBlob(doc).text();
    expect(JSON.parse(jsonText)).toEqual(doc);
  });
});

describe('sanitizeFilename / triggerBlobDownload', () => {
  it('normaliza acentos, remove caracteres inválidos e aplica fallback quando vazio', () => {
    expect(sanitizeFilename('Peça Técnica (v1)', 'stl')).toBe('Peca-Tecnica-(v1).stl');
    expect(sanitizeFilename('suporte<>:"/\\|?*  final', 'scad')).toBe('suporte-final.scad');
    expect(sanitizeFilename('  a\x00b\x1fc  ', 'json')).toBe('abc.json');
    expect(sanitizeFilename('...---...', 'stl')).toBe('modelo-text-to-cad.stl');
    expect(sanitizeFilename(undefined, 'stl')).toBe('modelo-text-to-cad.stl');
    expect(sanitizeFilename('   ', 'json')).toBe('modelo-text-to-cad.json');
  });

  it('triggerBlobDownload cria ObjectURL, clica no link e faz cleanup seguro', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const appendChild = vi.fn();
    const fakeLink = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click,
      remove,
    };

    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => fakeLink),
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-123');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    const blob = new Blob(['test'], { type: 'text/plain' });
    triggerBlobDownload(blob, 'peca.stl');

    expect(createObjectURL).toHaveBeenCalledWith(blob);
    expect(fakeLink.href).toBe('blob:mock-123');
    expect(fakeLink.download).toBe('peca.stl');
    expect(appendChild).toHaveBeenCalledWith(fakeLink);
    expect(click).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-123');
  });

  it('triggerBlobDownload faz revokeObjectURL mesmo se click() lançar erro', () => {
    const remove = vi.fn();
    const fakeLink = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click: () => {
        throw new Error('click blocked');
      },
      remove,
    };

    vi.stubGlobal('document', {
      body: null,
      createElement: vi.fn(() => fakeLink),
    });
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-err');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    expect(() => triggerBlobDownload(new Blob(['x']), 'x.stl')).toThrow('click blocked');
    expect(remove).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-err');
  });
});
