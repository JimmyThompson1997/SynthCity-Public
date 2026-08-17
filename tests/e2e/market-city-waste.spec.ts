import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { createMarketCityState, serializeMarketCityState } from '../../src/market-city/state';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE,
  type MarketCityStateV2,
} from '../../src/market-city/types';

type Dashboard = {
  snapshot(): MarketCityStateV2;
  canonicalSnapshot(): string;
  dispatch(command: unknown): { accepted: boolean; reason?: string; changedTileIds: number[] };
  step(months?: number): MarketCityStateV2;
  save(): Promise<boolean>;
  whenDurable(): Promise<boolean>;
};

const expectedCommit = process.env.SYNTHCITY_EXPECTED_COMMIT;
const requireHosted = process.env.SYNTHCITY_REQUIRE_PRODUCTION === '1';
const captureEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';
const browserProblems = new WeakMap<Page, string[]>();
const SIZE = 48;
const TILE_COUNT = SIZE * SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

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

function cityUrl(cityId: string): string {
  return `/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=Waste%20QA&newMayorName=Browser%20Mayor&seed=1`;
}

async function openCity(page: Page, cityId: string): Promise<void> {
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-synthcity-schema', '2');
  await expect(page.locator('html')).toHaveAttribute('data-synthcity-rules', MARKET_CITY_RULES_VERSION);
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.tile')).toHaveCount(TILE_COUNT);
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  if (expectedCommit) await expect(page.locator('html')).toHaveAttribute('data-synthcity-commit', expectedCommit);
  if (requireHosted) await expect(page.locator('html')).toHaveAttribute('data-synthcity-environment', /preview|production/);
}

async function projectedPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x: cellX, y: cellY }) => {
    const picker = document.querySelector<SVGPolygonElement>(`.terrain-picker[data-x="${cellX}"][data-y="${cellY}"]`);
    const surface = document.querySelector<SVGSVGElement>('#terrain-surface');
    if (!picker || !surface) {
      const planningTile = document.querySelector<HTMLElement>(`.tile[data-x="${cellX}"][data-y="${cellY}"]`);
      if (!planningTile) throw new Error(`Tile ${cellX},${cellY} is not measurable.`);
      const bounds = planningTile.getBoundingClientRect();
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

async function dragMapRectangle(page: Page, from: Readonly<{ x: number; y: number }>, to: Readonly<{ x: number; y: number }>, action: string, footprint: number): Promise<void> {
  const start = await projectedPoint(page, from.x, from.y);
  const end = await projectedPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const previews = page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${action}"]`);
  await expect(previews).toHaveCount(footprint);
  await page.mouse.up();
}

async function openWasteCatalog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  const category = page.locator('.public-services-tray [data-public-service-category="waste"]');
  await expect(category).toHaveAccessibleName('Waste');
  await category.click();
  await expect(page.locator('#public-service-catalog-dialog')).toBeVisible();
  await expect(page.locator('#public-service-catalog-title')).toHaveText('Waste');
}

async function selectLandfill(page: Page): Promise<void> {
  await openWasteCatalog(page);
  await page.locator('#public-service-catalog-grid [data-action="zone-landfill"]').click();
}

async function selectWaterPipe(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray [data-utility-category="water"]').click();
  await page.locator('#utility-catalog-grid [data-action="network:water-pipe"]').click();
}

async function selectRoad(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray').getByRole('button', { name: 'Roads', exact: true }).click();
  await page.locator('#transit-catalog-grid [data-action="road"]').click();
}

async function selectBulldoze(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bulldoze tools', exact: true }).click();
}

async function selectDezone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="dezone"]').click();
}

async function selectInspect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
}

