import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

import { createMarketCityState, serializeMarketCityState } from '../../src/market-city/state';
import { deriveWaterService } from '../../src/market-city/water';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_WATER,
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
const TILE_COUNT = 48 * 48;
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

function cityUrl(cityId: string, query = ''): string {
  return `/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=Water%20QA&newMayorName=Browser%20Mayor&seed=1${query}`;
}

async function openCity(page: Page, cityId: string, query = ''): Promise<void> {
  await page.goto(cityUrl(cityId, query), { waitUntil: 'networkidle' });
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

async function dragMapRoute(
  page: Page,
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  action = 'network:water-pipe',
  footprint?: number,
): Promise<void> {
  const start = await projectedPoint(page, from.x, from.y);
  const end = await projectedPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const previews = page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${action}"]`);
  if (footprint !== undefined) await expect(previews).toHaveCount(footprint);
  await expect(previews).not.toHaveCount(0);
  expect(await previews.evaluateAll((elements) => elements.every((element) => element.getAttribute('data-valid') === 'true'))).toBe(true);
  await page.mouse.up();
}

async function openWaterCatalog(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  const category = page.locator('.utilities-tray [data-utility-category="water"]');
  await expect(category).toHaveAccessibleName('Water');
  await category.click();
  await expect(page.locator('#utility-catalog-dialog')).toBeVisible();
  await expect(page.locator('#utility-catalog-title')).toHaveText('Water');
}

async function selectWaterItem(page: Page, action: string): Promise<void> {
  await openWaterCatalog(page);
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function selectRoad(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray').getByRole('button', { name: 'Roads', exact: true }).click();
  await page.locator('#transit-catalog-grid [data-action="road"]').click();
}

async function selectPowerItem(page: Page, action: string): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray').getByRole('button', { name: 'Power', exact: true }).click();
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function selectZone(page: Page, kind: 'residential' | 'commercial' | 'industrial'): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator(`.zones-tray [data-action="zone-${kind}"]`).click();
}

async function selectInspect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
}

async function selectBulldoze(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bulldoze tools', exact: true }).click();
}

async function openUndergroundView(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'Underground View', exact: true }).click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-underground-view', 'underground');
}

async function seedV2City(page: Page, state: MarketCityStateV2): Promise<void> {
  const canonical = deriveWaterService(state);
  state.environment.watered = canonical.watered;
  state.services.water = canonical.service;
  const seedUrl = '**/__water-v2-seed__.html';
  await page.route(seedUrl, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Water seed</title>' }));
  await page.goto('/__water-v2-seed__.html', { waitUntil: 'domcontentloaded' });
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
      transaction.objectStore('market-cities-v2-fire').put({ cityId: seed.identity.cityId, savedAt: '2026-08-12T00:00:00.000Z', state: seed });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => { database.close(); resolve(); };
    };
  }), state);
}

async function seedPreWaterCity(page: Page, state: MarketCityStateV2): Promise<void> {
  const prior = JSON.parse(serializeMarketCityState(state)) as Record<string, unknown>;
  prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_WATER;
  // A save from before 2.11 has no crime record; this fixture is cloned from a
  // CURRENT state, so the key has to come back off or migration correctly rejects it.
  delete (prior as { crime?: unknown }).crime;
  await seedV2City(page, prior as unknown as MarketCityStateV2);
}

