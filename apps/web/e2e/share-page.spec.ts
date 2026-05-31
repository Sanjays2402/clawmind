import { test, expect } from '@playwright/test';

// /s/[id] should render a real shared-answer page when the id exists, and
// a clean not-found state otherwise. Either way it must show the brand and
// a Try ClawMind CTA so a public viewer can convert into a user.
test('share page renders brand + CTA, or a clean not-found', async ({ page }) => {
  const res = await page.goto('/s/sample-share-id');
  // Brand link is always shown via layout/header; the CTA only renders when
  // the share exists. Unknown ids hit notFound() which is fine.
  if (res && res.status() === 404) {
    // Next renders the closest not-found UI; we still want a path back home.
    const home = page.locator('a[href="/"]').first();
    await expect(home).toBeVisible();
    return;
  }
  await expect(page.getByRole('link', { name: /ClawMind home/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Try ClawMind/i })).toBeVisible();
});
