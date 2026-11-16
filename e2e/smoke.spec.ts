import { expect, test } from '@playwright/test';
import type { IRDocument } from '../src/core/ir/types';
import { CadEditorPage } from './pages/CadEditorPage';

const DEMO_SESSION_HEADER = 'sessao-demo-usuario-local';

const INVALID_AI_IR = {
  schemaVersion: 1,
  units: 'mm',
  name: 'Cubo inválido',
  root: {
    id: 'cubo-invalido',
    type: 'cube',
    size: [-10, 20, 20],
  },
};

const VALID_AI_IR: IRDocument = {
  schemaVersion: 1,
  units: 'mm',
  name: 'Cubo com furo IA',
  root: {
    id: 'peca-ia',
    type: 'difference',
    label: 'Cubo com furo',
    base: { id: 'bloco', type: 'cube', size: [40, 30, 20], center: true },
    subtract: [{ id: 'furo', type: 'cylinder', height: 40, radius: 5, segments: 64, center: true }],
  },
};

interface CapturedGeminiRequestBody {
  readonly prompt?: string;
  readonly repair?: {
    readonly previousJson?: string;
    readonly issues?: readonly {
      readonly path: string;
      readonly code: string;
      readonly message: string;
    }[];
  };
}

test.describe('M3/M4 — Presets Paramétricos, Exportação STL e /lab', () => {
  test('seleciona preset, ajusta slider, renderiza em 3D e exporta arquivo .stl binário válido', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const editor = new CadEditorPage(page);
    await editor.goto();
    await expect(editor.appTitle).toHaveText('Text-to-CAD');
    await expect(editor.appStatus).toContainText('M4');

    // Aguarda avaliação inicial do primeiro preset (Suporte em L)
    await expect(editor.viewportMetrics).toBeVisible({ timeout: 15_000 });
    await expect(editor.canvas).toBeVisible();
    await expect(editor.dimLabelX).toContainText('X 60,0 mm');

    // Troca para Flange com Furação e ajusta o diâmetro externo via slider
    await editor.selectPreset('flange');
    await expect(editor.dimLabelX).toContainText('X 100,0 mm', { timeout: 10_000 });
    await expect(editor.inspectorCode).toContainText('Flange com furação');

    await editor.setSliderParam('diametroExterno', '140');
    await expect(editor.dimLabelX).toContainText('X 140,0 mm', { timeout: 10_000 });

    // Alterna os 4 modos de renderização sem erro
    for (const mode of ['wireframe', 'clay', 'xray', 'solid'] as const) {
      await editor.setRenderMode(mode);
    }

    // Exporta .STL binário e valida o formato real dos bytes baixados
    await editor.exportStlAndAssertBinary('Flange-com-Furacao.stl');

    // Navega para /lab e confirma que todos os 4 presets avaliam e exibem métricas
    await editor.navLab.click();
    await expect(editor.labPage).toBeVisible();
    for (const id of ['suporte-l', 'flange', 'caixa-divisorias', 'bucha']) {
      const card = page.getByTestId(`lab-card-${id}`);
      await expect(card).toBeVisible();
      await expect(card.getByTestId('viewport-metrics')).toBeVisible({ timeout: 20_000 });
    }

    expect(errors).toEqual([]);
  });
});