async function previewAndClickFacility(
  page: Page,
  x: number,
  y: number,
  action: string,
  footprint: number,
): Promise<void> {
  const point = await projectedPoint(page, x, y);
  await page.mouse.move(point.x, point.y);
  const preview = page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${action}"]`);
  await expect(preview).toHaveCount(footprint);
  await expect(page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${action}"][data-valid="true"]`)).toHaveCount(footprint);
  await page.mouse.click(point.x, point.y);
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

function waterFacilitySelector(kind: string): string {
  return `#terrain-construction-overlays .terrain-facility-world[data-facility-kind="${kind}"][data-building-key]`;
}

function waterPipeSelector(): string {
  return '#underground-network-overlays .underground-water-pipe[data-network-kind="water-pipe"][data-tile][data-water-component][data-connection-mask][data-network-topology]';
}

function addOperationalWaterFixture(
  state: MarketCityStateV2,
  towerAnchor = tile(9, 4),
  pipeTile = towerAnchor,
): void {
  state.map.facilities.push({
    id: `water-tower-${towerAnchor}`,
    kind: 'water-tower',
    anchor: towerAnchor,
    tiles: [towerAnchor, towerAnchor + 1, towerAnchor + 48, towerAnchor + 49],
  });
  const coalAnchor = tile(4, 4);
  state.map.facilities.push({
    id: `coal-${towerAnchor}`,
    kind: 'coal-power-plant',
    anchor: coalAnchor,
    tiles: [coalAnchor, coalAnchor + 1, coalAnchor + 48, coalAnchor + 49, coalAnchor + 96, coalAnchor + 97],
  });
  // Thermal plants no longer self-start a water source. This roadless Wind
  // Turbine is deliberately adjacent to the existing feeder so it powers the
  // tower without adding a road or changing the focused Water fixture.
  state.map.facilities.push({
    id: `wind-bootstrap-${towerAnchor}`,
    kind: 'wind-turbine',
    anchor: tile(8, 3),
    tiles: [tile(8, 3)],
  });
  state.map.roads[tile(4, 7)] = true;
  state.map.roads[tile(9, 7)] = true;
  // The last line tile is deliberately adjacent to, rather than beneath, the
  // tower footprint: power lines are surface occupants while the tower itself
  // is conductive.
  for (let x = 6; x <= 8; x += 1) state.map.powerLines[tile(x, 4)] = true;
  state.map.waterPipes[pipeTile] = true;
}

test('offers truthful Water cards and previews every facility through all four rotations', async ({ page }, testInfo) => {
  await openCity(page, `water-catalog-${Date.now()}`);
  const fixtures = [
    { action: 'network:water-pipe', kind: 'water-pipe', label: 'Water Pipe', footprint: '1 × 1 tiles', capacity: '0', classes: ['underground-water-jacket', 'underground-water-highlight'] },
    { action: 'facility:water-tower', kind: 'water-tower', label: 'Water Tower', footprint: '2 × 2 tiles', capacity: '20000', classes: ['terrain-facility-water-tank', 'terrain-facility-tower-leg'] },
    { action: 'facility:coastal-water-pump', kind: 'coastal-water-pump', label: 'Coastal Water Pump', footprint: '3 × 3 tiles', capacity: '75000', classes: ['terrain-facility-pump-house', 'terrain-facility-intake-pipe'] },
    { action: 'facility:water-treatment-plant', kind: 'water-treatment-plant', label: 'Water Treatment Plant', footprint: '4 × 3 tiles', capacity: '50000', classes: ['terrain-facility-water-clarifier', 'terrain-facility-water-operations-building'] },
  ] as const;

  for (let rotation = 0; rotation < 4; rotation += 1) {
    for (const fixture of fixtures) {
      await openWaterCatalog(page);
      const card = page.locator(`#utility-catalog-grid [data-action="${fixture.action}"]`);
      await expect(card).toHaveAccessibleName(fixture.label);
      await expect(card).toContainText(fixture.footprint);
      await expect(card).toHaveAttribute('data-build-cost', '0');
      await expect(card).toHaveAttribute('data-monthly-maintenance', '0');
      await expect(card).toHaveAttribute('data-capacity', fixture.capacity);
      const preview = card.locator('.utility-catalog-preview-svg');
      await expect(preview).toHaveAttribute('data-preview-rotation', String(rotation));
      const recipe = fixture.kind === 'water-pipe'
        ? card.locator('.catalog-thumbnail-underground-water-pipe')
        : card.locator(`.terrain-facility-world[data-facility-kind="${fixture.kind}"]`);
      await expect(recipe).toHaveAttribute('data-world-recipe-id', fixture.kind === 'water-pipe' ? 'network:water-pipe:v2' : `facility:${fixture.kind}:v2`);
      await expect(recipe).toHaveAttribute('data-world-geometry-fingerprint', fixture.kind === 'water-pipe' ? 'network-water-pipe-geometry-v2' : `facility-${fixture.kind}-geometry-v2`);
      for (const className of fixture.classes) await expect(recipe.locator(`.${className}`)).not.toHaveCount(0);
      await page.getByRole('button', { name: 'Close utility catalogue' }).click();
    }
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await attachJson(testInfo, 'water-cards-four-rotations.json', { rotations: [0, 1, 2, 3], items: fixtures.map(({ action }) => action) });
  await maybeScreenshot(page, testInfo, 'water-cards-four-rotations.png');
});

test('places all three Water facility structures and keeps their shared art truthful through every rotation', async ({ page }, testInfo) => {
  const cityId = `water-world-art-${Date.now()}`;
  const state = createMarketCityState({ cityId, cityName: 'Water World Art', mayorName: 'Browser Mayor', seed: 311, createdAt: '2026-08-12T00:00:00.000Z' });
  state.map.terrain.water[tile(24, 5)] = true;
  await seedV2City(page, state);
  await openCity(page, cityId);

  const fixtures = [
    { action: 'facility:water-tower', kind: 'water-tower', x: 5, y: 5, footprint: 4, classes: ['terrain-facility-water-tank', 'terrain-facility-tower-leg'] },
    { action: 'facility:coastal-water-pump', kind: 'coastal-water-pump', x: 25, y: 5, footprint: 9, classes: ['terrain-facility-pump-house', 'terrain-facility-intake-pipe', 'terrain-facility-intake-screen'] },
    { action: 'facility:water-treatment-plant', kind: 'water-treatment-plant', x: 12, y: 5, footprint: 12, classes: ['terrain-facility-water-clarifier', 'terrain-facility-water-operations-building'] },
  ] as const;
  for (const fixture of fixtures) {
    await selectWaterItem(page, fixture.action);
    await previewAndClickFacility(page, fixture.x, fixture.y, fixture.action, fixture.footprint);
  }

  for (let rotation = 0; rotation < 4; rotation += 1) {
    await expect(page.locator('.city-client')).toHaveAttribute('data-view-rotation', String(rotation));
    for (const fixture of fixtures) {
      const world = page.locator(waterFacilitySelector(fixture.kind));
      await expect(world).toHaveCount(1);
      await expect(world).toHaveAttribute('data-world-recipe-id', `facility:${fixture.kind}:v2`);
      await expect(world).toHaveAttribute('data-world-geometry-fingerprint', `facility-${fixture.kind}-geometry-v2`);
      for (const className of fixture.classes) await expect(world.locator(`.${className}`)).not.toHaveCount(0);
    }
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await attachJson(testInfo, 'water-world-art-four-rotations.json', { rotations: [0, 1, 2, 3], facilities: fixtures.map(({ kind }) => kind) });
  await maybeScreenshot(page, testInfo, 'water-world-art-four-rotations.png');
});

test('uses one Underground View for water coverage and pipe placement', async ({ page }, testInfo) => {
  const cityId = `underground-view-${Date.now()}`;
  const state = createMarketCityState({ cityId, cityName: 'Underground View Lab', mayorName: 'Browser Mayor', seed: 311, createdAt: '2026-08-12T00:00:00.000Z' });
  addOperationalWaterFixture(state);
  const developedServed = tile(12, 4);
  const developedUnserved = tile(20, 4);
  const emptyCovered = tile(15, 4);
  const emptyUncovered = tile(30, 4);
  const unzonedUncovered = tile(31, 4);
  state.map.zones[developedServed] = 'R';
  state.map.zones[developedUnserved] = 'R';
  state.map.zones[emptyCovered] = 'R';
  state.map.zones[emptyUncovered] = 'R';
  state.economy.density[developedServed] = .2;
  state.economy.density[developedUnserved] = .2;
  await seedV2City(page, state);
  await openCity(page, cityId);
  await page.evaluate(() => {
    (window as unknown as { squareGridMayor: { fitViewToTileBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): void } })
      .squareGridMayor.fitViewToTileBounds({ minX: 3, minY: 2, maxX: 22, maxY: 9 });
  });
  await maybeScreenshot(page, testInfo, 'underground-view-water-source-city-context.png');

  await openUndergroundView(page);
  await expect(page.locator('.city-client')).not.toHaveAttribute('data-active-map-action', /.+/);
  await expect(page.locator('#terrain-construction-overlays')).toBeHidden();
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${emptyUncovered}"][data-water-status="unserved-empty-zoning"]`)).toHaveAttribute('fill', '#b98767');
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${unzonedUncovered}"][data-water-status="not-needed"]`)).toHaveAttribute('fill', '#786b58');
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${developedUnserved}"][data-water-status="unserved"]`)).toHaveAttribute('fill', '#8f634b');
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${developedServed}"][data-water-status="served"]`)).toHaveAttribute('fill', '#3d96c6');
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${emptyCovered}"][data-water-status="available"]`)).toHaveAttribute('fill', '#76cceb');
  await maybeScreenshot(page, testInfo, 'underground-view-water-source-statuses.png');

  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'city');
  await expect(page.locator('#terrain-construction-overlays')).toBeVisible();

  await selectWaterItem(page, 'network:water-pipe');
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-underground-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-active-map-action', 'network:water-pipe');
  const point = await projectedPoint(page, 12, 12);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:water-pipe"][data-valid="true"]')).toHaveCount(1);

  await attachJson(testInfo, 'underground-view-water-statuses.json', { emptyUncovered, developedUnserved, developedServed, emptyCovered });
  await maybeScreenshot(page, testInfo, 'underground-view-pipe-preview.png');
});

test('draws a persistent Water route below surface layers and confines demolition to the Water layer', async ({ page }, testInfo) => {
  const cityId = `water-route-${Date.now()}`;
  await openCity(page, cityId);

  await selectZone(page, 'residential');
  await clickMapCell(page, 12, 12);
  await selectRoad(page);
  await clickMapCell(page, 13, 12);
  await selectWaterItem(page, 'network:water-pipe');
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-underground-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-active-map-action', 'network:water-pipe');
  await dragMapRoute(page, { x: 10, y: 12 }, { x: 14, y: 12 }, 'network:water-pipe', 5);

  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(Array.from({ length: 5 }, (_, index) => state.map.waterPipes[tile(10 + index, 12)])).toEqual(Array(5).fill(true));
  expect(state.map.zones[tile(12, 12)]).toBe('R');
  expect(state.map.roads[tile(13, 12)]).toBe(true);
  const pipes = page.locator(waterPipeSelector());
  await expect(pipes).toHaveCount(5);
  // Pipe routes sit above the coverage shading in Underground View, so their
  // saturated blue jacket and pale centreline stay legible at a glance.
  await expect(pipes.locator('.underground-water-jacket').first()).toHaveAttribute('stroke', '#087fd6');
  await expect(pipes.locator('.underground-water-highlight').first()).toHaveAttribute('stroke', '#d5f7ff');
  expect(await pipes.evaluateAll((elements) => elements.every((element) => (
    /^(?:0|[1-9]|1[0-5])$/.test(element.getAttribute('data-connection-mask') ?? '')
    && /^(isolated|end|straight|corner|tee|cross)$/.test(element.getAttribute('data-network-topology') ?? '')
    && /^water:\d+$/.test(element.getAttribute('data-water-component') ?? '')
  )))).toBe(true);

  await expect(page.locator('#simulation-undo')).toBeEnabled();
  await page.locator('#simulation-undo').click();
  await expect(page.locator(waterPipeSelector())).toHaveCount(0);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.zones[tile(12, 12)]).toBe('R');
  expect(state.map.roads[tile(13, 12)]).toBe(true);

  await selectWaterItem(page, 'network:water-pipe');
  await dragMapRoute(page, { x: 10, y: 12 }, { x: 14, y: 12 }, 'network:water-pipe', 5);
  await selectBulldoze(page);
  await clickMapCell(page, 12, 12);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.waterPipes[tile(12, 12)]).toBe(false);
  expect(state.map.zones[tile(12, 12)]).toBe('R');
  expect(state.map.roads[tile(13, 12)]).toBe(true);
  await expect(page.locator(waterPipeSelector())).toHaveCount(4);

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  await openUndergroundView(page);
  await expect(page.locator(waterPipeSelector())).toHaveCount(4);

  await attachJson(testInfo, 'water-underground-edits.json', { coexistsWith: ['zone', 'road'], undo: true, removedTile: tile(12, 12), exactReload: true });
  await maybeScreenshot(page, testInfo, 'water-underground-route.png');
});

