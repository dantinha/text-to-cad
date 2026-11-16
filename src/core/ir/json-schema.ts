import { z } from 'zod';
import { irDocumentSchema } from './schema';

/**
 * JSON Schema do IR, usado como `responseJsonSchema` no Structured Output do Gemini (M4).
 * A recursão sai como `$ref`/`$defs`. Limites estruturais (nós, profundidade, ids únicos)
 * não cabem em JSON Schema e são conferidos depois, por `validateIR`.
 */
export const irJsonSchema = (): Record<string, unknown> =>
  z.toJSONSchema(irDocumentSchema, { target: 'draft-2020-12', io: 'output' }) as Record<
    string,
    unknown
  >;
