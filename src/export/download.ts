export type ExportExtension = 'stl' | 'scad' | 'json';

const DEFAULT_FILENAME = 'modelo-text-to-cad';
const FORBIDDEN_FILENAME_CHARS = new Set(['<', '>', ':', '"', '/', '\\', '|', '?', '*']);

function stripUnsafeChars(input: string): string {
  let out = '';
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f || FORBIDDEN_FILENAME_CHARS.has(ch)) {
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Sanitiza um nome base para download seguro em Windows/POSIX e anexa a extensão desejada.
 * Normaliza acentos, remove caracteres inválidos/controles, troca espaços por `-` e usa fallback se vazio.
 */
export function sanitizeFilename(baseName: string | undefined, ext: ExportExtension): string {
  const normalized = (baseName ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cleaned = stripUnsafeChars(normalized)
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');

  const stem = cleaned.length > 0 ? cleaned : DEFAULT_FILENAME;
  return `${stem}.${ext}`;
}

/** Dispara o download de um `Blob` no navegador com limpeza segura de `ObjectURL` e DOM. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  let link: HTMLAnchorElement | null = null;

  try {
    link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body?.appendChild(link);
    link.click();
  } finally {
    link?.remove();
    URL.revokeObjectURL(url);
  }
}
