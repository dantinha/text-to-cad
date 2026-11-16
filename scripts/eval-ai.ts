/**
 * Avaliação manual (M4): mede quantos de 10 prompts de referência em PT-BR
 * geram IR válido (`validateIR`) e avaliam com sucesso no kernel `manifold-3d`.
 *
 * Uso: npm run eval:ai
 * Requer GEMINI_API_KEY configurada em `.env.local` ou no ambiente (fora do Vite client).
 */
import { createServer, loadEnv } from 'vite';
import type * as coreModule from '../src/core';
import type { IR, IRIssue } from '../src/core/contracts';
import type * as evaluateModule from '../src/kernel/evaluate';
import type * as proxyModule from '../server/proxy-core';

const REFERENCE_PROMPTS: readonly string[] = [
  'Cubo de 40 mm de lado centralizado na origem',
  'Cilindro com diâmetro 30 mm e altura 50 mm com furo central de 10 mm',
  'Suporte em L com base 70x40 mm, altura 50 mm e espessura 6 mm com dois furos de fixação M5',
  'Flange circular de 100 mm de diâmetro e 8 mm de espessura com furo central de 32 mm e 6 furos periféricos',
  'Caixa organizadora retangular 120x80x35 mm com paredes de 3 mm e 2 divisórias internas',
  'Bucha espaçadora com diâmetro externo 28 mm, diâmetro interno 12 mm e comprimento 20 mm',
  'Anel toroidal com raio maior 35 mm e raio menor 6 mm',
  'Cone truncado ou cone sólido com base de raio 20 mm e altura 45 mm',
  'Placa de montagem retangular 90x60x5 mm com quatro furos nos cantos de diâmetro 6 mm',
  'Chaveta prismática extrudada hexagonal com raio aproximado de 18 mm e altura 12 mm',
];

async function runEval(): Promise<void> {
  const env = { ...process.env, ...loadEnv('development', process.cwd(), '') };
  const apiKey = env['GEMINI_API_KEY']?.trim() ?? '';
  if (!apiKey) {
    console.error(
      'eval:ai: GEMINI_API_KEY não configurada em .env.local nem no ambiente. Preencha a chave e tente novamente.',
    );
    process.exit(1);
  }

  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    optimizeDeps: { noDiscovery: true },
  });

  try {
    const core = (await server.ssrLoadModule('/src/core/index.ts')) as typeof coreModule;
    const kernel = (await server.ssrLoadModule('/src/kernel/evaluate.ts')) as typeof evaluateModule;
    const proxy = (await server.ssrLoadModule('/server/proxy-core.ts')) as typeof proxyModule;

    let validCount = 0;
    let evalCount = 0;

    for (let i = 0; i < REFERENCE_PROMPTS.length; i += 1) {
      const prompt = REFERENCE_PROMPTS[i];
      if (!prompt) continue;

      let lastJson = '';
      let lastIssues: readonly IRIssue[] = [];
      let validIr: IR | null = null;
      let attempts = 0;

      for (let attempt = 0; attempt <= 2; attempt += 1) {
        attempts += 1;
        const body =
          attempt === 0
            ? { prompt }
            : { prompt, repair: { previousJson: lastJson, issues: lastIssues } };

        const res = await proxy.handleGeminiProxyRequest({
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          rawBody: JSON.stringify(body),
          env: { GEMINI_API_KEY: apiKey, GEMINI_MODEL: env['GEMINI_MODEL'] },
          allowLocalhostOrigin: true,
        });

        if (!res.body.ok) {
          console.log(`[${i + 1}/10] FALHA proxy (${res.status}): ${res.body.error.message}`);
          break;
        }

        lastJson = res.body.text;
        try {
          const parsed: unknown = JSON.parse(lastJson);
          const checked = core.validateIR(parsed);
          if (checked.ok) {
            validIr = checked.value;
            break;
          }
          lastIssues = checked.error;
        } catch (err) {
          lastIssues = [
            {
              path: 'root',
              code: 'formato_invalido',
              message: err instanceof Error ? err.message : 'JSON inválido',
            },
          ];
        }
      }

      if (!validIr) {
        console.log(`[${i + 1}/10] INVÁLIDO após ${attempts} tentativa(s): "${prompt}"`);
        continue;
      }

      validCount += 1;
      const meshRes = await kernel.evaluateInNode(validIr);
      if (meshRes.ok) {
        evalCount += 1;
        console.log(
          `[${i + 1}/10] OK (${attempts}x) | ${meshRes.value.triangleCount} tri | ${meshRes.value.volumeMm3.toFixed(1)} mm³ | "${prompt}"`,
        );
      } else {
        console.log(`[${i + 1}/10] KERNEL FALHOU (${meshRes.error.message}) | "${prompt}"`);
      }
    }

    console.log(
      `\nResumo eval:ai -> IR válido: ${validCount}/${REFERENCE_PROMPTS.length} | Malha avaliada: ${evalCount}/${REFERENCE_PROMPTS.length}`,
    );
    if (validCount < 8) {
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

void runEval().catch((err: unknown) => {
  console.error(
    'eval:ai erro fatal:',
    err instanceof Error ? err.message : 'Falha inesperada na avaliação.',
  );
  process.exit(1);
});
