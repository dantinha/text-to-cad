import type { IR } from '@/core/contracts';

/** Exporta um documento IR como `Blob` JSON formatado (UTF-8). */
export function exportIrJsonBlob(ir: IR): Blob {
  return new Blob([`${JSON.stringify(ir, null, 2)}\n`], {
    type: 'application/json;charset=utf-8',
  });
}
