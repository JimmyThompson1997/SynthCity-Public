import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { derivePower } from '../../src/market-city/spatial';
import { createMarketCityState } from '../../src/market-city/state';
import { deriveWaterService } from '../../src/market-city/water';
import type { MarketCityStateV2 } from '../../src/market-city/types';

type MayorBridge = {
  viewSnapshot(): { rotation: number; panX: number; panY: number; zoom: number; dataView: string };
  restoreViewState(view: { rotation: number; panX: number; panY: number; zoom: number; dataView: string }): void;
};

const captureEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';
const expectedCommit = process.env.SYNTHCITY_EXPECTED_COMMIT;
const browserProblems = new WeakMap<Page, string[]>();
const tile = (x: number, y: number): number => y * 48 + x;

test.setTimeout(120_000);

test.beforeEach(async ({ page }) => {
  const problems: string[] = [];
  browserProblems.set(page, problems);
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`); });
});

test.afterEach(async ({ page }) => {
  expect(browserProblems.get(page) ?? []).toEqual([]);
});

function fixtureCity(cityId: string): MarketCityStateV2 {
  const state = createMarketCityState({
    cityId,
    cityName: 'Inspector Proof City',
    mayorName: 'Browser Mayor',
    seed: 20260815,
    createdAt: '2026-08-15T00:00:00.000Z',
  });
  const coalAnchor = tile(8, 8);
  const towerAnchor = tile(18, 8);
  state.map.facilities.push(
    {
      id: 'inspector-coal',
      kind: 'coal-power-plant',
      anchor: coalAnchor,
      tiles: [tile(8, 8), tile(9, 8), tile(8, 9), tile(9, 9), tile(8, 10), tile(9, 10)],
    },
    {
      id: 'inspector-water',
      kind: 'water-tower',
      anchor: towerAnchor,
      tiles: [tile(18, 8), tile(19, 8), tile(18, 9), tile(19, 9)],
    },
    {
      id: 'inspector-wind-bootstrap',
      kind: 'wind-turbine',
      anchor: tile(10, 8),
      tiles: [tile(10, 8)],
    },
  );

  // The fixture deliberately contains one connected service spine and one
  // remote failed lot. It exercises canonical allocation without changing
  // the saved state shape or simulation rules.
  [
    tile(8, 13), tile(12, 13), tile(18, 12), tile(6, 16),
  ].forEach((road) => { state.map.roads[road] = true; });
  for (let x = 10; x <= 17; x += 1) state.map.powerLines[tile(x, 9)] = true;
  state.map.powerLines[tile(12, 10)] = true;
  state.map.powerLines[tile(12, 11)] = true;
  for (let x = 12; x <= 18; x += 1) state.map.waterPipes[tile(x, 9)] = true;
  state.map.waterPipes[tile(12, 10)] = true;
  state.map.waterPipes[tile(12, 11)] = true;

  const building = tile(12, 12);
  const emptyZone = tile(14, 12);
  const failedZone = tile(35, 35);
  state.map.zones[building] = 'R';
  state.map.zones[emptyZone] = 'C';
  state.map.zones[failedZone] = 'I';
  state.economy.density[building] = 0.25;
  state.economy.wealth[building] = 24_000;

  const power = derivePower(state);
  const water = deriveWaterService(state, power);
  state.environment.powered = power.powered;
  state.environment.watered = water.watered;
  state.services.water = water.service;
  return state;
}

async function seedCity(page: Page, state: MarketCityStateV2): Promise<void> {
  const seedUrl = '**/__market-city-inspector-seed__.html';
  await page.route(seedUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>Inspector seed</title>',
  }));
  await page.goto('/__market-city-inspector-seed__.html', { waitUntil: 'domcontentloaded' });
  await page.unroute(seedUrl);
  await page.evaluate(async (seed) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v2-fire', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('market-cities-v2-fire')) database.createObjectStore('market-cities-v2-fire', { keyPath: 'cityId' });
      if (!database.objectStoreNames.contains('market-profile-v2-fire')) database.createObjectStore('market-profile-v2-fire', { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v2-fire', 'readwrite');
      transaction.objectStore('market-cities-v2-fire').put({ cityId: seed.identity.cityId, savedAt: '2026-08-15T00:00:00.000Z', state: seed });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), state);
}

async function openCity(page: Page, cityId: string): Promise<void> {
  await page.goto(`/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=Inspector%20Proof%20City&newMayorName=Browser%20Mayor&seed=20260815`, { waitUntil: 'networkidle' });
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.city-grid')).toHaveCSS('--map-cells', '48');
  await expect(page.locator('.tile')).toHaveCount(2_304);
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  if (expectedCommit) await expect(page.locator('html')).toHaveAttribute('data-synthcity-commit', expectedCommit);
}

async function projectedPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x: cellX, y: cellY }) => {
    const picker = document.querySelector<SVGPolygonElement>(`.terrain-picker[data-x="${cellX}"][data-y="${cellY}"]`);
    const surface = document.querySelector<SVGSVGElement>('#terrain-surface');
    if (!picker || !surface) {
      const tile = document.querySelector<HTMLElement>(`.tile[data-x="${cellX}"][data-y="${cellY}"]`);
      if (!tile) throw new Error(`Tile ${cellX},${cellY} is not projected.`);
      const bounds = tile.getBoundingClientRect();
      return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 };
    }
    const vertices = (picker.getAttribute('points') ?? '').trim().split(/\s+/).map((token) => token.split(',').map(Number));
    const local = new DOMPoint(
      vertices.reduce((sum, vertex) => sum + vertex[0]!, 0) / vertices.length,
      vertices.reduce((sum, vertex) => sum + vertex[1]!, 0) / vertices.length,
    );
    const screen = local.matrixTransform(surface.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y });
}

async function clickMapCell(page: Page, x: number, y: number): Promise<void> {
  const point = await projectedPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function screenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!captureEvidence) return;
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('opens every universal inspector target and renders connector states', async ({ page }, testInfo) => {
  const cityId = `inspector-targets-${Date.now()}`;
  await seedCity(page, fixtureCity(cityId));
  await openCity(page, cityId);

  await clickMapCell(page, 12, 12);
  await expect(page.locator('#route-query-panel')).toBeVisible();
  await expect(page.locator('#route-query-title')).toHaveText('Residential Building');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'building');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');
  await screenshot(page, testInfo, 'inspector-building-card.png');
  await clickMapCell(page, 6, 16);
  await expect(page.locator('#route-query-title')).toHaveText('Road');
  await expect(page.locator('#pinned-inspector-tray')).toBeHidden();
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 14, 12);
  await expect(page.locator('#route-query-title')).toHaveText('Commercial Tile');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'zoned-tile');
  await screenshot(page, testInfo, 'inspector-empty-zoned-tile-card.png');
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 6, 16);
  await expect(page.locator('#route-query-title')).toHaveText('Road');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'road');
  await screenshot(page, testInfo, 'inspector-road-card.png');
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 10, 9);
  await expect(page.locator('#route-query-title')).toHaveText('Power Line');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'power-line');
  await screenshot(page, testInfo, 'inspector-power-line-card.png');
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 8, 8);
  await expect(page.locator('#route-query-title')).toHaveText('Coal Power Plant');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'power-facility');
  await expect(page.locator('[data-inspector-connector="power"]')).toContainText('Generation capacity 1,200');
  await screenshot(page, testInfo, 'inspector-power-plant-card.png');
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 18, 8);
  await expect(page.locator('#route-query-title')).toHaveText('Water Tower');
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'water-facility');
  await expect(page.locator('[data-inspector-connector="water"]')).toContainText('Generation capacity 20,000');
  await screenshot(page, testInfo, 'inspector-water-facility-card.png');
  await page.getByRole('button', { name: 'Close object inspector' }).click();

  await clickMapCell(page, 35, 35);
  await expect(page.locator('#route-query-title')).toHaveText('Industrial Tile');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('.tile[data-x="35"][data-y="35"]')).toHaveClass(/inspected/);
  await screenshot(page, testInfo, 'inspector-failed-connectors-card.png');
});

test('pins in insertion order, restores focus, preserves camera, and closes cleanly', async ({ page }, testInfo) => {
  const cityId = `inspector-pins-${Date.now()}`;
  await seedCity(page, fixtureCity(cityId));
  await openCity(page, cityId);

  await page.evaluate(() => {
    (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor.restoreViewState({
      rotation: 1, panX: 82, panY: -54, zoom: 1.35, dataView: 'city',
    });
  });
  await clickMapCell(page, 12, 12);
  const buildingPinId = await page.locator('#route-query-panel').getAttribute('data-inspector-target-id');
  expect(buildingPinId).toBe(`tile:zone:${tile(12, 12)}`);
  const beforeMinimize = await page.evaluate(() => (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor.viewSnapshot());
  await page.getByRole('button', { name: 'Minimize object inspector' }).click();
  await expect(page.locator('#route-query-panel')).toBeHidden();
  await expect(page.locator('#pinned-inspector-tray')).toBeVisible();
  await expect(page.locator('#pinned-inspector-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#pinned-inspector-toggle')).toHaveText('⌄');
  await expect(page.locator('.pinned-inspector-item')).toHaveCount(1);
  const afterMinimize = await page.evaluate(() => (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor.viewSnapshot());
  expect(afterMinimize).toMatchObject({
    rotation: beforeMinimize.rotation,
    panX: beforeMinimize.panX,
    panY: beforeMinimize.panY,
    zoom: beforeMinimize.zoom,
  });

  await clickMapCell(page, 6, 16);
  await expect(page.locator('#route-query-title')).toHaveText('Road');
  await page.getByRole('button', { name: 'Minimize object inspector' }).click();
  await expect(page.locator('.pinned-inspector-item')).toHaveCount(2);
  expect(await page.locator('.pinned-inspector-item').allTextContents()).toEqual(['⌂Residential Building', '═Road']);
  await screenshot(page, testInfo, 'inspector-multiple-pinned-cards.png');

  await page.locator('#pinned-inspector-toggle').click();
  await expect(page.locator('#pinned-inspector-toggle')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#pinned-inspector-toggle')).toHaveText('⌃');
  await expect(page.locator('#pinned-inspector-list')).toBeHidden();
  await clickMapCell(page, 12, 12);
  await expect(page.locator('#route-query-panel')).toBeVisible();
  await expect(page.locator('#pinned-inspector-toggle')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#pinned-inspector-list')).toBeVisible();
  await page.getByRole('button', { name: 'Minimize object inspector' }).click();

  const buildingPin = page.locator(`[data-inspector-pin-id="${buildingPinId}"]`);
  await buildingPin.click();
  await expect(page.locator('#route-query-panel')).toBeVisible();
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-id', buildingPinId!);
  const afterRestore = await page.evaluate(() => (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor.viewSnapshot());
  expect(afterRestore.rotation).toBe(beforeMinimize.rotation);
  expect(afterRestore.zoom).toBe(beforeMinimize.zoom);
  expect(afterRestore.panX).not.toBe(beforeMinimize.panX);
  expect(afterRestore.panY).not.toBe(beforeMinimize.panY);
  const targetPoint = await projectedPoint(page, 12, 12);
  const stage = await page.locator('.grid-stage').boundingBox();
  expect(stage).not.toBeNull();
  expect(Math.hypot(targetPoint.x - (stage!.x + stage!.width / 2), targetPoint.y - (stage!.y + stage!.height / 2))).toBeLessThan(42);
  await expect(page.locator('.tile[data-x="12"][data-y="12"]')).toHaveClass(/inspected/);
  await screenshot(page, testInfo, 'inspector-restored-centered-city-view.png');

  await page.getByRole('button', { name: 'Minimize object inspector' }).click();
  await expect(page.locator('.pinned-inspector-item')).toHaveCount(2);
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.locator('#data-view-dialog').getByRole('button', { name: 'Power', exact: true }).click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'power');
  await buildingPin.click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'city');
  await expect(page.locator('#route-query-panel')).toBeVisible();
  await screenshot(page, testInfo, 'inspector-restored-from-data-view.png');

  await page.getByRole('button', { name: 'Minimize object inspector' }).click();
  await buildingPin.click();
  await page.getByRole('button', { name: 'Minimize object inspector' }).click();
  await expect(page.locator('.pinned-inspector-item')).toHaveCount(2);
  await buildingPin.click();
  await page.getByRole('button', { name: 'Close object inspector' }).click();
  await expect(page.locator('#route-query-panel')).toBeHidden();
  await expect(page.locator(`[data-inspector-pin-id="${buildingPinId}"]`)).toHaveCount(0);
  await expect(page.locator('.pinned-inspector-item')).toHaveCount(1);
  await screenshot(page, testInfo, 'inspector-closed-card-removed.png');

});