test('rejects an inland Coastal Water Pump atomically and exposes each operational gate', async ({ page }, testInfo) => {
  const cityId = `water-facility-gates-${Date.now()}`;
  await openCity(page, cityId);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await selectWaterItem(page, 'facility:coastal-water-pump');
  const inland = await projectedPoint(page, 20, 20);
  await page.mouse.move(inland.x, inland.y);
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="facility:coastal-water-pump"]');
  await expect(preview).toHaveCount(9);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="facility:coastal-water-pump"][data-valid="false"]')).toHaveCount(9);
  await page.mouse.click(inland.x, inland.y);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
  expect((await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot())).map.facilities.some(({ kind }) => kind === 'coastal-water-pump')).toBe(false);

  await selectWaterItem(page, 'facility:water-tower');
  await clickMapCell(page, 10, 10);
  const tower = page.locator(`${waterFacilitySelector('water-tower')}[data-operational][data-water-component][data-inactive-reason]`);
  await expect(tower).toHaveAttribute('data-operational', 'false');
  await expect(tower).toHaveAttribute('data-inactive-reason', /No road/i);

  await selectRoad(page);
  await dragMapRoute(page, { x: 9, y: 13 }, { x: 10, y: 13 }, 'road', 2);
  await expect(tower).toHaveAttribute('data-inactive-reason', /power/i);
  await selectPowerItem(page, 'facility:wind-turbine');
  await clickMapCell(page, 9, 10);
  await expect(tower).toHaveAttribute('data-inactive-reason', /pipe/i);
  await selectWaterItem(page, 'network:water-pipe');
  await clickMapCell(page, 10, 10);
  await expect(tower).toHaveAttribute('data-operational', 'true');
  await expect(tower).toHaveAttribute('data-water-component', /^water:\d+$/);
  await expect(tower).toHaveAttribute('data-inactive-reason', '');

  await selectInspect(page);
  await clickMapCell(page, 10, 10);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'water-facility');
  await expect(page.locator('#route-query-title')).toHaveText('Water Tower');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="water"]')).toContainText('Generation capacity 20,000');

  await attachJson(testInfo, 'water-facility-gates.json', { inlandRejectedAtomically: true, gateOrder: ['road', 'power', 'pipe'], finalOperational: true });
  await maybeScreenshot(page, testInfo, 'water-facility-gates.png');
});

