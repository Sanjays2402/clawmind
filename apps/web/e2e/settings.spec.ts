import { test, expect } from '@playwright/test';

test('settings shows account, usage, and data controls', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // Sections always present once data loads or fails gracefully.
  await expect(page.getByText('Profile')).toBeVisible();
  await expect(page.getByText('Your data')).toBeVisible();
  // GDPR controls.
  await expect(page.getByRole('link', { name: /Export my data/i })).toBeVisible();
  await expect(page.getByLabel('Type DELETE to confirm')).toBeVisible();
});
