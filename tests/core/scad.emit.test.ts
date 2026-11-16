import { describe, expect, expectTypeOf, it } from 'vitest';
import type { EmitScad, IRDocument } from '@/core/contracts';
import { emitScad } from '@/core/scad';
import { emitScad as emitScadDirect } from '@/core/scad/emit';
import { allNodeTypesDoc, cubeDoc, cubeMinusCylinderDoc } from '../fixtures/ir';

describe('emitScad: contrato e reexportação', () => {
  it('satisfaz a assinatura EmitScad e é reexportado em core/scad', () => {
    expectTypeOf(emitScad).toEqualTypeOf<EmitScad>();
    expect(emitScad).toBe(emitScadDirect);
  });
});

describe('emitScad: snapshots das fixtures', () => {
  it('emite cubeDoc() corretamente', () => {
    expect(emitScad(cubeDoc())).toMatchInlineSnapshot(`
      "// Modelo: Cubo
      // Unidade: mm | Eixo Z para cima

      cube([10, 10, 10], center = false);
      "
    `);
  });

  it('emite cubeMinusCylinderDoc() corretamente', () => {
    expect(emitScad(cubeMinusCylinderDoc())).toMatchInlineSnapshot(`
      "// Modelo: Cubo com furo
      // Unidade: mm | Eixo Z para cima

      // Peça com furo
      difference() {
        cube([40, 30, 20], center = true);
        cylinder(h = 40, r = 5, center = true, $fn = 128);
      }
      "
    `);
  });

  it('emite allNodeTypesDoc() com todos os 13 tipos de nó', () => {
    expect(emitScad(allNodeTypesDoc())).toMatchInlineSnapshot(`
      "// Unidade: mm | Eixo Z para cima

      union() {
        color("#aabbcc") cube([10, 10, 10], center = false);
        cylinder(h = 10, r = 3, center = true, $fn = 32);
        sphere(r = 4, $fn = 32);
        cylinder(h = 8, r1 = 4, r2 = 0, center = false);
        rotate_extrude() translate([10, 0, 0]) circle(r = 2);
        linear_extrude(height = 5, center = false) polygon(points = [[0, 0], [10, 0], [0, 10]]);
        translate([5, 0, 0]) {
          cube([10, 10, 10], center = false);
        }
        rotate([0, 0, 45]) {
          cube([10, 10, 10], center = false);
        }
        scale([2, 1, 1]) {
          cube([10, 10, 10], center = false);
        }
        mirror([1, 0, 0]) {
          cube([10, 10, 10], center = false);
        }
        difference() {
          cube([10, 10, 10], center = false);
          cube([2, 2, 2], center = false);
        }
        intersection() {
          cube([10, 10, 10], center = false);
          cube([5, 5, 5], center = false);
        }
      }
      "
    `);
  });
});

