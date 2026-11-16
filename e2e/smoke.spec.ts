import { expect, test } from '@playwright/test';

test.describe('M2 — Pipeline CSG sem IA', () => {
  test('avalia o cubo com furo no Web Worker, renderiza no viewport e exibe código OpenSCAD', async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/');
    await expect(page.getByTestId('app-title')).toHaveText('Text-to-CAD');
    await expect(page.getByTestId('app-status')).toBeVisible();

    // Aguarda o kernel finalizar a avaliação do cubo 40x30x20 menos furo
    const metrics = page.getByTestId('viewport-metrics');
    await expect(metrics).toBeVisible({ timeout: 15_000 });
    await expect(metrics).toContainText('40');
    await expect(metrics).toContainText('30');
    await expect(metrics).toContainText('20');
    await expect(metrics).toContainText('22,43 cm³');

    // Etiquetas de cota X, Y e Z visíveis sobre o canvas
    await expect(page.getByTestId('dim-label-x')).toContainText('X 40,0 mm');
    await expect(page.getByTestId('dim-label-y')).toContainText('Y 30,0 mm');
    await expect(page.getByTestId('dim-label-z')).toContainText('Z 20,0 mm');

    // Canvas WebGL montado
    await expect(page.locator('canvas')).toBeVisible();

    // Código OpenSCAD gerado deterministicamente
    const code = page.getByTestId('inspector-code');
    await expect(code).toContainText('difference()');
    await expect(code).toContainText('cube([40, 30, 20], center = true);');
    await expect(code).toContainText('cylinder(h = 40, r = 5, center = true, $fn = 64);');

    // Alterna os 4 modos de renderização sem erro
    for (const mode of ['wireframe', 'clay', 'xray', 'solid'] as const) {
      const btn = page.getByTestId(`render-mode-${mode}`);
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
    }

    // Troca de modelo e alterna aba para IR (JSON)
    await page.getByTestId('demo-model-perfil-l').click();
    await expect(code).toContainText('linear_extrude(height = 20, center = true)');
    await page.getByTestId('tab-ir').click();
    await expect(code).toContainText('"type": "extrude"');

    expect(errors).toEqual([]);
  });
});
