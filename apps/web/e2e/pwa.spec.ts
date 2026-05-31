import { test, expect } from '@playwright/test';

test('manifest is served with PWA fields', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.name).toBe('ClawMind');
  expect(body.start_url).toBe('/');
  expect(body.display).toBe('standalone');
  expect(Array.isArray(body.icons)).toBe(true);
  expect(body.icons.length).toBeGreaterThanOrEqual(2);
});

test('service worker file is served', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type'] || '').toMatch(/javascript/);
  const body = await res.text();
  expect(body).toContain('clawmind-shell');
});

test('offline shell page renders', async ({ page }) => {
  await page.goto('/offline');
  await expect(page.getByRole('heading', { name: /You are offline/i })).toBeVisible();
});

test('layout exposes manifest and theme color', async ({ page }) => {
  await page.goto('/');
  const manifest = page.locator('link[rel="manifest"]');
  await expect(manifest).toHaveAttribute('href', /manifest\.webmanifest/);
  const theme = page.locator('meta[name="theme-color"]');
  await expect(theme).toHaveAttribute('content', '#7c5cff');
});