async function seedV2City(page: Page, state: unknown): Promise<void> {
  const seed = state as MarketCityStateV2;
  const seedUrl = '**/__waste-v2-seed__.html';
  await page.route(seedUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Waste seed</title>' }));
  await page.goto('/__waste-v2-seed__.html', { waitUntil: 'domcontentloaded' });
  await page.unroute(seedUrl);
  await page.evaluate(async (snapshot) => new Promise<void>((resolve, reject) => {
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
      transaction.objectStore('market-cities-v2-fire').put({ cityId: snapshot.identity.cityId, savedAt: '2026-08-12T00:00:00.000Z', state: snapshot });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), seed);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (!captureEvidence) return testInfo.attach(name, { body, contentType: 'application/json' });
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function maybeScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!captureEvidence) return;
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test('offers a truthful Waste card and places shared Landfill Zone art through all four rotations', async ({ page }, testInfo) => {
  const cityId = `waste-catalog-${Date.now()}`;
  await openCity(page, cityId);

  for (let rotation = 0; rotation < 4; rotation += 1) {
    await openWasteCatalog(page);
    const card = page.locator('#public-service-catalog-grid [data-action="zone-landfill"]');
    await expect(card).toHaveAccessibleName('Landfill Zone');
    await expect(card).toContainText('1 × 1 tiles');
    await expect(card).toHaveAttribute('data-catalog-kind', 'landfill');
    await expect(card).toHaveAttribute('data-build-cost', '0');
    await expect(card).toHaveAttribute('data-monthly-maintenance', '0');
    await expect(card).toHaveAttribute('data-capacity', '10000');
    const thumbnail = card.locator('.utility-catalog-preview-svg');
    const recipe = card.locator('.terrain-landfill-world');
    await expect(thumbnail).toHaveAttribute('data-preview-rotation', String(rotation));
    await expect(recipe).toHaveAttribute('data-world-recipe-id', 'service-zone:landfill:v2');
    await expect(recipe).toHaveAttribute('data-world-geometry-fingerprint', 'service-zone-landfill-geometry-v2');
    await expect(recipe).toHaveAttribute('data-fill-stage', 'empty');
    await expect(recipe.locator('.terrain-landfill-soil')).toHaveCount(1);
    await page.getByRole('button', { name: 'Close public services catalogue' }).click();
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  // Return the actual terrain picker to its canonical camera so the visible
  // placement gesture is measured against the rendered world, not its hidden
  // planning-grid fallback after a camera turn.
  await page.getByRole('button', { name: 'Rotate view right' }).click();

  await selectLandfill(page);
  const point = await projectedPoint(page, 11, 11);
  await page.mouse.move(point.x, point.y);
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-landfill"]');
  await expect(preview).toHaveCount(1);
  await expect(preview).toHaveAttribute('data-valid', 'true');
  await page.mouse.click(point.x, point.y);
  const placed = page.locator('#terrain-construction-overlays .terrain-landfill-world[data-tile="539"]');
  await expect(placed).toHaveCount(1);
  await expect(placed).toHaveAttribute('data-fill-stage', 'empty');
  await expect(placed).toHaveAttribute('data-world-recipe-id', 'service-zone:landfill:v2');
  await expect(placed.locator('.terrain-landfill-soil')).toHaveAttribute('fill', '#b98a63');
  await expect(placed.locator('.terrain-landfill-soil')).toHaveAttribute('stroke', 'none');
  expect((await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot())).map.landfillZones[tile(11, 11)]).toBe(true);

  await attachJson(testInfo, 'waste-card-world-rotations.json', { rotations: [0, 1, 2, 3], placedTile: tile(11, 11) });
  await maybeScreenshot(page, testInfo, 'waste-card-world-rotations.png');
});

test('places an atomic pipe-compatible landfill brush, undoes it, rejects surface conflicts, and reloads exactly', async ({ page }, testInfo) => {
  const cityId = `waste-brush-${Date.now()}`;
  await openCity(page, cityId);

  await selectWaterPipe(page);
  await dragMapRectangle(page, { x: 10, y: 12 }, { x: 12, y: 12 }, 'network:water-pipe', 3);
  await selectLandfill(page);
  await dragMapRectangle(page, { x: 10, y: 12 }, { x: 12, y: 12 }, 'zone-landfill', 3);
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (let x = 10; x <= 12; x += 1) {
    expect(state.map.landfillZones[tile(x, 12)]).toBe(true);
    expect(state.map.waterPipes[tile(x, 12)]).toBe(true);
  }
  await expect(page.locator('#terrain-construction-overlays .terrain-landfill-world')).toHaveCount(3);

  await expect(page.locator('#simulation-undo')).toBeEnabled();
  await page.locator('#simulation-undo').click();
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (let x = 10; x <= 12; x += 1) {
    expect(state.map.landfillZones[tile(x, 12)]).toBe(false);
    expect(state.map.waterPipes[tile(x, 12)]).toBe(true);
  }

  await selectLandfill(page);
  await dragMapRectangle(page, { x: 10, y: 12 }, { x: 12, y: 12 }, 'zone-landfill', 3);
  // Road placement itself is covered through visible controls in the shared
  // transport suite; use the dashboard bridge here only to construct the
  // conflicting surface while the assertion exercises the visible landfill
  // preview and click as one atomic player gesture.
  const roadTile = tile(14, 12);
  const road = await page.evaluate((tileId) => (window.marketCityDashboard as Dashboard).dispatch({
    type: 'place-network', network: 'road', cells: [{ x: tileId % 48, y: Math.floor(tileId / 48) }],
  }), roadTile);
  expect(road.accepted).toBe(true);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await selectLandfill(page);
  const start = await projectedPoint(page, 13, 12);
  const end = await projectedPoint(page, 15, 12);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const rejected = page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-landfill"]');
  await expect(rejected).toHaveCount(3);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-landfill"][data-valid="false"]')).toHaveCount(3);
  await page.mouse.up();
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);

  await attachJson(testInfo, 'waste-brush-atomic-pipe-reload.json', { pipeAndLandfillCoexist: true, undoPreservedPipe: true, rejectedSurfaceConflict: true, exactReload: true });
  await maybeScreenshot(page, testInfo, 'waste-brush-atomic-pipe-reload.png');
});

test('replaces an empty landfill route with a Road through the visible player flow and persists it', async ({ page }, testInfo) => {
  const cityId = `empty-landfill-road-${Date.now()}`;
  const from = { x: 18, y: 22 };
  const to = { x: 24, y: 22 };
  const route = Array.from({ length: to.x - from.x + 1 }, (_, offset) => tile(from.x + offset, from.y));
  await openCity(page, cityId);

  await selectLandfill(page);
  await dragMapRectangle(page, from, to, 'zone-landfill', route.length);
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (const target of route) {
    expect(state.map.landfillZones[target]).toBe(true);
    expect(state.services.waste.storedByTile[target]).toBe(0);
  }

  await selectRoad(page);
  const start = await projectedPoint(page, from.x, from.y);
  const end = await projectedPoint(page, to.x, to.y);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const routePreview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="road"]');
  await expect(routePreview).toHaveCount(route.length);
  expect(await routePreview.evaluateAll((elements) => elements.every((element) => element.getAttribute('data-valid') === 'true'))).toBe(true);
  expect(await routePreview.evaluateAll((elements) => elements.every((element) => element.classList.contains('valid') && !element.classList.contains('invalid')))).toBe(true);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-mode="prospective"] .terrain-road-world')).not.toHaveCount(0);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
  await maybeScreenshot(page, testInfo, 'empty-landfill-road-held.png');

  await page.mouse.up();
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (const target of route) {
    expect(state.map.roads[target]).toBe(true);
    expect(state.map.landfillZones[target]).toBe(false);
  }
  await expect(page.locator('#terrain-construction-overlays .terrain-landfill-world')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'empty-landfill-road-released.png');

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const persisted = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(persisted);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (const target of route) {
    expect(state.map.roads[target]).toBe(true);
    expect(state.map.landfillZones[target]).toBe(false);
  }

  await attachJson(testInfo, 'empty-landfill-road-replacement.json', {
    cityId, route, heldStateUnchanged: true, committedRoad: true, clearedEmptyLandfill: true, reloadedExactly: true,
  });
});

