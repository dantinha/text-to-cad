import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

test.describe('M3 — Presets Paramétricos, Exportação STL e /lab', () => {
  test('seleciona preset, ajusta slider, renderiza em 3D e exporta arquivo .stl binário válido', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.getByTestId('app-title')).toHaveText('Text-to-CAD');
    await expect(page.getByTestId('app-status')).toContainText('M3');

    // Aguarda avaliação inicial do primeiro preset (Suporte em L)
    const metrics = page.getByTestId('viewport-metrics');
    await expect(metrics).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('canvas')).toBeVisible();
    await expect(page.getByTestId('dim-label-x')).toContainText('X 60,0 mm');

    // Troca para Flange com Furação e ajusta o diâmetro externo via slider
    await page.getByTestId('preset-flange').click();
    await expect(page.getByTestId('dim-label-x')).toContainText('X 100,0 mm', { timeout: 10_000 });

    const code = page.getByTestId('inspector-code');
    await expect(code).toContainText('Flange com furação');

    const slider = page.getByTestId('param-slider-diametroExterno');
    await slider.fill('140');
    await slider.dispatchEvent('change');
    await expect(page.getByTestId('dim-label-x')).toContainText('X 140,0 mm', { timeout: 10_000 });

    // Alterna modos de renderização sem erro
    for (const mode of ['wireframe', 'clay', 'xray', 'solid'] as const) {
      const btn = page.getByTestId(`render-mode-${mode}`);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
    }

    // Exporta .STL binário e valida o formato real dos bytes baixados
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('export-stl').click(),
    ]);
    expect(download.suggestedFilename()).toBe('Flange-com-Furacao.stl');
    const filePath = await download.path();
    expect(filePath).toBeTruthy();
    if (filePath) {
      const buf = readFileSync(filePath);
      expect(buf.byteLength).toBeGreaterThan(84);
      const triCount = buf.readUInt32LE(80);
      expect(triCount).toBeGreaterThan(50);
      expect(buf.byteLength).toBe(84 + triCount * 50);
    }

    // Navega para /lab e confirma que todos os 4 presets avaliam e exibem métricas
    await page.getByTestId('nav-lab').click();
    await expect(page.getByTestId('lab-page')).toBeVisible();
    for (const id of ['suporte-l', 'flange', 'caixa-divisorias', 'bucha']) {
      const card = page.getByTestId(`lab-card-${id}`);
      await expect(card).toBeVisible();
      await expect(card.getByTestId('viewport-metrics')).toBeVisible({ timeout: 20_000 });
    }

    expect(errors).toEqual([]);
  });
});
