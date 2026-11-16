import { getByokKey } from '@/ai';
import { validateIR, type IRDocument } from '@/core';
import type { ParamValues } from '@/presets';

export const HISTORY_STORAGE_KEY = 'text-to-cad:history:v1';
export const MAX_HISTORY_ITEMS = 20;
const MAX_SNAPSHOT_FIELD_CHARS = 5000;
const MAX_DISPLAY_FIELD_CHARS = 1000;

export type HistorySource = 'preset' | 'ai';

export interface ModelSnapshot {
  readonly id: string;
  readonly source: HistorySource;
  readonly label: string;
  readonly promptOrPresetId: string;
  readonly presetParams?: ParamValues | undefined;
  readonly doc: IRDocument;
  readonly createdAt: string;
}

function getSafeLocalStorage(): Storage | null {
  try {
    if (typeof window === 'undefined') {
      return null;
    }
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Remove possíveis padrões de chaves API Gemini (AIza..., AQ....) e a chave BYOK atual. */
export function redactSensitiveText(text: string): string {
  let clean = text
    .replace(/AIza[0-9A-Za-z_-]{8,}/g, '[REDACTED]')
    .replace(/\bAQ\.[0-9A-Za-z_-]{8,}/g, '[REDACTED]');

  const byok = getByokKey().trim();
  if (byok.length >= 6) {
    clean = clean.split(byok).join('[REDACTED]');
  }
  return clean;
}

function sanitizeSnapshot(snapshot: ModelSnapshot): ModelSnapshot {
  const safeDoc: IRDocument =
    typeof snapshot.doc.name === 'string'
      ? {
          ...snapshot.doc,
          name: redactSensitiveText(snapshot.doc.name).slice(0, MAX_DISPLAY_FIELD_CHARS),
        }
      : snapshot.doc;

  return {
    ...snapshot,
    label: redactSensitiveText(snapshot.label).slice(0, MAX_DISPLAY_FIELD_CHARS),
    promptOrPresetId: redactSensitiveText(snapshot.promptOrPresetId).slice(
      0,
      MAX_DISPLAY_FIELD_CHARS,
    ),
    presetParams: snapshot.presetParams ? { ...snapshot.presetParams } : undefined,
    doc: safeDoc,
  };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePresetParams(raw: unknown): ParamValues | undefined {
  if (raw === undefined) return undefined;
  if (!isPlainRecord(raw)) return undefined;
  const parsed: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== 'number' || !Number.isFinite(val)) {
      return undefined;
    }
    parsed[key] = val;
  }
  return parsed;
}

function parseSnapshot(raw: unknown): ModelSnapshot | null {
  if (!isPlainRecord(raw)) return null;
  const id = raw['id'];
  const source = raw['source'];
  const label = raw['label'];
  const promptOrPresetId = raw['promptOrPresetId'];
  const createdAt = raw['createdAt'];
  const rawDoc = raw['doc'];

  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    id.length > MAX_SNAPSHOT_FIELD_CHARS ||
    (source !== 'preset' && source !== 'ai') ||
    typeof label !== 'string' ||
    label.length > MAX_SNAPSHOT_FIELD_CHARS ||
    typeof promptOrPresetId !== 'string' ||
    promptOrPresetId.length > MAX_SNAPSHOT_FIELD_CHARS ||
    typeof createdAt !== 'string' ||
    createdAt.length > MAX_SNAPSHOT_FIELD_CHARS
  ) {
    return null;
  }

  const presetParams = parsePresetParams(raw['presetParams']);
  if (raw['presetParams'] !== undefined && presetParams === undefined) {
    return null;
  }

  const validated = validateIR(rawDoc);
  if (!validated.ok) {
    return null;
  }

  return sanitizeSnapshot({
    id,
    source,
    label,
    promptOrPresetId,
    presetParams,
    doc: validated.value,
    createdAt,
  });
}

/** Gera um identificador único para uma entrada de histórico. */
export function createSnapshotId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Lê e valida o histórico salvo no `localStorage`, descartando entradas inválidas. */
export function loadHistory(): ModelSnapshot[] {
  const storage = getSafeLocalStorage();
  if (!storage) return [];

  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    const validItems: ModelSnapshot[] = [];
    for (const entry of parsed) {
      const item = parseSnapshot(entry);
      if (item) {
        validItems.push(item);
        if (validItems.length >= MAX_HISTORY_ITEMS) {
          break;
        }
      }
    }
    return validItems;
  } catch {
    return [];
  }
}

/** Persiste o histórico sanitizado no `localStorage`, respeitando o limite de 20 itens. */
export function saveHistory(items: readonly ModelSnapshot[]): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    const safeItems = items.slice(0, MAX_HISTORY_ITEMS).map(sanitizeSnapshot);
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(safeItems));
  } catch {
    // Storage indisponível ou cota excedida: falha silenciosamente sem quebrar a UI.
  }
}

/**
 * Retorna um novo array imutável com o item no topo, evitando duplicar se o topo
 * atual possuir exatamente o mesmo IR serializado e truncando em 20 itens.
 */
export function pushHistoryItem(
  items: readonly ModelSnapshot[],
  candidate: ModelSnapshot,
): ModelSnapshot[] {
  const sanitized = sanitizeSnapshot(candidate);
  const top = items[0];
  if (top && JSON.stringify(top.doc) === JSON.stringify(sanitized.doc)) {
    return items.slice(0, MAX_HISTORY_ITEMS);
  }
  return [sanitized, ...items].slice(0, MAX_HISTORY_ITEMS);
}

/** Remove o histórico persistido no `localStorage`. */
export function clearHistory(): void {
  const storage = getSafeLocalStorage();
  if (!storage) return;

  try {
    storage.removeItem(HISTORY_STORAGE_KEY);
  } catch {
    // Ignora silenciosamente.
  }
}
