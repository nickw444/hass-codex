const { test, expect } = require('@playwright/test');
const base = 'http://127.0.0.1:18173/api/hassio_ingress/codex_remote';

test('loads through Home Assistant ingress', async ({ page }) => {
  const failures = [];
  page.on('console', (message) => { if (message.type() === 'error' && !message.text().includes('Failed to load resource')) failures.push(`console: ${message.text()}`); });
  page.on('requestfailed', (request) => { failures.push(`request: ${request.url()} ${request.failure()?.errorText ?? ''}`); });
  page.on('response', (response) => { if (response.status() >= 400 && !response.url().includes('/api/')) failures.push(`response: ${response.status()} ${response.url()}`); });
  await page.goto(`${base}/`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText('Codex WebUI')).toBeVisible();
  await expect(page.getByText('Codex Unavailable')).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('upstream source')).toBeVisible();
  await page.screenshot({ path: '/tmp/codex-webui-poc.png', fullPage: true });
  expect(failures, failures.join('\n')).toEqual([]);
});

test('refreshes a nested ingress route', async ({ page }) => {
  await page.goto(`${base}/settings`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