test('shows the live first collection, every persisted fill stage, and refuses removal once garbage is stored', async ({ page }, testInfo) => {
  const cityId = `waste-stages-${Date.now()}`;
  const seeded = createMarketCityState({ cityId, cityName: 'Waste Stages', mayorName: 'Browser Mayor', seed: 611, createdAt: '2026-08-12T00:00:00.000Z' });
  const producer = tile(8, 8);
  seeded.map.zones[producer] = 'R';
  seeded.economy.density[producer] = 1;
  seeded.economy.wealth[producer] = 10_000;
  await seedV2City(page, seeded);
  await openCity(page, cityId);

  await selectLandfill(page);
  await clickMapCell(page, 12, 8);
  const landfill = tile(12, 8);
  await selectRoad(page);
  await clickMapCell(page, 12, 7);
  const firstCollection = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(firstCollection.services.waste).toMatchObject({ generatedThisMonth: 1, landfilledThisMonth: 1, unmanagedThisMonth: 0 });
  await expect(page.locator(`#terrain-construction-overlays .terrain-landfill-world[data-tile="${landfill}"]`)).toHaveAttribute('data-fill-stage', 'scattered');

  // The live placement above proves the player flow. These exact persisted
  // ledger fixtures then make each long-run threshold visible without turning
  // browser UI proof into a 10,000-month wall-clock test. Core settlement
  // tests separately advance stable allocation through these thresholds.
  for (const [storedTenths, expectedStage] of [[2_500, 'low'], [5_000, 'medium'], [7_500, 'high'], [10_000, 'full']] as const) {
    const staged = createMarketCityState({ cityId, cityName: 'Waste Stages', mayorName: 'Browser Mayor', seed: 611, createdAt: '2026-08-12T00:00:00.000Z' });
    staged.map.zones[producer] = 'R';
    staged.economy.density[producer] = 1;
    staged.economy.wealth[producer] = 10_000;
    staged.map.landfillZones[landfill] = true;
    staged.map.roads[tile(12, 7)] = true;
    staged.services.waste = {
      generatedThisMonth: 0,
      generatedLifetime: storedTenths,
      landfilledThisMonth: 0,
      landfilledLifetime: storedTenths,
      unmanagedThisMonth: 0,
      unmanagedLifetime: 0,
      storedByTile: staged.services.waste.storedByTile.map((_, id) => id === landfill ? storedTenths : 0),
    };
    await seedV2City(page, staged);
    await openCity(page, cityId);
    await expect(page.locator(`#terrain-construction-overlays .terrain-landfill-world[data-tile="${landfill}"]`)).toHaveAttribute('data-fill-stage', expectedStage);
  }
  const overflow = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(overflow.services.waste).toMatchObject({ generatedThisMonth: 1, landfilledThisMonth: 0, unmanagedThisMonth: 1, storedByTile: expect.any(Array) });
  // Overflow raises pollution but does NOT teleport it. The unmanaged term is
  // part of the field the stock approaches, so the first month moves a fraction
  // of the way and the cap is reached only after the city has lived with it.
  expect(overflow.environment.pollution[producer]).toBeGreaterThan(0);
  // One month of fully unmanaged waste moves the stock by approach x cap, not to
  // the cap. The term used to be added after the approach step, so it landed in
  // full every month and settled at cap / approach -- about 67 of the 0-100
  // scale from rubbish alone.
  const step = MARKET_CITY_RULES.pollutionApproach * MARKET_CITY_RULES.waste.maximumUnmanagedPollution;
  expect(overflow.environment.pollution[producer]).toBeCloseTo(step, 1);
  expect(overflow.environment.pollution[producer])
    .toBeLessThan(MARKET_CITY_RULES.waste.maximumUnmanagedPollution);

  await selectInspect(page);
  await clickMapCell(page, 12, 8);
  await expect(page.locator('#route-query-panel')).toBeHidden();

  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await selectDezone(page);
  await clickMapCell(page, 12, 8);
  await expect(page.locator('#ticker-copy')).toContainText('Landfill contains garbage.');
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
  await selectBulldoze(page);
  await clickMapCell(page, 12, 8);
  await expect(page.locator('#ticker-copy')).toContainText('Landfill contains garbage.');
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);

  await attachJson(testInfo, 'waste-stages-and-lock.json', {
    stages: [['empty', 0], ['scattered', 1], ['low', 2_500], ['medium', 5_000], ['high', 7_500], ['full', 10_000]],
    fullOverflow: { unmanaged: overflow.services.waste.unmanagedThisMonth, pollution: overflow.environment.pollution[producer] },
    storedRemovalRejected: true,
  });
  await maybeScreenshot(page, testInfo, 'waste-stages-and-lock.png');
});

