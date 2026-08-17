import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

type Dashboard = {
  hash(): string;
  snapshot(): {
    map: {
      roads: boolean[];
      avenueLanes: boolean[];
      rails: boolean[];
      powerLines: boolean[];
      waterPipes: boolean[];
      zones: Array<'R' | 'C' | 'I' | null>;
      landfillZones: boolean[];
      terrain: { elevation: number[]; water: boolean[]; material: string[]; trees: number[] };
      facilities: Array<{ id: string; kind: string; anchor: number; tiles: number[] }>;
    };
    clock: { month: number; paused: boolean };
  };
  save(): Promise<boolean>;
  whenDurable(): Promise<boolean>;
};

const expectedCommit = process.env.SYNTHCITY_EXPECTED_COMMIT;
const requireHosted = process.env.SYNTHCITY_REQUIRE_PRODUCTION === '1';
const captureEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';
const TILE_COUNT = 48 * 48;
const tile = (x: number, y: number): number => y * 48 + x;
const browserProblems = new WeakMap<Page, string[]>();

test.setTimeout(180_000);

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
  return `/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=Preview%20Parity%20QA&newMayorName=Browser%20Mayor&seed=41`;
}

async function openCity(page: Page, cityId: string): Promise<void> {
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.tile')).toHaveCount(TILE_COUNT);
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  if (expectedCommit) await expect(page.locator('html')).toHaveAttribute('data-synthcity-commit', expectedCommit);
  if (requireHosted) await expect(page.locator('html')).toHaveAttribute('data-synthcity-environment', /preview|production/);
}

async function dashboardHash(page: Page): Promise<string> {
  return page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
}

async function snapshot(page: Page): Promise<ReturnType<Dashboard['snapshot']>> {
  return page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
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

async function maybeScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!captureEvidence) return;
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function attachJson(page: Page, testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const body = Buffer.from(`${JSON.stringify({
    url: page.url(),
    expectedCommit: expectedCommit ?? null,
    hosted: requireHosted,
    results: value,
  }, null, 2)}\n`);
  if (!captureEvidence) {
    await testInfo.attach(name, { body, contentType: 'application/json' });
    return;
  }
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

async function selectRoad(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray [data-transit-category="roads"]').click();
  await page.locator('#transit-catalog-grid [data-action="road"]').click();
}

async function selectAvenue(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray [data-transit-category="roads"]').click();
  await page.locator('#transit-catalog-grid [data-action="network:avenue"]').click();
}

async function selectRail(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray [data-transit-category="rail"]').click();
  await page.locator('#transit-catalog-grid [data-action="network:rail"]').click();
}

async function selectPower(page: Page, action = 'power-line'): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray [data-utility-category="power"]').click();
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function selectWater(page: Page, action = 'network:water-pipe'): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray [data-utility-category="water"]').click();
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function selectFire(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray [data-public-service-category="fire"]').click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
}

async function selectLandfill(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray [data-public-service-category="waste"]').click();
  await page.locator('#public-service-catalog-grid [data-action="zone-landfill"]').click();
}

async function selectZone(page: Page, kind: 'residential' | 'commercial' | 'industrial'): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator(`.zones-tray [data-action="zone-${kind}"]`).click();
}

async function selectDezone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="dezone"]').click();
}

async function selectBulldoze(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bulldoze tools', exact: true }).click();
}

async function selectLandscape(page: Page, selector: string): Promise<void> {
  await page.getByRole('button', { name: 'Landscape', exact: true }).click();
  await page.locator(selector).click();
}

async function heldRoute(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  action: string,
): Promise<{ beforeHash: string }> {
  const start = await projectedPoint(page, from.x, from.y);
  const end = await projectedPoint(page, to.x, to.y);
  const beforeHash = await dashboardHash(page);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 10 });
  const selection = page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${action}"]`);
  await expect(selection).not.toHaveCount(0);
  expect(await selection.evaluateAll((elements) => elements.every((element) => element.getAttribute('data-valid') === 'true'))).toBe(true);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-mode="prospective"], #placement-preview-underground-overlays [data-preview-mode="prospective"]')).not.toHaveCount(0);
  expect(await dashboardHash(page)).toBe(beforeHash);
  return { beforeHash };
}

type RouteArmer = (page: Page) => Promise<void>;

async function placeAcceptedRoute(
  page: Page,
  arm: RouteArmer,
  from: { x: number; y: number },
  to: { x: number; y: number },
  action: string,
): Promise<void> {
  await arm(page);
  const held = await heldRoute(page, from, to, action);
  await page.mouse.up();
  expect(await dashboardHash(page)).not.toBe(held.beforeHash);
}

async function saveAndReload(page: Page): Promise<string> {
  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  const persistedHash = await dashboardHash(page);
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => dashboardHash(page)).toBe(persistedHash);
  return persistedHash;
}

async function rotateRight(page: Page, turns: number): Promise<void> {
  for (let turn = 0; turn < turns; turn += 1) {
    await page.getByRole('button', { name: 'Rotate view right', exact: true }).click();
  }
}

async function networkFingerprint(page: Page, root: string, kind: string): Promise<string[]> {
  return page.locator(`${root} [data-network-kind="${kind}"][data-tile]`).evaluateAll((elements) => elements
    .map((element) => [
      element.getAttribute('data-tile') ?? '',
      element.getAttribute('data-connection-mask') ?? '',
      element.getAttribute('data-network-topology') ?? '',
      element.getAttribute('data-world-geometry-fingerprint') ?? '',
    ].join('|'))
    .sort());
}

async function worldFingerprint(page: Page, root: string): Promise<string[]> {
  return page.locator(`${root} [data-render-item-id]`).evaluateAll((elements) => elements
    .map((element) => [
      element.getAttribute('data-render-item-id') ?? '',
      element.getAttribute('data-render-anchor-x') ?? '',
      element.getAttribute('data-render-anchor-y') ?? '',
      element.getAttribute('data-render-elevation') ?? '',
      element.getAttribute('data-render-sublayer') ?? '',
      element.getAttribute('data-world-geometry-fingerprint') ?? '',
    ].join('|'))
    .sort());
}

async function facilityFingerprint(page: Page, root: string, buildingKey: string): Promise<string[]> {
  return page.locator(`${root} [data-building-key="${buildingKey}"][data-render-item-id]`).evaluateAll((elements) => elements
    .map((element) => [
      element.getAttribute('data-render-item-id') ?? '',
      element.getAttribute('data-render-anchor-x') ?? '',
      element.getAttribute('data-render-anchor-y') ?? '',
      element.getAttribute('data-render-elevation') ?? '',
      element.getAttribute('data-render-sublayer') ?? '',
      element.getAttribute('data-world-geometry-fingerprint') ?? '',
    ].join('|'))
    .sort());
}

async function zoneFingerprint(page: Page, root: string): Promise<string[]> {
  return page.locator(`${root} .terrain-zone-world[data-zone-tiles]`).evaluateAll((elements) => elements
    .map((element) => [element.getAttribute('data-zone-tiles') ?? '', element.getAttribute('data-render-item-id') ?? ''].join('|'))
    .sort());
}

async function terrainFacetSnapshot(page: Page, root: string): Promise<Array<{ key: string; points: string; fill: string | null }>> {
  return page.locator(`${root} .terrain-facet[data-x][data-y][data-facet]`).evaluateAll((elements) => elements
    .map((element) => ({
      key: `${element.getAttribute('data-x')},${element.getAttribute('data-y')},${element.getAttribute('data-facet')}`,
      points: element.getAttribute('points') ?? '',
      fill: element.getAttribute('fill'),
    }))
    .sort((left, right) => left.key.localeCompare(right.key)));
}

