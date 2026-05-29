import { test, expect } from '@playwright/test';
test('chat composer is visible', async ({ page }) => {
  await page.goto('/chat');
  await expect(page.getByPlaceholder(/Ask anything/)).toBeVisible();
});