test('gates disconnected landfill areas, resumes a cardinal component through Road contact, and reloads its inspector state', async ({ page }, testInfo) => {
  const cityId = `waste-road-gate-${Date.now()}`;
  const seeded = createMarketCityState({ cityId, cityName: 'Waste Road Gate', mayorName: 'Browser Mayor', seed: 613, createdAt: '2026-08-12T00:00:00.000Z' });
  const producer = tile(5, 5);
  const landfills = [tile(20, 20), tile(21, 20), tile(21, 21)];
  seeded.map.zones[producer] = 'I';
  seeded.economy.density[producer] = 1;
  seeded.economy.wealth[producer] = 10_000;
  for (const landfill of landfills) seeded.map.landfillZones[landfill] = true;
  await seedV2City(page, seeded);
  await openCity(page, cityId);

  const blocked = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(blocked.services.waste).toMatchObject({ generatedThisMonth: 20, landfilledThisMonth: 0, unmanagedThisMonth: 20 });
  await selectInspect(page);
  await clickMapCell(page, 20, 20);
  await expect(page.locator('#route-query-panel')).toBeHidden();

  await selectRoad(page);
  await clickMapCell(page, 20, 19);
  const recovered = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(recovered.services.waste).toMatchObject({ unmanagedThisMonth: 0, unmanagedLifetime: 20 });
  expect(recovered.services.waste.landfilledThisMonth).toBeGreaterThan(0);
  await selectInspect(page);
  await clickMapCell(page, 21, 21);
  await expect(page.locator('#route-query-panel')).toBeHidden();

  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  await selectInspect(page);
  await clickMapCell(page, 20, 20);
  await expect(page.locator('#route-query-panel')).toBeHidden();

  await attachJson(testInfo, 'waste-road-gate.json', { cityId, componentTileCount: 3, blockedUnmanaged: blocked.services.waste.unmanagedThisMonth, recoveredLandfilled: recovered.services.waste.landfilledThisMonth, exactReload: true });
  await maybeScreenshot(page, testInfo, 'waste-road-gate.png');
});

