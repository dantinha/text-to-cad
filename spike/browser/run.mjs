// Roda: node spike/browser/run.mjs  (sobe o Vite em spike/browser e abre no Chromium headless)
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const server = await createServer({ root: 'spike/browser', server: { port: 5199, strictPort: true }, configFile: false, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('http://localhost:5199/');
  await page.waitForSelector('#out[data-done="1"]', { timeout: 30000 });
  const result = JSON.parse(await page.textContent('#out'));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) console.log('erros de console:', errors);
  const expected = 40 * 30 * 20 - Math.PI * 25 * 20;
  const okVol = Math.abs(result.volume - expected) / expected < 0.005;
  console.log(result.ok && okVol && result.genus === 1 ? 'SPIKE OK' : 'SPIKE FALHOU');
  process.exitCode = result.ok && okVol ? 0 : 1;
} finally {
  await browser.close();
  await server.close();
}