describe('emitScad: nós, parâmetros, cores e labels', () => {
  it('emite segments ($fn) em cone, torus e sphere quando definidos', () => {
    const doc: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      root: {
        id: 'u',
        type: 'union',
        children: [
          { id: 'c', type: 'cone', height: 12, radius: 6, segments: 48, center: true },
          { id: 't', type: 'torus', majorRadius: 15, minorRadius: 3, segments: 64 },
          { id: 's', type: 'sphere', radius: 5 },
          {
            id: 'e',
            type: 'extrude',
            polygon: [
              [0, 0],
              [5, 0],
              [5, 5],
            ],
            height: 4,
            center: true,
          },
        ],
      },
    };

    expect(emitScad(doc)).toBe(
      [
        '// Unidade: mm | Eixo Z para cima',
        '',
        'union() {',
        '  cylinder(h = 12, r1 = 6, r2 = 0, center = true, $fn = 48);',
        '  rotate_extrude($fn = 64) translate([15, 0, 0]) circle(r = 3, $fn = 64);',
        '  sphere(r = 5);',
        '  linear_extrude(height = 4, center = true) polygon(points = [[0, 0], [5, 0], [5, 5]]);',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('envolve sub-árvore composta em color() { ... } e preserva label acima da cor', () => {
    const doc: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      root: {
        id: 'tr',
        type: 'translate',
        label: 'Bloco colorido',
        color: '#ff5500',
        offset: [10, 20, 30],
        child: {
          id: 'cb',
          type: 'cube',
          label: 'Cubo interno',
          color: '#00ffaa',
          size: [5, 6, 7],
        },
      },
    };

    expect(emitScad(doc)).toBe(
      [
        '// Unidade: mm | Eixo Z para cima',
        '',
        '// Bloco colorido',
        'color("#ff5500") {',
        '  translate([10, 20, 30]) {',
        '    // Cubo interno',
        '    color("#00ffaa") cube([5, 6, 7], center = false);',
        '  }',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('emite difference com base primeiro e todos os subtract em sequência', () => {
    const doc: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      root: {
        id: 'diff',
        type: 'difference',
        base: { id: 'b', type: 'cube', label: 'Base', size: [50, 50, 10] },
        subtract: [
          { id: 's1', type: 'cylinder', label: 'Furo 1', height: 20, radius: 3 },
          { id: 's2', type: 'cylinder', label: 'Furo 2', height: 20, radius: 4 },
        ],
      },
    };

    expect(emitScad(doc)).toBe(
      [
        '// Unidade: mm | Eixo Z para cima',
        '',
        'difference() {',
        '  // Base',
        '  cube([50, 50, 10], center = false);',
        '  // Furo 1',
        '  cylinder(h = 20, r = 3, center = false);',
        '  // Furo 2',
        '  cylinder(h = 20, r = 4, center = false);',
        '}',
        '',
      ].join('\n'),
    );
  });
});

describe('emitScad: sanitização, formatação numérica e determinismo', () => {
  it('sanitiza quebras de linha em name e label para evitar injeção de código', () => {
    const doc: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      name: 'Modelo\ncube([999, 999, 999]);\r\n// extra',
      root: {
        id: 'cubo',
        type: 'cube',
        label: 'Base\rsphere(999);\u2028union() {}',
        size: [10, 10, 10],
      },
    };

    const scad = emitScad(doc);
    const lines = scad.split('\n');

    expect(lines[0]).toBe('// Modelo: Modelo cube([999, 999, 999]); // extra');
    expect(lines[1]).toBe('// Unidade: mm | Eixo Z para cima');
    expect(lines[3]).toBe('// Base sphere(999); union() {}');
    expect(lines[4]).toBe('cube([10, 10, 10], center = false);');
    expect(scad).not.toContain('\ncube([999');
    expect(scad).not.toContain('\nsphere(999');
  });

  it('formata números de forma determinística evitando -0 e ruído de ponto flutuante', () => {
    const doc: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      root: {
        id: 'tr',
        type: 'translate',
        offset: [-0, -0.00001, 0.1 + 0.2],
        child: {
          id: 'cb',
          type: 'cube',
          size: [10.123456, 20.5, 30],
        },
      },
    };

    expect(emitScad(doc)).toBe(
      [
        '// Unidade: mm | Eixo Z para cima',
        '',
        'translate([0, 0, 0.3]) {',
        '  cube([10.1235, 20.5, 30], center = false);',
        '}',
        '',
      ].join('\n'),
    );
  });

  it('é determinístico e não muta o documento de entrada', () => {
    const frozen = Object.freeze(JSON.parse(JSON.stringify(allNodeTypesDoc()))) as IRDocument;
    const first = emitScad(frozen);
    const second = emitScad(frozen);

    expect(first).toBe(second);
  });

  it('omite name e label vazios após sanitização e rejeita números não finitos', () => {
    const emptyMeta: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      name: '  \n\r\t  ',
      root: { id: 'c', type: 'cube', label: '\n  ', size: [10, 10, 10] },
    };

    expect(emitScad(emptyMeta)).toBe(
      ['// Unidade: mm | Eixo Z para cima', '', 'cube([10, 10, 10], center = false);', ''].join(
        '\n',
      ),
    );

    const badNum: IRDocument = {
      schemaVersion: 1,
      units: 'mm',
      root: { id: 's', type: 'sphere', radius: Number.NaN },
    };
    expect(() => emitScad(badNum)).toThrow(RangeError);
  });
});