test.describe('M4 — Geração por IA (proxy /api/gemini mockado), BYOK e reparo', () => {
  test('executa loop de reparo, envia x-user-key (somente sessionStorage), renderiza/exporta STL e trata erro 429 + 503 real', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    const editor = new CadEditorPage(page);
    await editor.goto();
    await expect(editor.appStatus).toContainText('M4');
    await expect(editor.viewportMetrics).toBeVisible({ timeout: 15_000 });
    await expect(editor.canvas).toBeVisible();

    // Configura chave BYOK e confirma armazenamento exclusivo em sessionStorage
    await editor.setByokKey(DEMO_SESSION_HEADER);
    const storageSnapshot = await page.evaluate(() => ({
      sessionByok: window.sessionStorage.getItem('text-to-cad:byok-gemini-key'),
      localKeys: Object.keys(window.localStorage),
    }));
    expect(storageSnapshot.sessionByok).toBe(DEMO_SESSION_HEADER);
    expect(storageSnapshot.localKeys).toEqual([]);

    // Intercepta /api/gemini para exercitar 1ª falha de validação -> repair loop -> sucesso
    let callCount = 0;
    const capturedUserKeys: Array<string | undefined> = [];
    const capturedBodies: CapturedGeminiRequestBody[] = [];

    await page.route('**/api/gemini', async (route) => {
      callCount += 1;
      const req = route.request();
      capturedUserKeys.push(req.headers()['x-user-key']);
      capturedBodies.push(req.postDataJSON() as CapturedGeminiRequestBody);

      if (callCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json; charset=utf-8',
          body: JSON.stringify({
            ok: true,
            text: JSON.stringify(INVALID_AI_IR),
            model: 'gemini-2.5-flash',
          }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: true,
          text: JSON.stringify(VALID_AI_IR),
          model: 'gemini-2.5-flash',
        }),
      });
    });

    await editor.submitAiPrompt('Cubo 40x30x20 mm com furo central de 10 mm');

    await expect(editor.aiFeedback).toContainText('Modelo gerado pela IA e validado.', {
      timeout: 15_000,
    });
    expect(callCount).toBe(2);
    expect(capturedUserKeys).toEqual([DEMO_SESSION_HEADER, DEMO_SESSION_HEADER]);
    expect(capturedBodies[0]?.repair).toBeUndefined();
    expect(capturedBodies[1]?.repair?.previousJson).toBe(JSON.stringify(INVALID_AI_IR));
    expect(capturedBodies[1]?.repair?.issues?.length).toBeGreaterThan(0);

    // Valida renderização 3D da peça gerada pela IA e inspeção SCAD + IR
    await expect(editor.viewportMetrics).toBeVisible({ timeout: 15_000 });
    await expect(editor.canvas).toBeVisible();
    await expect(editor.dimLabelX).toContainText('X 40,0 mm', { timeout: 10_000 });

    await expect(editor.inspectorCode).toContainText('difference()');
    await expect(editor.inspectorCode).toContainText('cylinder(');

    await editor.tabIr.click();
    await expect(editor.inspectorCode).toContainText('Cubo com furo IA');
    await editor.tabScad.click();

    // Exporta .STL binário válido do modelo gerado pela IA
    await editor.exportStlAndAssertBinary('Cubo-com-furo-IA.stl');

    // Testa cenário de erro amigável (HTTP 429 com chave fake que deve ser sanitizada)
    await page.unroute('**/api/gemini');
    const mockRedactionFixture = ['AIza', 'SyFakeLeakFixture99999'].join('');
    await page.route('**/api/gemini', async (route) => {
      await route.fulfill({
        status: 429,
        contentType: 'application/json; charset=utf-8',
        body: JSON.stringify({
          ok: false,
          error: {
            code: 'rate_limited',
            message: `Limite atingido para ${mockRedactionFixture}.`,
          },
        }),
      });
    });

    await editor.submitAiPrompt('Flange simples 60 mm');
    await expect(editor.aiFeedback).toHaveAttribute('role', 'alert', { timeout: 10_000 });
    await expect(editor.aiFeedback).toContainText('[REDACTED]');
    await expect(editor.aiFeedback).toContainText(
      'Simplifique o prompt ou escolha um preset abaixo.',
    );
    await expect(editor.aiFeedback).not.toContainText(mockRedactionFixture);
    await expect(editor.canvas).toBeVisible();

    await page.unroute('**/api/gemini');

    // Requisição real (sem mock!) sem chave no .env.local deve devolver HTTP 503 JSON seguro
    const realProxyRes = await page.request.post('http://localhost:5173/api/gemini', {
      headers: { 'Content-Type': 'application/json' },
      data: { prompt: 'Cubo 20 mm' },
    });
    expect(realProxyRes.status()).toBe(503);
    expect(realProxyRes.headers()['content-type']).toContain('application/json');
    const rawBody = await realProxyRes.text();
    expect(rawBody).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/);
    const parsedBody = JSON.parse(rawBody) as {
      ok: boolean;
      error?: { code?: string; message?: string };
    };
    expect(parsedBody.ok).toBe(false);
    expect(parsedBody.error?.code).toBe('missing_api_key');

    expect(errors).toEqual([]);
  });
});