test('shows only thermal and water-facility prerequisite markers, then repairs and reloads them', async ({ page }, testInfo) => {
  const cityId = `thermal-utility-gates-${Date.now()}`;
  const state = createMarketCityState({ cityId, cityName: 'Thermal Utility Gates', mayorName: 'Browser Mayor', seed: 337, createdAt: '2026-08-16T00:00:00.000Z' });
  const tower = { id: 'tower-gates', anchor: tile(5, 5), tiles: [tile(5, 5), tile(6, 5), tile(5, 6), tile(6, 6)] };
  const coal = { id: 'coal-gates', anchor: tile(20, 20), tiles: [tile(20, 20), tile(21, 20), tile(20, 21), tile(21, 21), tile(20, 22), tile(21, 22)] };
  state.map.facilities.push(
    { ...tower, kind: 'water-tower' },
    { ...coal, kind: 'coal-power-plant' },
  );
  // This pipe makes the tower's omitted road and power gates the only two
  // map markers; pipe remains inspector-only by design.
  state.map.waterPipes[tower.anchor] = true;
  await seedV2City(page, state);
  await openCity(page, cityId);

  const marker = (kind: 'road' | 'power' | 'water', id: string) => (
    page.locator(`[data-warning-area="${kind}:facility:${id}"]`)
  );
  await expect(marker('road', coal.id)).toBeVisible();
  await expect(marker('water', coal.id)).toBeVisible();
  await expect(marker('road', tower.id)).toBeVisible();
  await expect(marker('power', tower.id)).toBeVisible();
  await expect(marker('road', coal.id).locator('title')).toContainText('No road access');
  await expect(marker('water', coal.id).locator('title')).toContainText('No water');
  await expect(marker('road', tower.id).locator('title')).toContainText('No road access');
  await expect(marker('power', tower.id).locator('title')).toContainText('No power');
  await expect(page.locator('[data-warning-area^="pipe:facility:"]')).toHaveCount(0);
  await expect(page.locator('[data-warning-area^="shoreline:facility:"]')).toHaveCount(0);

  // Solar remains deliberately road- and water-independent. It provides the
  // bootstrap energy for the tower once visible power lines join the two
  // footprints.
  await selectPowerItem(page, 'facility:solar-plant');
  await clickMapCell(page, 9, 5);
  const solar = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot().map.facilities.find(({ kind }) => kind === 'solar-plant')!);
  await expect(page.locator(`[data-warning-area$=":${solar.id}"]`)).toHaveCount(0);
  await selectPowerItem(page, 'power-line');
  await clickMapCell(page, 7, 5);
  await clickMapCell(page, 8, 5);

  await selectRoad(page);
  await clickMapCell(page, 5, 8);
  await clickMapCell(page, 20, 23);
  await selectWaterItem(page, 'network:water-pipe');
  await dragMapRoute(page, { x: 6, y: 5 }, { x: 20, y: 5 }, 'network:water-pipe', 15);
  await dragMapRoute(page, { x: 20, y: 5 }, { x: 20, y: 19 }, 'network:water-pipe', 15);

  await expect(marker('road', coal.id)).toHaveCount(0);
  await expect(marker('water', coal.id)).toHaveCount(0);
  await expect(marker('road', tower.id)).toHaveCount(0);
  await expect(marker('power', tower.id)).toHaveCount(0);
  await selectInspect(page);
  await clickMapCell(page, 20, 20);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'power-facility');
  await expect(page.locator('#route-query-panel')).toContainText('Plant operational');
  await clickMapCell(page, 5, 5);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'water-facility');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');

  await selectBulldoze(page);
  await clickMapCell(page, 20, 23);
  await expect(marker('road', coal.id)).toBeVisible();
  await expect(marker('water', coal.id)).toHaveCount(0);
  await selectRoad(page);
  await clickMapCell(page, 20, 23);
  await expect(marker('road', coal.id)).toHaveCount(0);

  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  await expect(marker('road', coal.id)).toHaveCount(0);
  await expect(marker('water', coal.id)).toHaveCount(0);

  await attachJson(testInfo, 'thermal-utility-gates-repair-reload.json', {
    coal: coal.id,
    tower: tower.id,
    solar: solar.id,
    initialMarkers: ['coal-road', 'coal-water', 'tower-road', 'tower-power'],
    repaired: true,
    roadRegressionRecovered: true,
    exactReload: true,
  });
  await maybeScreenshot(page, testInfo, 'thermal-utility-gates-repair-reload.png');
});

