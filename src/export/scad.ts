import { emitScad, type IR } from '@/core';

/** Exporta um documento IR como `Blob` OpenSCAD (`.scad`, UTF-8). */
export function exportScadBlob(ir: IR): Blob {
  return new Blob([emitScad(ir)], { type: 'text/plain;charset=utf-8' });
}
