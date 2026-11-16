import { describe, expect, it } from 'vitest';
import { irJsonSchema, NODE_TYPES } from '@/core';
import { buildGeminiIrSchema } from '@/ai/geminiSchema';

function walkSchema(
  node: unknown,
  visit: (obj: Record<string, unknown>, path: string) => void,
  path = '$',
): void {
  if (Array.isArray(node)) {
    node.forEach((item, index) => walkSchema(item, visit, `${path}[${index}]`));
    return;
  }
  if (typeof node === 'object' && node !== null) {
    const record = node as Record<string, unknown>;
    visit(record, path);
    for (const [key, value] of Object.entries(record)) {
      walkSchema(value, visit, `${path}.${key}`);
    }
  }
}

describe('buildGeminiIrSchema', () => {
  const originalSnapshot = JSON.stringify(irJsonSchema());
  const geminiSchema = buildGeminiIrSchema();

  it('remove $schema e gera schema serializável abaixo de 60 KB', () => {
    const serialized = JSON.stringify(geminiSchema);
    expect(geminiSchema['$schema']).toBeUndefined();
    expect(serialized).not.toContain('"$schema"');
    expect(serialized.length).toBeLessThan(60_000);
  });

  it('não muta o schema original retornado por irJsonSchema()', () => {
    expect(JSON.stringify(irJsonSchema())).toBe(originalSnapshot);
  });

  it('mantém todos os 13 tipos de nó do IR', () => {
    const serialized = JSON.stringify(geminiSchema);
    for (const nodeType of NODE_TYPES) {
      expect(serialized).toContain(`"${nodeType}"`);
    }
  });

  it('não deixa propriedades irmãs não-$ ao lado de $ref', () => {
    walkSchema(geminiSchema, (obj, path) => {
      if ('$ref' in obj) {
        const nonDollarKeys = Object.keys(obj).filter((k) => !k.startsWith('$'));
        expect(nonDollarKeys, `Irmãos não-$ inválidos em ${path}`).toEqual([]);
      }
    });
  });

  it('torna arestas recursivas opcionais e sem minItems >= 1 para compatibilidade com Gemini', () => {
    const recursiveKeys = new Set(['child', 'children', 'base', 'subtract']);
    let foundRecursiveEdge = false;

    walkSchema(geminiSchema, (obj, path) => {
      const props = obj['properties'];
      if (typeof props !== 'object' || props === null || Array.isArray(props)) return;

      const propRecord = props as Record<string, unknown>;
      const required = Array.isArray(obj['required']) ? (obj['required'] as unknown[]) : [];

      for (const key of recursiveKeys) {
        if (key in propRecord) {
          foundRecursiveEdge = true;
          expect(
            required,
            `Campo recursivo "${key}" não pode ser required em ${path}`,
          ).not.toContain(key);
          const propSchema = propRecord[key];
          if (typeof propSchema === 'object' && propSchema !== null && !Array.isArray(propSchema)) {
            const minItems = (propSchema as Record<string, unknown>)['minItems'];
            if (typeof minItems === 'number') {
              expect(minItems, `minItems recursivo inválido em ${path}.${key}`).toBe(0);
            }
          }
        }
      }
    });

    expect(foundRecursiveEdge).toBe(true);
  });

  it('preserva obrigatoriedade de campos não-recursivos essenciais como root, id e type', () => {
    expect(geminiSchema['required']).toEqual(
      expect.arrayContaining(['schemaVersion', 'units', 'root']),
    );
  });
});
