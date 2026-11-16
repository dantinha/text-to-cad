import type { ParamSpec, ParamValues } from './types';

export function round4(n: number): number {
  const rounded = Number(n.toFixed(4));
  return rounded === 0 ? 0 : rounded;
}

export function buildDefaultParams(specs: readonly ParamSpec[]): ParamValues {
  const result: Record<string, number> = {};
  for (const spec of specs) {
    result[spec.key] = spec.defaultValue;
  }
  return Object.freeze(result);
}

export function clampRange(value: number, min: number, max: number, integer = false): number {
  const hi = Math.max(min, max);
  const clamped = Math.min(hi, Math.max(min, value));
  const normalized = integer ? Math.round(clamped) : round4(clamped);
  return Math.min(hi, Math.max(min, normalized));
}

export function readClamped(values: ParamValues, spec: ParamSpec): number {
  const raw = values[spec.key];
  const candidate = typeof raw === 'number' && Number.isFinite(raw) ? raw : spec.defaultValue;
  return clampRange(candidate, spec.min, spec.max, spec.integer === true);
}