test('migrates a real pre-landfill-road-gate IndexedDB city with its valid nonzero garbage ledger intact', async ({ page }, testInfo) => {
  const cityId = `waste-prior-rules-${Date.now()}`;
  const current = createMarketCityState({ cityId, cityName: 'Pre Waste City', mayorName: 'Browser Mayor', seed: 617, createdAt: '2026-08-12T00:00:00.000Z' });
  const landfill = tile(16, 16);
  current.map.landfillZones[landfill] = true;
  current.services.waste = {
    generatedThisMonth: 100,
    generatedLifetime: 300,
    landfilledThisMonth: 100,
    landfilledLifetime: 200,
    unmanagedThisMonth: 0,
    unmanagedLifetime: 100,
    storedByTile: current.services.waste.storedByTile.map((_, id) => id === landfill ? 200 : 0),
  };
  const prior = JSON.parse(serializeMarketCityState(current)) as Record<string, unknown>;
  prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE;
  // A save from before 2.11 has no crime record; this fixture is cloned from a
  // CURRENT state, so the key has to come back off or migration correctly rejects it.
  delete (prior as { crime?: unknown }).crime;
  await seedV2City(page, prior);
  await openCity(page, cityId);

  let migrated = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
  expect(migrated.map.landfillZones[landfill]).toBe(true);
  expect(migrated.services.waste).toMatchObject({
    generatedThisMonth: 100, generatedLifetime: 300,
    landfilledThisMonth: 100, landfilledLifetime: 200,
    unmanagedThisMonth: 0, unmanagedLifetime: 100,
  });
  expect(migrated.services.waste.storedByTile[landfill]).toBe(200);
  await expect(page.locator(`#terrain-construction-overlays .terrain-landfill-world[data-tile="${landfill}"]`)).toHaveAttribute('data-fill-stage', 'scattered');

  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  migrated = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
  expect(migrated.services.waste.storedByTile[landfill]).toBe(200);

  await attachJson(testInfo, 'waste-prior-rules-indexeddb-migration.json', { cityId, fromRules: MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE, toRules: MARKET_CITY_RULES_VERSION, storedTenths: 200, exactReload: true });
});