async function terrainFacetsForKeys(page: Page, keys: readonly string[]): Promise<Array<{ key: string; points: string; fill: string | null }>> {
  return page.evaluate((requested) => {
    const wanted = new Set(requested);
    return [...document.querySelectorAll<SVGPolygonElement>('#terrain-surface-facets .terrain-facet[data-x][data-y][data-facet]')]
      .map((element) => ({
        key: `${element.dataset.x},${element.dataset.y},${element.dataset.facet}`,
        points: element.getAttribute('points') ?? '',
        fill: element.getAttribute('fill'),
      }))
      .filter((entry) => wanted.has(entry.key))
      .sort((left, right) => left.key.localeCompare(right.key));
  }, [...keys]);
}

test('renders a held water-pipe result that equals the released topology across both diagonal directions and camera rotations', async ({ page }, testInfo) => {
  const cases = [
    { name: 'x-first', rotation: 0, from: { x: 8, y: 8 }, to: { x: 16, y: 14 } },
    { name: 'y-first', rotation: 1, from: { x: 28, y: 8 }, to: { x: 20, y: 14 } },
    { name: 'world-x', rotation: 2, from: { x: 8, y: 24 }, to: { x: 20, y: 24 } },
    { name: 'world-y', rotation: 3, from: { x: 32, y: 22 }, to: { x: 32, y: 35 } },
  ] as const;
  const manifest: Array<Record<string, unknown>> = [];

  for (const fixture of cases) {
    const cityId = `preview-parity-pipe-${fixture.name}-${Date.now()}`;
    await openCity(page, cityId);
    for (let turn = 0; turn < fixture.rotation; turn += 1) {
      await page.getByRole('button', { name: 'Rotate view right', exact: true }).click();
    }
    await selectWater(page);
    const held = await heldRoute(page, fixture.from, fixture.to, 'network:water-pipe');
    const heldFingerprint = await networkFingerprint(page, '#placement-preview-underground-overlays', 'water-pipe');
    expect(heldFingerprint.length).toBeGreaterThan(0);
    await maybeScreenshot(page, testInfo, `pipe-${fixture.name}-held.png`);
    await page.mouse.up();
    const releasedFingerprint = await networkFingerprint(page, '#underground-network-overlays', 'water-pipe');
    expect(releasedFingerprint).toEqual(heldFingerprint);
    expect(await dashboardHash(page)).not.toBe(held.beforeHash);
    await maybeScreenshot(page, testInfo, `pipe-${fixture.name}-released.png`);
    await page.evaluate(async () => {
      const dashboard = window.marketCityDashboard as Dashboard;
      await dashboard.save();
      await dashboard.whenDurable();
    });
    const persistedHash = await dashboardHash(page);
    await page.reload({ waitUntil: 'networkidle' });
    await expect.poll(() => dashboardHash(page)).toBe(persistedHash);
    expect(await networkFingerprint(page, '#underground-network-overlays', 'water-pipe')).toEqual(releasedFingerprint);
    manifest.push({ cityId, tool: 'water-pipe', rotation: fixture.rotation, gesture: fixture.name, heldFingerprint, releasedFingerprint, pass: true });
  }

  await attachJson(page, testInfo, 'pipe-preview-parity-manifest.json', manifest);
});

test('uses the shared committed collector for every visible surface network route', async ({ page }, testInfo) => {
  const cases = [
    { name: 'road', action: 'road', arm: selectRoad, from: { x: 8, y: 8 }, to: { x: 15, y: 8 } },
    { name: 'avenue', action: 'network:avenue', arm: selectAvenue, from: { x: 8, y: 8 }, to: { x: 12, y: 8 } },
    { name: 'rail', action: 'network:rail', arm: selectRail, from: { x: 8, y: 8 }, to: { x: 15, y: 12 } },
    { name: 'power-line', action: 'power-line', arm: (target: Page) => selectPower(target), from: { x: 8, y: 8 }, to: { x: 15, y: 8 } },
  ] as const;
  const manifest: Array<Record<string, unknown>> = [];

  for (const fixture of cases) {
    const cityId = `preview-parity-network-${fixture.name}-${Date.now()}`;
    await openCity(page, cityId);
    await fixture.arm(page);
    const held = await heldRoute(page, fixture.from, fixture.to, fixture.action);
    const heldFingerprint = await worldFingerprint(page, '#placement-preview-world-overlays');
    expect(heldFingerprint.length).toBeGreaterThan(0);
    await maybeScreenshot(page, testInfo, `${fixture.name}-held.png`);
    await page.mouse.up();
    const releasedFingerprint = await worldFingerprint(page, '#terrain-construction-overlays');
    expect(releasedFingerprint).toEqual(heldFingerprint);
    expect(await dashboardHash(page)).not.toBe(held.beforeHash);
    await maybeScreenshot(page, testInfo, `${fixture.name}-released.png`);
    const persistedHash = await saveAndReload(page);
    expect(await worldFingerprint(page, '#terrain-construction-overlays')).toEqual(releasedFingerprint);
    manifest.push({ cityId, tool: fixture.name, heldFingerprint, releasedFingerprint, persistedHash, pass: true });
  }

  await attachJson(page, testInfo, 'surface-network-preview-parity-manifest.json', manifest);
});

test('keeps Road/Rail and Power Line crossings preview-identical, durable, and bidirectional through every rotation', async ({ page }, testInfo) => {
  const cases = [
    { name: 'road-then-power', surface: 'road', surfaceLayer: 'roads', first: selectRoad, firstAction: 'road', second: (target: Page) => selectPower(target), secondAction: 'power-line' },
    { name: 'power-then-road', surface: 'road', surfaceLayer: 'roads', first: (target: Page) => selectPower(target), firstAction: 'power-line', second: selectRoad, secondAction: 'road' },
    { name: 'rail-then-power', surface: 'rail', surfaceLayer: 'rails', first: selectRail, firstAction: 'network:rail', second: (target: Page) => selectPower(target), secondAction: 'power-line' },
    { name: 'power-then-rail', surface: 'rail', surfaceLayer: 'rails', first: (target: Page) => selectPower(target), firstAction: 'power-line', second: selectRail, secondAction: 'network:rail' },
  ] as const;
  const manifest: Array<Record<string, unknown>> = [];

  for (const rotation of [0, 1, 2, 3]) {
    for (const fixture of cases) {
      const cityId = `preview-parity-surface-power-${fixture.name}-r${rotation}-${Date.now()}`;
      await openCity(page, cityId);
      await rotateRight(page, rotation);
      await placeAcceptedRoute(page, fixture.first, { x: 14, y: 24 }, { x: 26, y: 24 }, fixture.firstAction);
      const baseFingerprint = await worldFingerprint(page, '#terrain-construction-overlays');
      await fixture.second(page);
      const held = await heldRoute(page, { x: 20, y: 18 }, { x: 20, y: 30 }, fixture.secondAction);
      const heldFingerprint = await worldFingerprint(page, '#placement-preview-world-overlays');
      expect(heldFingerprint.length).toBeGreaterThan(0);
      await maybeScreenshot(page, testInfo, `road-power-${fixture.name}-r${rotation}-held.png`);
      await page.mouse.up();
      const releasedFingerprint = await worldFingerprint(page, '#terrain-construction-overlays');
      // The preview collector redraws only the affected prospective scene.
      // Combining its ghost geometry with the already-committed base scene
      // must yield the exact immediate post-release scene.
      expect(releasedFingerprint).toEqual([...new Set([...baseFingerprint, ...heldFingerprint])].sort());
      const state = await snapshot(page);
      const crossing = tile(20, 24);
      expect(state.map[fixture.surfaceLayer][crossing]).toBe(true);
      expect(state.map.powerLines[crossing]).toBe(true);
      const persistedHash = await saveAndReload(page);
      await expect(page.locator(`.tile[data-x="20"][data-y="24"]`)).toHaveAttribute(
        'data-network-kinds',
        new RegExp(`${fixture.surface},power-line|power-line,${fixture.surface}`),
      );
      await maybeScreenshot(page, testInfo, `surface-power-${fixture.name}-r${rotation}-released.png`);
      manifest.push({ cityId, rotation, order: fixture.name, baseFingerprint, heldFingerprint, releasedFingerprint, persistedHash, pass: true });
    }
  }

  await attachJson(page, testInfo, 'road-power-preview-parity-manifest.json', manifest);
});