test('shows source-fed availability at Manhattan seven, failure at eight, and separate RCI warnings', async ({ page }, testInfo) => {
  const cityId = `water-radius-${Date.now()}`;
  const state = createMarketCityState({ cityId, cityName: 'Water Radius Lab', mayorName: 'Browser Mayor', seed: 313, createdAt: '2026-08-12T00:00:00.000Z' });
  addOperationalWaterFixture(state);
  const seven = tile(16, 4);
  const eight = tile(17, 4);
  state.map.zones[seven] = 'R';
  state.map.zones[eight] = 'R';
  state.economy.density[eight] = .2;
  await seedV2City(page, state);
  await openCity(page, cityId);
  await openUndergroundView(page);

  await expect(page.locator(`.synthcity-data-water-service[data-tile="${seven}"][data-water-status="available"][data-water-component^="water:"]`)).toBeVisible();
  await expect(page.locator(`.synthcity-data-water-service[data-tile="${eight}"][data-water-status="unserved"]`)).toBeVisible();
  await expect(page.locator(`.synthcity-water-warning[data-tile="${eight}"]`)).toHaveCount(0);
  await expect(page.locator(`.synthcity-water-warning[data-tile="${seven}"]`)).toHaveCount(0);

  await selectInspect(page);
  await clickMapCell(page, 17, 4);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'building');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✕');
  await clickMapCell(page, 16, 4);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'zoned-tile');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✓');

  const current = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(current.environment.watered[seven]).toBe(true);
  expect(current.environment.watered[eight]).toBe(false);
  await attachJson(testInfo, 'water-radius-seven-eight.json', { seven, eight, sevenWatered: true, eightWatered: false });
  await maybeScreenshot(page, testInfo, 'water-radius-seven-eight.png');
});

