/**
 * Varre arquivos versionados (ou só os staged, com --staged) atrás de chaves de API.
 * Uso: node scripts/check-secrets.ts [--staged]
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { findSecrets, isScannable } from './secrets.ts';

const staged = process.argv.includes('--staged');
const args = staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files'];
const files = execFileSync('git', args, { encoding: 'utf8' })
  .split('\n')
  .map((f) => f.trim())
  .filter((f) => f && isScannable(f));

let found = 0;
for (const file of files) {
  let text: string;
  try {
    text = staged
      ? execFileSync('git', ['show', `:${file}`], { encoding: 'utf8' })
      : readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  for (const hit of findSecrets(text)) {
    found += 1;
    console.error(`SEGREDO? ${file}:${hit.line} [${hit.rule}] ${hit.preview}`);
  }
}

if (found > 0) {
  console.error(`\n${found} possível(is) segredo(s). Remova, revogue a chave e use .env.local.`);
  process.exit(1);
}
console.log(`check-secrets: ${files.length} arquivos varridos, nenhum segredo.`);