test('keeps zoning, landfill, dezone, and bulldoze previews non-persisted until release', async ({ page }, testInfo) => {
  const zoneKinds: Array<'residential' | 'commercial' | 'industrial'> = ['residential', 'commercial', 'industrial'];
  const manifest: Array<Record<string, unknown>> = [];
  for (const [index, kind] of zoneKinds.entries()) {
    const cityId = `preview-parity-zone-${kind}-${Date.now()}`;
    await openCity(page, cityId);
    await selectZone(page, kind);
    const point = await projectedPoint(page, 12 + index * 4, 12);
    const beforeHash = await dashboardHash(page);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
    const heldFingerprint = await zoneFingerprint(page, '#placement-preview-world-overlays');
    expect(heldFingerprint.length).toBeGreaterThan(0);
    expect(await dashboardHash(page)).toBe(beforeHash);
    await maybeScreenshot(page, testInfo, `zone-${kind}-held.png`);
    await page.mouse.click(point.x, point.y);
    const releasedFingerprint = await zoneFingerprint(page, '#terrain-construction-overlays');
    expect(releasedFingerprint).toEqual(heldFingerprint);
    expect((await snapshot(page)).map.zones[tile(12 + index * 4, 12)]).toBe(kind[0]!.toUpperCase());
    await maybeScreenshot(page, testInfo, `zone-${kind}-released.png`);
    const persistedHash = await saveAndReload(page);
    expect((await snapshot(page)).map.zones[tile(12 + index * 4, 12)]).toBe(kind[0]!.toUpperCase());
    manifest.push({ cityId, tool: `zone-${kind}`, gesture: 'hover-and-click', heldFingerprint, releasedFingerprint, persistedHash, pass: true });
  }

  const landfillCity = `preview-parity-landfill-${Date.now()}`;
  await openCity(page, landfillCity);
  await selectRoad(page);
  const roadStart = await projectedPoint(page, 10, 10);
  const roadEnd = await projectedPoint(page, 13, 10);
  await page.mouse.move(roadStart.x, roadStart.y);
  await page.mouse.down();
  await page.mouse.move(roadEnd.x, roadEnd.y, { steps: 6 });
  await page.mouse.up();
  await selectLandfill(page);
  const landfillPoint = await projectedPoint(page, 11, 11);
  const landfillBefore = await dashboardHash(page);
  await page.mouse.move(landfillPoint.x, landfillPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldLandfill = (await worldFingerprint(page, '#placement-preview-world-overlays')).filter((entry) => entry.startsWith('landfill:'));
  expect(heldLandfill.length).toBeGreaterThan(0);
  expect(await dashboardHash(page)).toBe(landfillBefore);
  await maybeScreenshot(page, testInfo, 'landfill-held.png');
  await page.mouse.click(landfillPoint.x, landfillPoint.y);
  const releasedLandfill = (await worldFingerprint(page, '#terrain-construction-overlays')).filter((entry) => entry.startsWith('landfill:'));
  expect(releasedLandfill).toEqual(heldLandfill);
  expect((await snapshot(page)).map.landfillZones[tile(11, 11)]).toBe(true);
  await maybeScreenshot(page, testInfo, 'landfill-released.png');

  await selectZone(page, 'residential');
  const zonePoint = await projectedPoint(page, 20, 20);
  await page.mouse.click(zonePoint.x, zonePoint.y);
  await selectDezone(page);
  const dezoneBefore = await dashboardHash(page);
  await page.mouse.move(zonePoint.x, zonePoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  // Destructive previews retain the source scene and annotate it, rather than
  // hiding the very construction or zone the player is deciding to remove.
  await expect(page.locator('#city-action-preview-overlays .city-action-preview.dezone')).not.toHaveCount(0);
  await expect(page.locator('#terrain-construction-overlays .placement-preview-suppressed')).toHaveCount(0);
  const heldDezone = await zoneFingerprint(page, '#terrain-construction-overlays');
  expect(heldDezone.length).toBeGreaterThan(0);
  expect(await dashboardHash(page)).toBe(dezoneBefore);
  await maybeScreenshot(page, testInfo, 'dezone-held.png');
  await page.mouse.click(zonePoint.x, zonePoint.y);
  expect((await snapshot(page)).map.zones[tile(20, 20)]).toBeNull();
  const releasedDezone = await zoneFingerprint(page, '#terrain-construction-overlays');
  await maybeScreenshot(page, testInfo, 'dezone-released.png');

  await selectBulldoze(page);
  const demolishBefore = await dashboardHash(page);
  await page.mouse.move(roadStart.x, roadStart.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await expect(page.locator('#bulldoze-preview-footprint .bulldoze-preview-footprint:not(.invalid)')).toHaveCount(1);
  await expect(page.locator('#terrain-construction-overlays .placement-preview-suppressed')).toHaveCount(0);
  const heldBulldoze = await worldFingerprint(page, '#terrain-construction-overlays');
  expect(heldBulldoze.length).toBeGreaterThan(0);
  expect(await dashboardHash(page)).toBe(demolishBefore);
  await maybeScreenshot(page, testInfo, 'bulldoze-held.png');
  await page.mouse.click(roadStart.x, roadStart.y);
  expect((await snapshot(page)).map.roads[tile(10, 10)]).toBe(false);
  const releasedBulldoze = await worldFingerprint(page, '#terrain-construction-overlays');
  expect(releasedBulldoze).not.toEqual(heldBulldoze);
  await maybeScreenshot(page, testInfo, 'bulldoze-released.png');
  const persistedHash = await saveAndReload(page);
  const reloadedState = await snapshot(page);
  expect(reloadedState.map.landfillZones[tile(11, 11)]).toBe(true);
  expect(reloadedState.map.zones[tile(20, 20)]).toBeNull();
  expect(reloadedState.map.roads[tile(10, 10)]).toBe(false);
  manifest.push({ cityId: landfillCity, tool: 'zone-landfill', gesture: 'hover-and-click', heldFingerprint: heldLandfill, releasedFingerprint: releasedLandfill, persistedHash, pass: true });
  manifest.push({ cityId: landfillCity, tool: 'dezone', gesture: 'hover-and-click', heldFingerprint: heldDezone, releasedFingerprint: releasedDezone, persistedHash, pass: true });
  manifest.push({ cityId: landfillCity, tool: 'bulldoze', gesture: 'hover-and-click', heldFingerprint: heldBulldoze, releasedFingerprint: releasedBulldoze, persistedHash, pass: true });
  await attachJson(page, testInfo, 'zone-and-demolition-preview-parity-manifest.json', manifest);
});

test('shows exact prospective terrain facets for elevation and all active surface/tree brushes, then confirms reset separately', async ({ page }, testInfo) => {
  const cityId = `preview-parity-terrain-${Date.now()}`;
  const manifest: Array<Record<string, unknown>> = [];
  await openCity(page, cityId);

  const paintCases = [
    { brush: 'water', cell: { x: 8, y: 8 } },
    { brush: 'land', cell: { x: 8, y: 8 } },
    { brush: 'grass-light', cell: { x: 11, y: 8 } },
    { brush: 'grass-dark', cell: { x: 14, y: 8 } },
    { brush: 'dry-ground', cell: { x: 17, y: 8 } },
    { brush: 'snow', cell: { x: 20, y: 8 } },
  ] as const;

  for (const fixture of paintCases) {
    await selectLandscape(page, `[data-terrain-brush="${fixture.brush}"]`);
    const point = await projectedPoint(page, fixture.cell.x, fixture.cell.y);
    const beforeHash = await dashboardHash(page);
    await page.mouse.move(point.x, point.y);
    await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
    const heldFacets = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
    expect(heldFacets.length).toBeGreaterThan(0);
    expect(await dashboardHash(page)).toBe(beforeHash);
    await maybeScreenshot(page, testInfo, `terrain-${fixture.brush}-held.png`);
    await page.mouse.click(point.x, point.y);
    const releasedFacets = await terrainFacetsForKeys(page, heldFacets.map((entry) => entry.key));
    expect(releasedFacets).toEqual(heldFacets);
    await maybeScreenshot(page, testInfo, `terrain-${fixture.brush}-released.png`);
    manifest.push({ cityId, tool: `terrain-${fixture.brush}`, gesture: 'hover-and-click', heldFingerprint: heldFacets, releasedFingerprint: releasedFacets, pass: true });
  }

  await selectLandscape(page, '[data-landscape-tool="raise"]');
  const elevationPoint = await projectedPoint(page, 28, 18);
  const elevationBefore = await dashboardHash(page);
  await page.mouse.move(elevationPoint.x, elevationPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldElevation = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
  expect(await dashboardHash(page)).toBe(elevationBefore);
  await maybeScreenshot(page, testInfo, 'raise-held.png');
  await page.mouse.click(elevationPoint.x, elevationPoint.y);
  const releasedElevation = await terrainFacetsForKeys(page, heldElevation.map((entry) => entry.key));
  expect(releasedElevation).toEqual(heldElevation);
  expect((await snapshot(page)).map.terrain.elevation[tile(28, 18)]).toBeGreaterThan(0);
  await maybeScreenshot(page, testInfo, 'raise-released.png');
  manifest.push({ cityId, tool: 'terrain-raise', gesture: 'hover-and-click', heldFingerprint: heldElevation, releasedFingerprint: releasedElevation, pass: true });

  await selectLandscape(page, '[data-landscape-tool="lower"]');
  const lowerPoint = await projectedPoint(page, 31, 18);
  await page.mouse.move(lowerPoint.x, lowerPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldLower = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
  await maybeScreenshot(page, testInfo, 'lower-held.png');
  await page.mouse.click(lowerPoint.x, lowerPoint.y);
  const releasedLower = await terrainFacetsForKeys(page, heldLower.map((entry) => entry.key));
  expect(releasedLower).toEqual(heldLower);
  expect((await snapshot(page)).map.terrain.elevation[tile(31, 18)]).toBeLessThan(0);
  await maybeScreenshot(page, testInfo, 'lower-released.png');
  manifest.push({ cityId, tool: 'terrain-lower', gesture: 'hover-and-click', heldFingerprint: heldLower, releasedFingerprint: releasedLower, pass: true });

  await selectLandscape(page, '[data-landscape-tool="level"]');
  const levelSourcePoint = await projectedPoint(page, 37, 18);
  await page.mouse.click(levelSourcePoint.x, levelSourcePoint.y);
  await page.mouse.move(elevationPoint.x, elevationPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldLevel = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
  await maybeScreenshot(page, testInfo, 'level-held.png');
  await page.mouse.click(elevationPoint.x, elevationPoint.y);
  const releasedLevel = await terrainFacetsForKeys(page, heldLevel.map((entry) => entry.key));
  expect(releasedLevel).toEqual(heldLevel);
  expect((await snapshot(page)).map.terrain.elevation[tile(28, 18)]).toBe((await snapshot(page)).map.terrain.elevation[tile(37, 18)]);
  await maybeScreenshot(page, testInfo, 'level-released.png');
  manifest.push({ cityId, tool: 'terrain-level', gesture: 'source-then-hover-and-click', heldFingerprint: heldLevel, releasedFingerprint: releasedLevel, pass: true });

  await selectLandscape(page, '[data-terrain-brush="snow"]');
  await page.locator('[data-terrain-mode="area"]').click();
  const areaStart = await projectedPoint(page, 10, 26);
  const areaEnd = await projectedPoint(page, 14, 28);
  const areaBefore = await dashboardHash(page);
  await page.mouse.move(areaStart.x, areaStart.y);
  await page.mouse.down();
  await page.mouse.move(areaEnd.x, areaEnd.y, { steps: 8 });
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldAreaFacets = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
  expect(await dashboardHash(page)).toBe(areaBefore);
  await maybeScreenshot(page, testInfo, 'snow-area-held.png');
  await page.mouse.up();
  const releasedAreaFacets = await terrainFacetsForKeys(page, heldAreaFacets.map((entry) => entry.key));
  expect(releasedAreaFacets).toEqual(heldAreaFacets);
  await maybeScreenshot(page, testInfo, 'snow-area-released.png');
  manifest.push({ cityId, tool: 'terrain-snow', gesture: 'area-drag', heldFingerprint: heldAreaFacets, releasedFingerprint: releasedAreaFacets, pass: true });

  const resetBefore = await dashboardHash(page);
  await selectLandscape(page, '[data-landscape-tool="reset"]');
  await expect(page.locator('#landscape-reset-dialog')).toBeVisible();
  await expect(page.locator('.city-client')).toHaveAttribute('data-landscape-reset-pending', 'true');
  expect(await dashboardHash(page)).toBe(resetBefore);
  await maybeScreenshot(page, testInfo, 'reset-confirmation.png');
  await page.getByRole('button', { name: 'Reset elevation', exact: true }).click();
  await expect(page.locator('#landscape-reset-dialog')).toBeHidden();
  expect(await dashboardHash(page)).not.toBe(resetBefore);
  const resetState = await snapshot(page);
  expect(resetState.map.terrain.elevation.every((value) => value === 0)).toBe(true);
  await maybeScreenshot(page, testInfo, 'reset-released.png');
  const terrainPersistedHash = await saveAndReload(page);
  expect(await dashboardHash(page)).toBe(terrainPersistedHash);
  expect((await snapshot(page)).map.terrain.elevation.every((value) => value === 0)).toBe(true);
  manifest.push({ cityId, tool: 'terrain-reset', gesture: 'confirmation-before-and-after', heldFingerprint: [], releasedFingerprint: [], persistedHash: terrainPersistedHash, pass: true });
  await attachJson(page, testInfo, 'terrain-preview-parity-manifest.json', manifest);
});

test('keeps tree add, removal, and a contiguous held brush preview identical to release', async ({ page }, testInfo) => {
  const cityId = `preview-parity-trees-${Date.now()}`;
  const manifest: Array<Record<string, unknown>> = [];
  await openCity(page, cityId);

  const pointCell = { x: 23, y: 8 };
  const point = await projectedPoint(page, pointCell.x, pointCell.y);
  await selectLandscape(page, '[data-terrain-brush="trees-add"]');
  const addBefore = await dashboardHash(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldAddTrees = (await worldFingerprint(page, '#placement-preview-world-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(heldAddTrees).toHaveLength(1);
  expect(await dashboardHash(page)).toBe(addBefore);
  await maybeScreenshot(page, testInfo, 'trees-add-held.png');
  await page.mouse.click(point.x, point.y);
  const releasedAddTrees = (await worldFingerprint(page, '#terrain-construction-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(releasedAddTrees).toEqual(heldAddTrees);
  await maybeScreenshot(page, testInfo, 'trees-add-released.png');
  manifest.push({ cityId, tool: 'terrain-trees-add', gesture: 'hover-and-click', heldFingerprint: heldAddTrees, releasedFingerprint: releasedAddTrees, pass: true });

  await selectLandscape(page, '[data-terrain-brush="trees-remove"]');
  const removeBefore = await dashboardHash(page);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldRemoveTrees = (await worldFingerprint(page, '#placement-preview-world-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(heldRemoveTrees).toEqual([]);
  expect(await dashboardHash(page)).toBe(removeBefore);
  await maybeScreenshot(page, testInfo, 'trees-remove-held.png');
  await page.mouse.click(point.x, point.y);
  const releasedRemoveTrees = (await worldFingerprint(page, '#terrain-construction-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(releasedRemoveTrees).toEqual(heldRemoveTrees);
  await maybeScreenshot(page, testInfo, 'trees-remove-released.png');
  manifest.push({ cityId, tool: 'terrain-trees-remove', gesture: 'hover-and-click', heldFingerprint: heldRemoveTrees, releasedFingerprint: releasedRemoveTrees, pass: true });

  await selectLandscape(page, '[data-terrain-brush="trees-add"]');
  const brushStart = await projectedPoint(page, 20, 26);
  const brushBefore = await dashboardHash(page);
  await page.mouse.move(brushStart.x, brushStart.y);
  await page.mouse.down();
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  expect(await dashboardHash(page)).toBe(brushBefore);
  // Traverse the held brush one physical tile at a time so each contiguous
  // placement remains observable before the single release below.
  const brushStroke = await Promise.all([21, 22, 23, 24].map((x) => projectedPoint(page, x, 26)));
  for (const brushPoint of brushStroke) {
    await page.mouse.move(brushPoint.x, brushPoint.y);
    await page.waitForTimeout(96);
  }
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  const heldTrees = (await worldFingerprint(page, '#placement-preview-world-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(heldTrees.length).toBeGreaterThan(0);
  expect(await dashboardHash(page)).toBe(brushBefore);
  await maybeScreenshot(page, testInfo, 'trees-brush-held.png');
  await page.mouse.up();
  const releasedTrees = (await worldFingerprint(page, '#terrain-construction-overlays')).filter((entry) => entry.startsWith('tree:'));
  expect(releasedTrees).toEqual(heldTrees);
  expect((await snapshot(page)).map.terrain.trees.slice(tile(20, 26), tile(25, 26)).some((level) => level > 0)).toBe(true);
  await maybeScreenshot(page, testInfo, 'trees-brush-released.png');
  const persistedHash = await saveAndReload(page);
  expect(await dashboardHash(page)).toBe(persistedHash);
  manifest.push({ cityId, tool: 'terrain-trees-add-brush', gesture: 'held-contiguous-brush-drag', heldFingerprint: heldTrees, releasedFingerprint: releasedTrees, persistedHash, pass: true });
  await attachJson(page, testInfo, 'tree-preview-parity-manifest.json', manifest);
});

type FacilityFixture = {
  kind: string;
  action: string;
  category: 'power' | 'water' | 'rail' | 'fire';
  anchor: { x: number; y: number };
  footprint: { width: number; height: number };
  needsPipe?: boolean;
  needsPowerLine?: boolean;
  needsRail?: boolean;
  needsShoreline?: boolean;
};

async function installFacilityPrerequisites(page: Page, fixture: FacilityFixture): Promise<void> {
  const roadY = fixture.anchor.y + fixture.footprint.height + 1;
  const routeStart = { x: fixture.anchor.x - 1, y: roadY };
  const routeEnd = { x: fixture.anchor.x + fixture.footprint.width, y: roadY };
  await placeAcceptedRoute(page, selectRoad, routeStart, routeEnd, 'road');

  if (fixture.needsPowerLine) {
    await placeAcceptedRoute(
      page,
      (target) => selectPower(target),
      { x: routeStart.x, y: roadY + 1 },
      { x: routeEnd.x, y: roadY + 1 },
      'power-line',
    );
  }
  if (fixture.needsPipe) {
    await placeAcceptedRoute(
      page,
      (target) => selectWater(target),
      { x: routeStart.x, y: roadY + 2 },
      { x: routeEnd.x, y: roadY + 2 },
      'network:water-pipe',
    );
  }
  if (fixture.needsRail) {
    await placeAcceptedRoute(
      page,
      selectRail,
      { x: routeStart.x, y: fixture.anchor.y + fixture.footprint.height },
      { x: routeEnd.x, y: fixture.anchor.y + fixture.footprint.height },
      'network:rail',
    );
  }
  if (fixture.needsShoreline) {
    await selectLandscape(page, '[data-terrain-brush="water"]');
    const shorelinePoint = await projectedPoint(page, fixture.anchor.x - 1, fixture.anchor.y + 1);
    await page.mouse.click(shorelinePoint.x, shorelinePoint.y);
    expect((await snapshot(page)).map.terrain.water[tile(fixture.anchor.x - 1, fixture.anchor.y + 1)]).toBe(true);
  }
}

test('renders an accepted ghost and the matching committed facility art for every active player-facing facility', async ({ page }, testInfo) => {
  const facilities: FacilityFixture[] = [
    { kind: 'coal-power-plant', action: 'facility:coal-power-plant', category: 'power', anchor: { x: 8, y: 8 }, footprint: { width: 2, height: 3 } },
    { kind: 'gas-power-plant', action: 'facility:gas-power-plant', category: 'power', anchor: { x: 14, y: 8 }, footprint: { width: 2, height: 3 } },
    { kind: 'nuclear-power-plant', action: 'facility:nuclear-power-plant', category: 'power', anchor: { x: 20, y: 8 }, footprint: { width: 3, height: 3 } },
    { kind: 'wind-turbine', action: 'facility:wind-turbine', category: 'power', anchor: { x: 27, y: 8 }, footprint: { width: 1, height: 1 } },
    { kind: 'solar-plant', action: 'facility:solar-plant', category: 'power', anchor: { x: 31, y: 8 }, footprint: { width: 4, height: 2 } },
    { kind: 'water-tower', action: 'facility:water-tower', category: 'water', anchor: { x: 8, y: 18 }, footprint: { width: 2, height: 2 }, needsPipe: true, needsPowerLine: true },
    { kind: 'coastal-water-pump', action: 'facility:coastal-water-pump', category: 'water', anchor: { x: 20, y: 26 }, footprint: { width: 3, height: 3 }, needsPipe: true, needsPowerLine: true, needsShoreline: true },
    { kind: 'water-treatment-plant', action: 'facility:water-treatment-plant', category: 'water', anchor: { x: 14, y: 18 }, footprint: { width: 4, height: 3 }, needsPipe: true, needsPowerLine: true },
    { kind: 'train-station', action: 'facility:train-station', category: 'rail', anchor: { x: 21, y: 18 }, footprint: { width: 2, height: 2 }, needsRail: true },
    { kind: 'fire-station', action: 'facility:fire-station', category: 'fire', anchor: { x: 27, y: 18 }, footprint: { width: 1, height: 1 } },
  ];
  const manifest: Array<Record<string, unknown>> = [];

  for (const fixture of facilities) {
    const cityId = `preview-parity-facility-${fixture.kind}-${Date.now()}`;
    await openCity(page, cityId);
    await installFacilityPrerequisites(page, fixture);
    if (fixture.category === 'power') await selectPower(page, fixture.action);
    if (fixture.category === 'water') await selectWater(page, fixture.action);
    if (fixture.category === 'rail') {
      await page.locator('.rail-tool[data-panel="transit"]').click();
      await page.locator('.transit-tray [data-transit-category="rail"]').click();
      await page.locator(`#transit-catalog-grid [data-action="${fixture.action}"]`).click();
    }
    if (fixture.category === 'fire') await selectFire(page);
    const point = await projectedPoint(page, fixture.anchor.x, fixture.anchor.y);
    const beforeHash = await dashboardHash(page);
    await page.mouse.move(point.x, point.y);
    const previewRoot = page.locator(`#placement-preview-world-overlays [data-preview-root="true"][data-facility-kind="${fixture.kind}"]`);
    await expect(previewRoot).toHaveCount(1);
    const heldFingerprint = await worldFingerprint(page, '#placement-preview-world-overlays');
    expect(heldFingerprint.length).toBeGreaterThan(0);
    const heldBuildingKeys = await previewRoot.locator('[data-building-key]').evaluateAll((elements) => [...new Set(
      elements.map((element) => element.getAttribute('data-building-key') ?? '').filter(Boolean),
    )]);
    expect(heldBuildingKeys).toHaveLength(1);
    const heldFacilityFingerprint = await facilityFingerprint(page, '#placement-preview-world-overlays', heldBuildingKeys[0]!);
    expect(heldFacilityFingerprint.length).toBeGreaterThan(0);
    expect(await dashboardHash(page)).toBe(beforeHash);
    await maybeScreenshot(page, testInfo, `facility-${fixture.kind}-held.png`);
    await page.mouse.click(point.x, point.y);
    const state = await snapshot(page);
    const facility = state.map.facilities.find((candidate) => candidate.kind === fixture.kind);
    expect(facility).toBeDefined();
    expect(facility!.id).toBe(heldBuildingKeys[0]);
    const committed = page.locator(`#terrain-construction-overlays [data-building-key="${facility!.id}"]`);
    expect(await committed.count()).toBeGreaterThan(0);
    const committedRenderItems = await facilityFingerprint(page, '#terrain-construction-overlays', facility!.id);
    expect(heldFacilityFingerprint).toEqual(committedRenderItems);
    expect(await dashboardHash(page)).not.toBe(beforeHash);
    await maybeScreenshot(page, testInfo, `facility-${fixture.kind}-released.png`);
    const persistedHash = await saveAndReload(page);
    expect(await facilityFingerprint(page, '#terrain-construction-overlays', facility!.id)).toEqual(committedRenderItems);
    manifest.push({ cityId, tool: fixture.kind, heldFingerprint, heldFacilityFingerprint, committedRenderItems, persistedHash, pass: true });
  }

  await attachJson(page, testInfo, 'facility-preview-parity-manifest.json', manifest);
});

test('keeps rejected map actions visibly invalid, ghost-free, and non-persistent', async ({ page }, testInfo) => {
  const manifest: Array<Record<string, unknown>> = [];
  const waterCity = `preview-parity-invalid-water-${Date.now()}`;
  await openCity(page, waterCity);
  await selectLandscape(page, '[data-terrain-brush="water"]');
  await page.locator('[data-terrain-mode="area"]').click();
  const waterAreaStart = await projectedPoint(page, 10, 10);
  const waterAreaEnd = await projectedPoint(page, 16, 16);
  await page.mouse.move(waterAreaStart.x, waterAreaStart.y);
  await page.mouse.down();
  await page.mouse.move(waterAreaEnd.x, waterAreaEnd.y, { steps: 8 });
  await page.mouse.up();
  expect((await snapshot(page)).map.terrain.water[tile(12, 12)]).toBe(true);
  expect((await snapshot(page)).map.terrain.water[tile(15, 12)]).toBe(true);

  await selectWater(page);
  const waterPoint = await projectedPoint(page, 12, 12);
  const pipeStart = await projectedPoint(page, 12, 12);
  const pipeEnd = await projectedPoint(page, 15, 12);
  const pipeHash = await dashboardHash(page);
  await page.mouse.move(pipeStart.x, pipeStart.y);
  await page.mouse.down();
  await page.mouse.move(pipeEnd.x, pipeEnd.y, { steps: 4 });
  await expect(page.locator('#city-action-preview-overlays .city-action-preview.invalid[data-action="network:water-pipe"]')).not.toHaveCount(0);
  const invalidPipeGhosts = await page.locator('#placement-preview-world-overlays [data-preview-root="true"], #placement-preview-underground-overlays [data-preview-root="true"]').evaluateAll((elements) => elements.map((element) => ({
    mode: element.getAttribute('data-preview-mode'),
    network: element.getAttribute('data-network-kind'),
    changed: element.getAttribute('data-changed-tile-ids'),
    markup: element.innerHTML.slice(0, 160),
  })));
  expect(invalidPipeGhosts).toEqual([]);
  expect(await dashboardHash(page)).toBe(pipeHash);
  await maybeScreenshot(page, testInfo, 'invalid-water-pipe-held.png');
  await page.mouse.up();
  expect(await dashboardHash(page)).toBe(pipeHash);
  manifest.push({ cityId: waterCity, tool: 'water-pipe', gesture: 'invalid-route-on-water', ghostCount: invalidPipeGhosts.length, hash: pipeHash, pass: true });

  await selectZone(page, 'residential');
  const zoneHash = await dashboardHash(page);
  await page.mouse.move(waterPoint.x, waterPoint.y);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview.invalid[data-action="zone-residential"]')).not.toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'invalid-zone-held.png');
  await page.mouse.click(waterPoint.x, waterPoint.y);
  expect(await dashboardHash(page)).toBe(zoneHash);
  manifest.push({ cityId: waterCity, tool: 'zone-residential', gesture: 'invalid-water-target', ghostCount: 0, hash: zoneHash, pass: true });

  const terrainCity = `preview-parity-invalid-terrain-${Date.now()}`;
  await openCity(page, terrainCity);
  await placeAcceptedRoute(page, (target) => selectWater(target), { x: 18, y: 18 }, { x: 21, y: 18 }, 'network:water-pipe');
  await selectLandscape(page, '[data-terrain-brush="water"]');
  const firstPipeTile = (await snapshot(page)).map.waterPipes.findIndex(Boolean);
  expect(firstPipeTile).toBeGreaterThanOrEqual(0);
  const roadPoint = await projectedPoint(page, firstPipeTile % 48, Math.floor(firstPipeTile / 48));
  const terrainHash = await dashboardHash(page);
  await page.mouse.move(roadPoint.x, roadPoint.y);
  await expect(page.locator('#terrain-preview-facets .terrain-material-preview.invalid')).not.toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'invalid-terrain-held.png');
  await page.mouse.click(roadPoint.x, roadPoint.y);
  expect(await dashboardHash(page)).toBe(terrainHash);
  manifest.push({ cityId: terrainCity, tool: 'terrain-water', gesture: 'invalid-pipe-target', ghostCount: 0, hash: terrainHash, pass: true });

  const facilityCity = `preview-parity-invalid-facility-${Date.now()}`;
  await openCity(page, facilityCity);
  const fireFixture: FacilityFixture = {
    kind: 'fire-station', action: 'facility:fire-station', category: 'fire', anchor: { x: 24, y: 24 }, footprint: { width: 1, height: 1 },
  };
  await installFacilityPrerequisites(page, fireFixture);
  await selectFire(page);
  const firePoint = await projectedPoint(page, fireFixture.anchor.x, fireFixture.anchor.y);
  await page.mouse.click(firePoint.x, firePoint.y);
  const blockedFacilityHash = await dashboardHash(page);
  await page.mouse.move(firePoint.x, firePoint.y);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview.invalid[data-action="facility:fire-station"]')).not.toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'invalid-fire-station-held.png');
  await page.mouse.click(firePoint.x, firePoint.y);
  expect(await dashboardHash(page)).toBe(blockedFacilityHash);
  manifest.push({ cityId: facilityCity, tool: 'fire-station', gesture: 'blocked-footprint', ghostCount: 0, hash: blockedFacilityHash, pass: true });

  const coastCity = `preview-parity-invalid-coast-${Date.now()}`;
  await openCity(page, coastCity);
  const coastalFixture: FacilityFixture = {
    kind: 'coastal-water-pump', action: 'facility:coastal-water-pump', category: 'water', anchor: { x: 20, y: 26 }, footprint: { width: 3, height: 3 }, needsPipe: true, needsPowerLine: true,
  };
  await installFacilityPrerequisites(page, coastalFixture);
  await selectWater(page, coastalFixture.action);
  const coastPoint = await projectedPoint(page, coastalFixture.anchor.x, coastalFixture.anchor.y);
  const coastHash = await dashboardHash(page);
  await page.mouse.move(coastPoint.x, coastPoint.y);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview.invalid[data-action="facility:coastal-water-pump"]')).not.toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'invalid-coastal-water-pump-held.png');
  await page.mouse.click(coastPoint.x, coastPoint.y);
  expect(await dashboardHash(page)).toBe(coastHash);
  manifest.push({ cityId: coastCity, tool: 'coastal-water-pump', gesture: 'invalid-inland-footprint', ghostCount: 0, hash: coastHash, pass: true });

  const demolishCity = `preview-parity-invalid-demolish-${Date.now()}`;
  await openCity(page, demolishCity);
  await selectBulldoze(page);
  const emptyPoint = await projectedPoint(page, 14, 14);
  const demolishHash = await dashboardHash(page);
  await page.mouse.move(emptyPoint.x, emptyPoint.y);
  await expect(page.locator('#bulldoze-preview-footprint .bulldoze-preview-footprint.invalid')).toHaveCount(1);
  await expect(page.locator('#bulldoze-preview-label')).toContainText('Nothing can be demolished');
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'invalid-bulldoze-held.png');
  await page.mouse.click(emptyPoint.x, emptyPoint.y);
  expect(await dashboardHash(page)).toBe(demolishHash);
  manifest.push({ cityId: demolishCity, tool: 'bulldoze', gesture: 'empty-target', ghostCount: 0, hash: demolishHash, pass: true });
  await attachJson(page, testInfo, 'invalid-preview-parity-manifest.json', manifest);
});

test('clears accepted prospective scenes on Escape, right-click, rotation, and release without persisting a cancelled state', async ({ page }) => {
  const cityId = `preview-parity-cancel-${Date.now()}`;
  await openCity(page, cityId);
  await selectRoad(page);
  const from = { x: 10, y: 10 };
  const to = { x: 16, y: 14 };
  const held = await heldRoute(page, from, to, 'road');
  await page.keyboard.press('Escape');
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"], #placement-preview-underground-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await dashboardHash(page)).toBe(held.beforeHash);

  await selectFire(page);
  const firePoint = await projectedPoint(page, 26, 20);
  const rightClickHash = await dashboardHash(page);
  await page.mouse.move(firePoint.x, firePoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  await page.mouse.click(firePoint.x, firePoint.y, { button: 'right' });
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await dashboardHash(page)).toBe(rightClickHash);

  await selectRoad(page);
  const rotationPoint = await projectedPoint(page, 30, 16);
  const rotationHash = await dashboardHash(page);
  await page.mouse.move(rotationPoint.x, rotationPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rotate view right', exact: true }).click();
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await dashboardHash(page)).toBe(rotationHash);
  await expect(page.locator('.city-client')).toHaveAttribute('data-map-tool', 'default');
  await selectRoad(page);
  const rotatedPoint = await projectedPoint(page, 30, 16);
  await page.mouse.move(rotatedPoint.x, rotatedPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
  await page.mouse.click(rotatedPoint.x, rotatedPoint.y);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await dashboardHash(page)).not.toBe(rotationHash);
});

async function assertRotationPreviewParity(page: Page, testInfo: TestInfo, rotation: number): Promise<void> {
  const manifest: Array<Record<string, unknown>> = [];

    const terrainCity = `preview-parity-rotation-terrain-${rotation}-${Date.now()}`;
    await openCity(page, terrainCity);
    await rotateRight(page, rotation);
    await selectLandscape(page, '[data-terrain-brush="snow"]');
    const terrainPoint = await projectedPoint(page, 10, 10);
    await page.mouse.move(terrainPoint.x, terrainPoint.y);
    await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
    const heldTerrain = await terrainFacetSnapshot(page, '#placement-preview-world-overlays');
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-terrain-held.png`);
    await page.mouse.click(terrainPoint.x, terrainPoint.y);
    expect(await terrainFacetsForKeys(page, heldTerrain.map((entry) => entry.key))).toEqual(heldTerrain);
    const terrainHash = await saveAndReload(page);
    // A flat material-only city lazily omits the duplicated SVG terrain mesh
    // after reload. Selecting the already-used brush is a visible, no-write
    // way to restore the same renderer surface before comparing pixels.
    await rotateRight(page, rotation);
    await selectLandscape(page, '[data-terrain-brush="snow"]');
    expect(await terrainFacetsForKeys(page, heldTerrain.map((entry) => entry.key))).toEqual(heldTerrain);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-terrain-released.png`);
    manifest.push({ cityId: terrainCity, family: 'terrain', rotation, heldFingerprint: heldTerrain, hash: terrainHash, pass: true });

    const zoneCity = `preview-parity-rotation-zone-${rotation}-${Date.now()}`;
    await openCity(page, zoneCity);
    await rotateRight(page, rotation);
    await selectZone(page, 'commercial');
    const zonePoint = await projectedPoint(page, 16, 14);
    await page.mouse.move(zonePoint.x, zonePoint.y);
    await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(1);
    const heldZone = await zoneFingerprint(page, '#placement-preview-world-overlays');
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-zone-held.png`);
    await page.mouse.click(zonePoint.x, zonePoint.y);
    expect(await zoneFingerprint(page, '#terrain-construction-overlays')).toEqual(heldZone);
    const zoneHash = await saveAndReload(page);
    await rotateRight(page, rotation);
    expect(await zoneFingerprint(page, '#terrain-construction-overlays')).toEqual(heldZone);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-zone-released.png`);
    manifest.push({ cityId: zoneCity, family: 'zone', rotation, heldFingerprint: heldZone, hash: zoneHash, pass: true });

    const networkCity = `preview-parity-rotation-network-${rotation}-${Date.now()}`;
    await openCity(page, networkCity);
    await rotateRight(page, rotation);
    await selectRoad(page);
    const networkHeld = await heldRoute(page, { x: 9, y: 24 }, { x: 16, y: 24 }, 'road');
    const heldNetwork = await worldFingerprint(page, '#placement-preview-world-overlays');
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-network-held.png`);
    await page.mouse.up();
    const releasedNetwork = await worldFingerprint(page, '#terrain-construction-overlays');
    expect(releasedNetwork).toEqual(heldNetwork);
    expect(await dashboardHash(page)).not.toBe(networkHeld.beforeHash);
    const networkHash = await saveAndReload(page);
    await rotateRight(page, rotation);
    expect(await worldFingerprint(page, '#terrain-construction-overlays')).toEqual(releasedNetwork);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-network-released.png`);
    manifest.push({ cityId: networkCity, family: 'network', rotation, heldFingerprint: heldNetwork, releasedFingerprint: releasedNetwork, hash: networkHash, pass: true });

    const facilityCity = `preview-parity-rotation-facility-${rotation}-${Date.now()}`;
    await openCity(page, facilityCity);
    await rotateRight(page, rotation);
    const rotationFacility: FacilityFixture = {
      kind: 'fire-station', action: 'facility:fire-station', category: 'fire', anchor: { x: 28, y: 20 }, footprint: { width: 1, height: 1 },
    };
    await installFacilityPrerequisites(page, rotationFacility);
    await selectFire(page);
    const facilityPoint = await projectedPoint(page, rotationFacility.anchor.x, rotationFacility.anchor.y);
    await page.mouse.move(facilityPoint.x, facilityPoint.y);
    const facilityRoot = page.locator('#placement-preview-world-overlays [data-preview-root="true"][data-facility-kind="fire-station"]');
    await expect(facilityRoot).toHaveCount(1);
    const facilityKeys = await facilityRoot.locator('[data-building-key]').evaluateAll((elements) => [...new Set(
      elements.map((element) => element.getAttribute('data-building-key') ?? '').filter(Boolean),
    )]);
    expect(facilityKeys).toHaveLength(1);
    const heldFacility = await facilityFingerprint(page, '#placement-preview-world-overlays', facilityKeys[0]!);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-facility-held.png`);
    await page.mouse.click(facilityPoint.x, facilityPoint.y);
    expect(await facilityFingerprint(page, '#terrain-construction-overlays', facilityKeys[0]!)).toEqual(heldFacility);
    const facilityHash = await saveAndReload(page);
    await rotateRight(page, rotation);
    expect(await facilityFingerprint(page, '#terrain-construction-overlays', facilityKeys[0]!)).toEqual(heldFacility);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-facility-released.png`);
    manifest.push({ cityId: facilityCity, family: 'facility', rotation, heldFingerprint: heldFacility, hash: facilityHash, pass: true });

    const demolishCity = `preview-parity-rotation-demolish-${rotation}-${Date.now()}`;
    await openCity(page, demolishCity);
    await rotateRight(page, rotation);
    await selectRoad(page);
    const singleRoadPoint = await projectedPoint(page, 22, 28);
    await page.mouse.click(singleRoadPoint.x, singleRoadPoint.y);
    const roadTileId = (await snapshot(page)).map.roads.findIndex(Boolean);
    expect(roadTileId).toBeGreaterThanOrEqual(0);
    await selectBulldoze(page);
    const demolitionPoint = await projectedPoint(page, roadTileId % 48, Math.floor(roadTileId / 48));
    await page.mouse.move(demolitionPoint.x, demolitionPoint.y);
    await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
    await expect(page.locator('#bulldoze-preview-footprint .bulldoze-preview-footprint:not(.invalid)')).toHaveCount(1);
    await expect(page.locator('#terrain-construction-overlays .placement-preview-suppressed')).toHaveCount(0);
    const heldDemolition = await worldFingerprint(page, '#terrain-construction-overlays');
    expect(heldDemolition.length).toBeGreaterThan(0);
    const demolitionBefore = await dashboardHash(page);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-demolish-held.png`);
    await page.mouse.click(demolitionPoint.x, demolitionPoint.y);
    expect(await dashboardHash(page)).not.toBe(demolitionBefore);
    expect((await snapshot(page)).map.roads[roadTileId]).toBe(false);
    const releasedDemolition = await worldFingerprint(page, '#terrain-construction-overlays');
    expect(releasedDemolition).not.toEqual(heldDemolition);
    const demolitionHash = await saveAndReload(page);
    await rotateRight(page, rotation);
    expect((await snapshot(page)).map.roads[roadTileId]).toBe(false);
    await maybeScreenshot(page, testInfo, `rotation-${rotation}-demolish-released.png`);
    manifest.push({ cityId: demolishCity, family: 'demolition', rotation, heldFingerprint: heldDemolition, releasedFingerprint: releasedDemolition, hash: demolitionHash, pass: true });
  await attachJson(page, testInfo, 'rotation-preview-parity-manifest.json', manifest);
}

for (const rotation of [0, 1, 2, 3]) {
  test(`keeps prospective terrain, zones, networks, facilities, and demolition geometry correct through camera rotation ${rotation}`, async ({ page }, testInfo) => {
    await assertRotationPreviewParity(page, testInfo, rotation);
  });
}

test('runs a visible Play/Pause smoke city after UI-built zoning, power, water, fire, and landfill placements', async ({ page }, testInfo) => {
  const cityId = `preview-parity-simulation-${Date.now()}`;
  await openCity(page, cityId);
  await placeAcceptedRoute(page, selectRoad, { x: 6, y: 25 }, { x: 40, y: 25 }, 'road');
  await placeAcceptedRoute(page, (target) => selectPower(target), { x: 18, y: 26 }, { x: 30, y: 26 }, 'power-line');
  await placeAcceptedRoute(page, (target) => selectWater(target), { x: 23, y: 27 }, { x: 35, y: 27 }, 'network:water-pipe');

  await selectPower(page, 'facility:wind-turbine');
  const windPoint = await projectedPoint(page, 17, 26);
  await page.mouse.click(windPoint.x, windPoint.y);
  await selectPower(page, 'facility:coal-power-plant');
  const plantPoint = await projectedPoint(page, 18, 22);
  await page.mouse.click(plantPoint.x, plantPoint.y);
  await selectWater(page, 'facility:water-tower');
  const towerPoint = await projectedPoint(page, 24, 23);
  await page.mouse.click(towerPoint.x, towerPoint.y);
  await selectZone(page, 'residential');
  const zonePoint = await projectedPoint(page, 10, 24);
  await page.mouse.click(zonePoint.x, zonePoint.y);
  await selectLandfill(page);
  const landfillPoint = await projectedPoint(page, 34, 24);
  await page.mouse.click(landfillPoint.x, landfillPoint.y);

  await selectFire(page);
  const firePoint = await projectedPoint(page, 28, 24);
  await page.mouse.move(firePoint.x, firePoint.y);
  await expect(page.locator('#fire-station-placement-feedback .fire-station-placement-pulse')).toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"][data-facility-kind="fire-station"]')).toHaveCount(1);
  await maybeScreenshot(page, testInfo, 'simulation-fire-held.png');
  await page.mouse.click(firePoint.x, firePoint.y);
  await expect(page.locator('#fire-station-placement-feedback .fire-station-placement-pulse')).toHaveCount(1);
  await maybeScreenshot(page, testInfo, 'simulation-city-before-play.png');

  const stateBeforePlay = await snapshot(page);
  expect(stateBeforePlay.map.facilities.map((facility) => facility.kind)).toEqual(expect.arrayContaining([
    'coal-power-plant', 'water-tower', 'fire-station',
  ]));
  expect(stateBeforePlay.map.landfillZones[tile(34, 24)]).toBe(true);
  expect(stateBeforePlay.map.zones[tile(10, 24)]).toBe('R');
  const speed = page.locator('#simulation-speed');
  await speed.click();
  await expect(speed).toHaveAttribute('data-speed', '1');
  await expect.poll(async () => (await snapshot(page)).clock.month).toBeGreaterThan(stateBeforePlay.clock.month);
  await speed.click();
  await speed.click();
  await speed.click();
  await expect(speed).toHaveAttribute('data-speed', '0');
  expect((await snapshot(page)).clock.paused).toBe(true);
  await maybeScreenshot(page, testInfo, 'simulation-city-paused.png');

  const persistedHash = await saveAndReload(page);
  const reloaded = await snapshot(page);
  expect(await dashboardHash(page)).toBe(persistedHash);
  expect(reloaded.map.facilities.map((facility) => facility.kind)).toEqual(expect.arrayContaining([
    'coal-power-plant', 'water-tower', 'fire-station',
  ]));
  expect(reloaded.map.landfillZones[tile(34, 24)]).toBe(true);
  expect(reloaded.map.zones[tile(10, 24)]).toBe('R');
  await attachJson(page, testInfo, 'simulation-preview-parity-manifest.json', [{
    cityId,
    tool: 'visible-play-pause-smoke',
    gesture: 'ui-built-road-power-water-zoning-landfill-fire-then-play-pause',
    monthBeforePlay: stateBeforePlay.clock.month,
    monthAfterPause: reloaded.clock.month,
    persistedHash,
    pass: true,
  }]);
});
