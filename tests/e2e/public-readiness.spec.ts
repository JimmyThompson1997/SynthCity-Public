import { expect, test, type Page } from '@playwright/test';

function monitorPublicRuntime(page: Page, allowedOrigin: string) {
  const problems: string[] = [];
  const externalRequests: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => {
    problems.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`);
  });
  page.on('request', (request) => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== allowedOrigin) {
      externalRequests.push(request.url());
    }
  });

  return { problems, externalRequests };
}

test('keeps the playable city and Asset Library same-origin and error-free', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required.');
  const runtime = monitorPublicRuntime(page, new URL(baseURL).origin);

  await page.goto('/design-review/square-grid-mayor.html?profile=city&city=public-readiness-smoke&seed=20260816');
  await expect(page.locator('.city-client')).toBeVisible();
  await expect(page).toHaveTitle('SynthCity');

  await page.goto('/design-review/asset-library.html');
  await expect(page.getByRole('heading', { name: /asset library/i })).toBeVisible();

  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.problems).toEqual([]);
});

test('retired private visual fixtures fall back to the playable city', async ({ page, baseURL }) => {
  if (!baseURL) throw new Error('Playwright baseURL is required.');
  const runtime = monitorPublicRuntime(page, new URL(baseURL).origin);
  const requestedUrls: string[] = [];
  page.on('request', (request) => requestedUrls.push(request.url()));

  await page.goto('/design-review/square-grid-mayor.html?profile=city&city=public-retired-art-fixture&seed=20260817&fixture=art-pipeline', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.city-client')).not.toHaveAttribute('data-art-pipeline', 'true');
  await expect(page.getByRole('region', { name: 'Visual art pipeline test tools' })).toHaveCount(0);
  expect(await page.evaluate(() => {
    const bridge = (window as unknown as { squareGridMayor?: Record<string, unknown> }).squareGridMayor;
    return typeof bridge?.artPipelineSnapshot;
  })).toBe('undefined');

  await page.goto('/design-review/square-grid-mayor.html?profile=city&city=public-retired-bake-fixture&seed=20260817&fixture=bake-rotation-lab', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.city-client')).not.toHaveAttribute('data-rotation-fixture', 'true');
  await expect(page.locator('.bake-rotation-fixture')).toHaveCount(0);
  expect(await page.evaluate(() => {
    const bridge = (window as unknown as {
      squareGridMayor?: { rotationFixtureSnapshot?: () => { active: boolean; bakeAssets: unknown[] } };
    }).squareGridMayor;
    return bridge?.rotationFixtureSnapshot?.();
  })).toEqual({ active: false, kind: null, park: null, bakeAssets: [] });

  expect(requestedUrls.filter((url) => url.includes('/art-pipeline/'))).toEqual([]);
  expect(runtime.externalRequests).toEqual([]);
  expect(runtime.problems).toEqual([]);
});