test('adds bounded treatment capacity, allocates deterministically, and makes Water a real RCI gate', async ({ page }, testInfo) => {
  const cityId = `water-capacity-${Date.now()}`;
  const state = createMarketCityState({ cityId, cityName: 'Water Capacity Lab', mayorName: 'Browser Mayor', seed: 317, createdAt: '2026-08-12T00:00:00.000Z' });
  addOperationalWaterFixture(state);
  for (let y = 0; y < 48; y += 1) for (let x = 0; x < 48; x += 1) state.map.waterPipes[tile(x, y)] = true;
  // Pre-wire a single live component for a later visible treatment-plant
  // placement and for the isolated RCI control. These are fixture-only
  // accelerators; card/placement and every facility gate are exercised in
  // the visible tests above.
  for (const id of [
    tile(11, 4), tile(12, 4), tile(13, 4),
    tile(11, 5), tile(11, 6), tile(11, 7), tile(11, 8), tile(11, 9), tile(12, 9),
    // Bypass the tower footprint so demolishing the raw-water source does
    // not also sever the independent live-power proof for the RCI control.
    tile(8, 5), tile(8, 6), tile(8, 7), tile(8, 8), tile(9, 8), tile(10, 8),
  ]) state.map.powerLines[id] = true;
  const control = tile(12, 10);
  state.map.roads[tile(12, 13)] = true;
  const reserved = new Set<number>([
    ...state.map.facilities.flatMap(({ tiles }) => tiles),
    ...state.map.roads.map((occupied, id) => occupied ? id : -1).filter((id) => id >= 0),
    ...state.map.powerLines.map((occupied, id) => occupied ? id : -1).filter((id) => id >= 0),
    ...Array.from({ length: 12 }, (_, index) => tile(14 + index % 4, 4 + Math.floor(index / 4))),
    tile(14, 7),
    control,
  ]);
  const consumers: number[] = [];
  for (let id = tile(1, 9); id < TILE_COUNT && consumers.length < 400; id += 1) {
    if (reserved.has(id)) continue;
    state.map.zones[id] = 'I';
    state.economy.density[id] = 1;
    state.economy.wealth[id] = 10_000;
    consumers.push(id);
  }
  state.map.zones[control] = 'I';
  state.economy.density[control] = 1;
  state.economy.wealth[control] = 10_000;
  consumers.push(control);
  state.environment.watered[control] = true;
  // An independent gate control has a road, live conductive power, and Water
  // coverage so removing only the source proves Water-driven decline.
  await seedV2City(page, state);
  await openCity(page, cityId);

  let opening = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(opening.services.water.totalDemand).toBe(22_450);
  expect(opening.services.water.totalAllocated).toBe(20_000);
  expect(opening.environment.watered[consumers.at(-1)!]).toBe(true);
  expect(opening.environment.watered[consumers[399]!]).toBe(false);
  const openingWaterWarning = page.locator('.synthcity-water-warning');
  await expect(openingWaterWarning).toHaveCount(1);
  await expect(openingWaterWarning).toHaveAttribute('data-warning-count', '49');
  await expect(openingWaterWarning).toHaveAttribute('data-warning-tiles', new RegExp(`(?:^|,)${consumers[351]}(?:,|$)`));
  await expect(openingWaterWarning).toHaveAttribute('data-warning-tiles', new RegExp(`(?:^|,)${consumers[399]}(?:,|$)`));

  await selectWaterItem(page, 'facility:water-treatment-plant');
  await clickMapCell(page, 14, 4);
  await selectRoad(page);
  await clickMapCell(page, 14, 7);
  // Both underground pipe and conductive power may already coexist beneath
  // the treatment footprint in this seeded capacity lab. Visible facility and
  // road placement are the representative player flow.

  opening = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(opening.services.water.totalDemand).toBe(22_450);
  expect(opening.services.water.totalAllocated).toBe(22_450);
  const component = opening.services.water.components.find(({ rawCapacity }) => rawCapacity === 20_000);
  expect(component).toMatchObject({ rawCapacity: 20_000, treatmentCapacity: 50_000, usableCapacity: 40_000 });
  expect(consumers.every((consumer) => opening.environment.watered[consumer])).toBe(true);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(0);

  // Severing the source now also shuts down the thermal plant that cools from
  // it. The developed control must still visibly decline under the canonical
  // combined utility loss rather than retaining stale service.
  const densityBefore = opening.economy.density[control]!;
  await selectBulldoze(page);
  await clickMapCell(page, 9, 4);
  const dry = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(dry.environment.roadAccess[control]).toBe(true);
  expect(dry.environment.powered[control]).toBe(false);
  expect(dry.environment.watered[control]).toBe(false);
  expect(dry.economy.density[control]).toBeLessThan(densityBefore);
  const dryWaterWarnings = page.locator('.synthcity-water-warning');
  await expect(dryWaterWarnings).not.toHaveCount(0);
  expect(await dryWaterWarnings.evaluateAll((warnings, affectedTile) => warnings.some((warning) => (
    (warning.getAttribute('data-warning-tiles') ?? '').split(',').includes(String(affectedTile))
  )), control)).toBe(true);

  await attachJson(testInfo, 'water-treatment-allocation-rci.json', {
    rawCapacity: 20_000, treatmentCapacity: 50_000, usableCapacity: 40_000,
    stickyConsumer: consumers.at(-1), declinedControl: control, densityBefore, densityAfter: dry.economy.density[control],
  });
  await maybeScreenshot(page, testInfo, 'water-treatment-allocation-rci.png');
});

