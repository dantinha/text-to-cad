import type { z } from 'zod';
import type { IRIssue, IRIssueCode, Result } from '../contracts';
import type { IR } from './types';
import { MAX_DEPTH, MAX_NODES } from './limits';
import { irDocumentSchema, NODE_TYPES } from './schema';

type PathSegment = string | number;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const formatPath = (segments: readonly PathSegment[]): string =>
  segments.reduce<string>(
    (acc, s) => (typeof s === 'number' ? `${acc}[${s}]` : acc ? `${acc}.${s}` : s),
    '',
  );

const issue = (path: readonly PathSegment[], code: IRIssueCode, message: string): IRIssue => ({
  path: formatPath(path),
  code,
  message,
});

/**
 * Passada estrutural sobre a entrada *crua*, antes do Zod: limita nós e profundidade,
 * detecta ciclos e ids duplicados sem risco de estourar a pilha (a recursão para em MAX_DEPTH).
 */
function inspectStructure(doc: unknown): { issues: IRIssue[]; blocking: boolean } {
  const issues: IRIssue[] = [];
  if (!isRecord(doc)) return { issues, blocking: false };

  let count = 0;
  let blocking = false;
  const seenIds = new Set<string>();
  const ancestors = new Set<object>();

  const visit = (node: unknown, path: readonly PathSegment[], depth: number): void => {
    if (blocking || !isRecord(node)) return;
    if (ancestors.has(node)) {
      issues.push(issue(path, 'ciclo', 'Referência circular: um nó não pode conter a si mesmo.'));
      blocking = true;
      return;
    }
    if (depth > MAX_DEPTH) {
      issues.push(
        issue(path, 'limite_profundidade', `Profundidade máxima da árvore é ${MAX_DEPTH} níveis.`),
      );
      blocking = true;
      return;
    }
    count += 1;
    if (count > MAX_NODES) {
      issues.push(issue(path, 'limite_nos', `O modelo pode ter no máximo ${MAX_NODES} nós.`));
      blocking = true;
      return;
    }
    const id = node['id'];
    if (typeof id === 'string') {
      if (seenIds.has(id)) {
        issues.push(
          issue([...path, 'id'], 'id_duplicado', `O id "${id}" já foi usado em outro nó.`),
        );
      } else {
        seenIds.add(id);
      }
    }
    ancestors.add(node);
    for (const key of ['child', 'base'] as const) visit(node[key], [...path, key], depth + 1);
    for (const key of ['children', 'subtract'] as const) {
      const list = node[key];
      if (Array.isArray(list)) list.forEach((c, i) => visit(c, [...path, key, i], depth + 1));
    }
    ancestors.delete(node);
  };

  visit(doc['root'], ['root'], 1);
  return { issues, blocking };
}

const TYPE_NAMES: Readonly<Record<string, string>> = {
  number: 'número',
  string: 'texto',
  boolean: 'verdadeiro/falso',
  array: 'lista',
  object: 'objeto',
  int: 'número inteiro',
};

const valueAt = (input: unknown, path: readonly PropertyKey[]): unknown =>
  path.reduce<unknown>(
    (acc, key) =>
      isRecord(acc) || Array.isArray(acc) ? (acc as Record<PropertyKey, unknown>)[key] : undefined,
    input,
  );

function mapZodIssue(z0: z.core.$ZodIssue, input: unknown): IRIssue {
  const path = z0.path.filter((p): p is PathSegment => typeof p !== 'symbol');
  const joined = formatPath(path);

  if (joined === 'schemaVersion') {
    return issue(path, 'schema_version', 'Versão de schema não suportada: use schemaVersion 1.');
  }
  if (joined === 'units') {
    return issue(path, 'unidade_invalida', 'Unidade inválida: o IR usa sempre "mm".');
  }

  switch (z0.code) {
    case 'invalid_type': {
      const value = valueAt(input, z0.path);
      if (value === undefined)
        return issue(path, 'campo_obrigatorio', 'Campo obrigatório ausente.');
      if (typeof value === 'number' && !Number.isFinite(value)) {
        return issue(path, 'valor_invalido', 'Número inválido (NaN ou infinito).');
      }
      return issue(
        path,
        'tipo_invalido',
        `Tipo inválido: esperado ${TYPE_NAMES[z0.expected] ?? z0.expected}.`,
      );
    }
    case 'invalid_union':
      return issue(
        path,
        'tipo_invalido',
        `Tipo de nó desconhecido. Tipos válidos: ${NODE_TYPES.join(', ')}.`,
      );
    case 'too_small':
      return issue(
        path,
        'valor_fora_do_limite',
        z0.origin === 'number'
          ? `Valor abaixo do mínimo permitido (${String(z0.minimum)}).`
          : z0.origin === 'string'
            ? `Poucos caracteres: o mínimo é ${String(z0.minimum)}.`
            : `Poucos itens: o mínimo é ${String(z0.minimum)}.`,
      );
    case 'too_big':
      return issue(
        path,
        'valor_fora_do_limite',
        z0.origin === 'number'
          ? `Valor acima do máximo permitido (${String(z0.maximum)}).`
          : z0.origin === 'string'
            ? `Texto muito longo: o máximo é ${String(z0.maximum)} caracteres.`
            : `Itens demais: o máximo é ${String(z0.maximum)}.`,
      );
    case 'unrecognized_keys':
      return issue(path, 'campo_desconhecido', `Campo(s) desconhecido(s): ${z0.keys.join(', ')}.`);
    case 'invalid_format':
      return issue(path, 'formato_invalido', 'Formato inválido para este campo.');
    case 'invalid_value':
      return issue(
        path,
        'valor_invalido',
        `Valor não permitido. Esperado: ${z0.values.map(String).join(', ')}.`,
      );
    case 'custom':
      return issue(path, 'valor_invalido', z0.message);
    default:
      return issue(path, 'valor_invalido', 'Valor inválido.');
  }
}

/** Valida dados não confiáveis (IA, histórico, JSON do usuário) e devolve um IR tipado. */
export function validateIR(input: unknown): Result<IR, readonly IRIssue[]> {
  const structure = inspectStructure(input);
  if (structure.blocking) return { ok: false, error: structure.issues };

  const parsed = irDocumentSchema.safeParse(input);
  if (parsed.success && structure.issues.length === 0) return { ok: true, value: parsed.data };

  const zodIssues = parsed.success ? [] : parsed.error.issues.map((i) => mapZodIssue(i, input));
  return { ok: false, error: [...structure.issues, ...zodIssues] };
}
