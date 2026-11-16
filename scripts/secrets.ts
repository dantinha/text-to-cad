export interface SecretHit {
  readonly line: number;
  readonly rule: string;
  /** Início do trecho, mascarado: nunca o segredo completo. */
  readonly preview: string;
}

const RULES: ReadonlyArray<{ rule: string; pattern: RegExp }> = [
  { rule: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{30,}/ },
  { rule: 'google-ai-studio-token', pattern: /\bAQ\.[0-9A-Za-z_-]{20,}/ },
  {
    rule: 'gemini-key-assignment',
    pattern: /GEMINI_API_KEY\s*=\s*["']?(?!\$\{|<)[0-9A-Za-z_.-]{12,}/,
  },
];

const mask = (s: string): string => `${s.slice(0, 4)}…(${s.length} caracteres)`;

export function findSecrets(text: string): SecretHit[] {
  const hits: SecretHit[] = [];
  text.split(/\r?\n/).forEach((content, i) => {
    for (const { rule, pattern } of RULES) {
      const m = pattern.exec(content);
      if (m) {
        hits.push({ line: i + 1, rule, preview: mask(m[0]) });
        break;
      }
    }
  });
  return hits;
}

const SKIP =
  /(^|\/)(node_modules|dist|coverage)\/|package-lock\.json$|\.(png|jpe?g|gif|webp|ico|woff2?|stl|wasm|zip)$/i;
export const isScannable = (path: string): boolean => !SKIP.test(path.replaceAll('\\', '/'));
