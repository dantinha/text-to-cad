import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const skip = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', 'playwright-report']);
const walk = (d) =>
  readdirSync(d).flatMap((n) => {
    if (skip.has(n)) return [];
    const p = join(d, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });

const MOJI =
  /\u00c3[\u0080-\u00bf\u2018-\u203a\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u02c6\u02dc\u00a0-\u00bf]|\u00e2\u20ac|\u00c2[\u00a0-\u00bf]/g;

for (const f of walk('.')) {
  if (/\.(png|ico|wasm|stl)$/.test(f) || f.endsWith('package-lock.json')) continue;
  const buf = readFileSync(f);
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const moji = (buf.toString('utf8').match(MOJI) ?? []).length;
  if (bom || moji) console.log(`${bom ? 'BOM ' : '    '} moji=${String(moji).padStart(3)}  ${f}`);
}
