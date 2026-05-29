import { test, expect } from '@playwright/test';
test('landing renders headline', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Your notes, your code, answered.')).toBeVisible();
});
