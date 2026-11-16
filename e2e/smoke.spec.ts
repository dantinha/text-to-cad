import { expect, test } from '@playwright/test';

test('a fundação carrega e mostra o título', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('app-title')).toHaveText('Text-to-CAD');
  await expect(page.getByTestId('app-status')).toBeVisible();
});
