import { irJsonSchema } from '../core';

const RECURSIVE_EDGE_KEYS = new Set(['child', 'children', 'base', 'subtract']);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function transformNode(value: unknown, relaxMinItems: boolean): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => transformNode(item, false));
  }
  if (!isPlainObject(value)) {
    return value;
  }

  // Regra do Gemini: objetos com $ref só podem manter chaves irmãs iniciadas com '$'.
  if ('$ref' in value) {
    const refOnly: Record<string, unknown> = {};
    for (const [key, propVal] of Object.entries(value)) {
      if (key.startsWith('$')) {
        refOnly[key] = transformNode(propVal, false);
      }
    }
    return refOnly;
  }

  const out: Record<string, unknown> = {};
  const properties = isPlainObject(value['properties']) ? value['properties'] : undefined;

  for (const [key, propVal] of Object.entries(value)) {
    if (key === '$schema') {
      continue;
    }

    if (key === 'minItems' && relaxMinItems && typeof propVal === 'number' && propVal >= 1) {
      continue;
    }

    if (key === 'required' && Array.isArray(propVal) && properties) {
      const filtered = propVal.filter(
        (reqKey) => typeof reqKey !== 'string' || !RECURSIVE_EDGE_KEYS.has(reqKey),
      );
      if (filtered.length > 0) {
        out[key] = filtered;
      }
      continue;
    }

    if (key === 'properties' && isPlainObject(propVal)) {
      const mappedProps: Record<string, unknown> = {};
      for (const [propName, propSchema] of Object.entries(propVal)) {
        mappedProps[propName] = transformNode(propSchema, RECURSIVE_EDGE_KEYS.has(propName));
      }
      out[key] = mappedProps;
      continue;
    }

    out[key] = transformNode(propVal, relaxMinItems);
  }

  return out;
}

/**
 * Deriva de `irJsonSchema()` um JSON Schema compatível com `responseJsonSchema` do Gemini:
 * remove `$schema`, elimina irmãos não-`$` de `$ref` e torna arestas recursivas opcionais.
 */
export function buildGeminiIrSchema(): Record<string, unknown> {
  const transformed = transformNode(irJsonSchema(), false);
  return isPlainObject(transformed) ? transformed : {};
}
