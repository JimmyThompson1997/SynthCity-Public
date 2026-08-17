import { expect, test } from '@playwright/test';

test('presents the source-only Asset Library with live and archived art', async ({ page }) => {
  const problems: string[] = [];
  const requestedUrls: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('request', (request) => requestedUrls.push(request.url()));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));

  await page.goto('/design-review/asset-library.html', { waitUntil: 'networkidle' });
  await expect(page.getByRole('heading', { name: 'SynthCity Asset Library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Live Game' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Concept Districts' })).toHaveCount(0);
  await expect(page.locator('[data-asset-status="concept"]')).toHaveCount(0);
  await expect(page.locator('[data-asset-id="live:network:subway"]')).toBeVisible();
  await expect(page.locator('[data-asset-id="live:facility:fire-station"]')).toBeVisible();
  await expect(page.locator('[data-asset-id="live:facility:police-station"]')).toBeVisible();
  await expect(page.locator('[data-asset-status="live"]')).toHaveCount(22);
  await expect(page.getByRole('button', { name: 'Load more' })).toHaveCount(0);
  await expect(page.locator('[data-asset-id="live:facility:fire-station"] [data-facility-kind="fire-station"]'))
    .toHaveAttribute('data-world-recipe-id', 'facility:fire-station:v2');
  await expect.poll(() => page.evaluate(() => {
    const drawer = document.querySelector('aside[aria-label="Compare assets"]');
    return drawer ? drawer.getBoundingClientRect().left >= window.innerWidth : false;
  })).toBe(true);
  for (const legacyControl of ['Shortlist', 'Keep', 'Prune', 'Export JSON']) {
    await expect(page.getByRole('button', { name: legacyControl, exact: true })).toHaveCount(0);
  }

  await page.locator('[data-asset-id="live:facility:fire-station"]').click();
  const inspector = page.locator('aside[aria-label="Asset inspector"]');
  await expect(inspector).toContainText('Fire Station');
  await expect(inspector).toContainText('Service radius: 21 Manhattan tiles');
  await expect(inspector).toContainText('Requires road access');

  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page.locator('[data-asset-id="visual:police-station"]')).toHaveCount(0);
  await expect(page.locator('[data-asset-id="visual:health-clinic"]')).toBeVisible();
  await expect(page.locator('[data-asset-id="visual:health-clinic"]')).toHaveAttribute('data-asset-status', 'visual-only');

  await page.getByRole('button', { name: 'Close asset inspector' }).click();
  await page.getByRole('button', { name: 'Compare', exact: true }).click();
  const compare = page.locator('aside[aria-label="Compare assets"]');
  await expect(compare).toHaveAttribute('aria-hidden', 'false');
  await page.locator('[data-asset-status="visual-only"]').first().click();
  await page.locator('[data-asset-status="visual-only"]').nth(1).click();
  await expect(compare).toBeVisible();
  await expect(compare.locator('.compare-slot').first()).toContainText('VISUAL ONLY');
  await page.getByRole('button', { name: 'Close compare' }).click();
  await expect(compare).toHaveAttribute('aria-hidden', 'true');
  await expect(compare).not.toHaveClass(/\bopen\b/);

  expect(requestedUrls.filter((url) => url.includes('/asset-library/concepts/'))).toEqual([]);
  expect(requestedUrls.filter((url) => url.includes('/art-pipeline/'))).toEqual([]);
  expect(problems).toEqual([]);
});

test('switches the global Fire Station visual default without changing the gameplay facility', async ({ page }) => {
  await page.addInitScript(() => localStorage.removeItem('synthcity.asset-visual-selections.v1'));
  await page.goto('/design-review/asset-library.html', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Civic', exact: true }).click();

  const classic = page.locator('[data-asset-id="live:facility:fire-station"]');
  const modern = page.locator('[data-asset-id="live:facility:fire-station:modern-test"]');
  await expect(classic).toHaveAttribute('data-activation-state', 'active');
  await expect(modern).toHaveAttribute('data-activation-state', 'inactive');
  await modern.click();
  const inspector = page.locator('aside[aria-label="Asset inspector"]');
  await expect(inspector).toContainText('Fire Station — Modern Test');
  await page.getByRole('button', { name: 'Make Live', exact: true }).click();
  await expect(modern).toHaveAttribute('data-activation-state', 'active');
  await expect(classic).toHaveAttribute('data-activation-state', 'inactive');
  await expect(modern.locator('[data-world-recipe-id="facility:fire-station-civic-fire-modern-test:v2"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('synthcity.asset-visual-selections.v1')))
    .toContain('facility:fire-station:modern-test');
  await page.getByRole('button', { name: 'Restore built-in default', exact: true }).click();
  await expect(classic).toHaveAttribute('data-activation-state', 'active');
});

test('updates existing city Fire Stations across tabs without changing the saved simulation', async ({ page, context }) => {
  const cityId = `asset-visual-cross-tab-${Date.now()}`;
  await page.goto(`/design-review/square-grid-mayor.html?profile=city&size=48&terrain=flat&city=${cityId}&newCityName=Asset%20Visual%20QA&newMayorName=Browser%20Mayor&seed=71`, { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  const placed = await page.evaluate(() => window.marketCityDashboard?.dispatch({
    type: 'place-facility', facility: 'fire-station', anchor: { x: 16, y: 16 },
  }));
  expect(placed?.accepted, placed?.reason).toBe(true);
  const beforeHash = await page.evaluate(() => window.marketCityDashboard?.hash());
  const station = page.locator('.terrain-facility-world.facility-fire-station');
  await expect(station).toHaveAttribute('data-world-recipe-id', 'facility:fire-station:v2');

  const library = await context.newPage();
  await library.goto('/design-review/asset-library.html', { waitUntil: 'networkidle' });
  await library.getByRole('button', { name: 'Civic', exact: true }).click();
  await library.locator('[data-asset-id="live:facility:fire-station:modern-test"]').click();
  await library.getByRole('button', { name: 'Make Live', exact: true }).click();

  await expect(station).toHaveAttribute('data-world-recipe-id', 'facility:fire-station-civic-fire-modern-test:v2');
  expect(await page.evaluate(() => window.marketCityDashboard?.hash())).toBe(beforeHash);
  expect(await page.evaluate(() => window.marketCityDashboard?.snapshot().map.facilities.find((facility) => facility.kind === 'fire-station')))
    .toMatchObject({ kind: 'fire-station', anchor: 16 * 48 + 16, tiles: [16 * 48 + 16] });
  await page.evaluate(() => window.marketCityDashboard?.save());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  await expect(page.locator('.terrain-facility-world.facility-fire-station')).toHaveAttribute('data-world-recipe-id', 'facility:fire-station-civic-fire-modern-test:v2');
  expect(await page.evaluate(() => window.marketCityDashboard?.hash())).toBe(beforeHash);
  await library.close();
});

test('filters the public library by every playable family without loading an unbounded grid', async ({ page }) => {
  await page.goto('/design-review/asset-library.html', { waitUntil: 'networkidle' });

  for (const [filter, expectedId] of [
    ['Residential', 'live:rci:R'],
    ['Commercial', 'live:rci:C'],
    ['Industrial', 'live:rci:I'],
    ['Civic', 'live:facility:fire-station'],
    ['Power & Water', 'live:facility:water-tower'],
    ['Transit & Networks', 'live:network:subway'],
  ] as const) {
    await page.getByRole('button', { name: filter, exact: true }).click();
    await expect(page.locator(`[data-asset-id="${expectedId}"]`)).toBeVisible();
    expect(await page.locator('[data-asset-id]').count()).toBeLessThanOrEqual(72);
  }
});