test('migrates a real prior-rules IndexedDB record and reloads canonical Water defaults', async ({ page }, testInfo) => {
  const cityId = `water-prior-rules-${Date.now()}`;
  const prior = createMarketCityState({ cityId, cityName: 'Pre Water City', mayorName: 'Browser Mayor', seed: 331, createdAt: '2026-08-11T00:00:00.000Z' });
  const zoned = tile(12, 12);
  prior.map.zones[zoned] = 'R';
  prior.economy.density[zoned] = 0.5;
  prior.economy.wealth[zoned] = 10_000;
  prior.map.roads[tile(12, 13)] = true;
  await seedPreWaterCity(page, prior);
  await openCity(page, cityId);

  let migrated = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
  expect(migrated.map.zones[zoned]).toBe('R');
  expect(migrated.economy.density[zoned]).toBe(0.5);
  expect(migrated.map.waterPipes.every((value) => !value)).toBe(true);
  expect(migrated.environment.watered.every((value) => !value)).toBe(true);
  expect(migrated.services.water).toMatchObject({ totalDemand: 0, totalAllocated: 0, components: [] });

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
  expect(migrated.map.zones[zoned]).toBe('R');

  await attachJson(testInfo, 'water-prior-rules-indexeddb-migration.json', { cityId, fromRules: MARKET_CITY_RULES_VERSION_PRE_WATER, toRules: MARKET_CITY_RULES_VERSION, exactReload: true });
});
