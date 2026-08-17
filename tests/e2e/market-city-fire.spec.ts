import { expect, test, type Page, type TestInfo } from '@playwright/test';
import type { MarketCityStateV2 } from '../../src/market-city/types';

type Dashboard = {
  hash(): string;
  snapshot(): MarketCityStateV2;
  dispatch(command: unknown): { accepted: boolean; reason?: string; changedTileIds: number[] };
  step(months?: number): MarketCityStateV2;
  setSpeed(speed: 0 | 1 | 2 | 3): void;
  setFireDifficulty(difficulty: 'easy' | 'normal' | 'hard'): void;
  save(): Promise<boolean>;
  whenDurable(): Promise<boolean>;
};

const captureEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';

test.setTimeout(120_000);

function cityUrl(cityId: string): string {
  return `/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=Fire%20Port%20QA&newMayorName=Browser%20Mayor&seed=17&performance-log=1`;
}

function cells(x1: number, y1: number, x2: number, y2: number): Array<{ x: number; y: number }> {
  const result: Array<{ x: number; y: number }> = [];
  for (let y = y1; y <= y2; y += 1) for (let x = x1; x <= x2; x += 1) result.push({ x, y });
  return result;
}

async function dispatch(page: Page, command: unknown): Promise<void> {
  const result = await page.evaluate((value) => (window.marketCityDashboard as Dashboard).dispatch(value), command);
  expect(result.accepted, result.reason).toBe(true);
}

async function projectedPoint(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x: cellX, y: cellY }) => {
    const picker = document.querySelector<SVGPolygonElement>(`.terrain-picker[data-x="${cellX}"][data-y="${cellY}"]`);
    const surface = document.querySelector<SVGSVGElement>('#terrain-surface');
    if (!picker || !surface) {
      const tile = document.querySelector<HTMLElement>(`.tile[data-x="${cellX}"][data-y="${cellY}"]`);
      if (!tile) throw new Error(`Tile ${cellX},${cellY} is not measurable.`);
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

async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!captureEvidence) return;
  await page.screenshot({ path: testInfo.outputPath(name) });
}

async function previewPathMetrics(page: Page): Promise<{
  pointCount: number;
  pointsOutsideSurfaceFrame: number;
  everyTintedCellIsOnMap: boolean;
}> {
  return page.locator('.fire-station-coverage-preview-clip-path').evaluate((element) => {
    const values = (element.getAttribute('d') ?? '').match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const points = Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({
      x: values[index * 2]!,
      y: values[index * 2 + 1]!,
    }));
    const surface = document.querySelector<SVGSVGElement>('#terrain-surface');
    if (!surface) throw new Error('Terrain surface is unavailable.');
    const { x, y, width, height } = surface.viewBox.baseVal;
    return {
      pointCount: points.length,
      pointsOutsideSurfaceFrame: points.filter((point) => (
        point.x < x || point.y < y || point.x > x + width || point.y > y + height
      )).length,
      everyTintedCellIsOnMap: [...document.querySelectorAll<SVGPolygonElement>('.fire-station-coverage-preview-cell')]
        .every((cell) => {
          const cellX = Number(cell.dataset.x);
          const cellY = Number(cell.dataset.y);
          return Number.isInteger(cellX) && Number.isInteger(cellY)
            && cellX >= 0 && cellX < 48 && cellY >= 0 && cellY < 48;
        }),
    };
  });
}

function monitorPageProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`request: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  return problems;
}

async function selectDataView(page: Page, name: string): Promise<void> {
  await page.getByRole('button', { name: 'Data views' }).click();
  await page.locator('#data-view-dialog').getByRole('button', { name, exact: true }).click();
}

async function smokeSignature(page: Page, incidentId: string): Promise<string> {
  return page.locator(`.market-building-smoke[data-incident-id="${incidentId}"] .market-building-smoke-puff`).first()
    .evaluate((element) => ['cx', 'cy', 'rx', 'ry'].map((attribute) => element.getAttribute(attribute)).join('|'));
}

test('renders the permanent fire gallery across every stage, footprint, sector, and rotation', async ({ page }, testInfo) => {
  const problems = monitorPageProblems(page);
  await page.goto('/design-review/market-fire-gallery.html', { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean((window as unknown as { marketFireGallery?: { ready: boolean } }).marketFireGallery?.ready))).toBe(true);
  await expect(page.locator('.fire-card')).toHaveCount(240);
  for (const stage of ['smoke-only', 'climbing', 'fully-involved', 'rubble']) {
    await expect(page.locator(`.fire-card[data-stage="${stage}"]`)).toHaveCount(60);
  }
  await expect(page.locator('.fire-card[data-stage="smoke-only"] .market-building-flame')).toHaveCount(0);
  await expect(page.locator('.fire-card[data-stage="smoke-only"] .market-building-smoke-puff')).not.toHaveCount(0);
  await expect(page.locator('.fire-card[data-stage="climbing"] [data-fire-stage="climbing"]')).toHaveCount(60);
  await expect(page.locator('.fire-card[data-stage="fully-involved"] [data-fire-stage="fully-involved"]')).toHaveCount(60);
  await expect(page.locator('.fire-card[data-stage="rubble"] .market-building-rubble')).toHaveCount(60);
  await capture(page, testInfo, 'fire-render-gallery.png');
  expect(problems).toEqual([]);
});

test('previews station reach and updates operational coverage while paused', async ({ page }, testInfo) => {
  const problems = monitorPageProblems(page);
  const cityId = `fire-station-${Date.now()}`;
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);

  await dispatch(page, { type: 'place-network', network: 'road', cells: [{ x: 24, y: 25 }] });
  // A station needs power as well as a road. Wind is a self-starting supply,
  // so this focused station proof does not need to construct water service.
  await dispatch(page, { type: 'place-facility', facility: 'wind-turbine', anchor: { x: 22, y: 26 } });
  await dispatch(page, { type: 'place-network', network: 'power-line', cells: [{ x: 23, y: 26 }, { x: 23, y: 25 }, { x: 23, y: 24 }] });
  await dispatch(page, { type: 'place-facility', facility: 'fire-station', anchor: { x: 24, y: 24 } });

  await selectDataView(page, 'Fire Coverage');
  await expect(page.locator('[data-city-view-option="fire-coverage"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.synthcity-data-fire-coverage')).toHaveCount(925);
  await expect(page.locator('.synthcity-data-fire-coverage[data-station-status]')).toHaveCount(0);
  await expect(page.locator('#ticker-copy')).toContainText('1 operational fire station');
  await capture(page, testInfo, 'fire-coverage-operational.png');
  const weakOverlapTile = 44 * 48 + 25;
  const openingWeakOpacity = Number(await page.locator(`.synthcity-data-fire-coverage[data-tile="${weakOverlapTile}"]`).getAttribute('fill-opacity'));

  await dispatch(page, { type: 'place-facility', facility: 'fire-station', anchor: { x: 25, y: 24 } });
  await expect.poll(async () => page.locator('.synthcity-data-fire-coverage').count()).toBeGreaterThan(925);
  await expect.poll(() => page.locator('.synthcity-data-fire-coverage').evaluateAll((elements) => Math.max(
    ...elements.map((element) => Number((element as SVGElement).dataset.coverage ?? 0)),
  ))).toBeGreaterThan(0.3);
  await expect.poll(async () => Number(
    await page.locator(`.synthcity-data-fire-coverage[data-tile="${weakOverlapTile}"]`).getAttribute('fill-opacity'),
  )).toBeGreaterThan(openingWeakOpacity);
  await expect(page.locator('#ticker-copy')).toContainText('2 operational fire stations');
  await capture(page, testInfo, 'fire-coverage-overlap.png');

  await dispatch(page, { type: 'demolish', layer: 'surface', cells: [{ x: 24, y: 25 }] });
  await expect(page.locator('.synthcity-data-fire-coverage[data-station-status="No road service"]')).not.toHaveCount(0);
  await expect(page.locator('.synthcity-data-fire-coverage:not([data-station-status])')).toHaveCount(0);
  await expect(page.locator('#ticker-copy')).toContainText('no operational fire stations');
  await capture(page, testInfo, 'fire-station-offline-no-road.png');
  await dispatch(page, { type: 'place-network', network: 'road', cells: [{ x: 24, y: 25 }] });
  await expect.poll(async () => page.locator('.synthcity-data-fire-coverage:not([data-station-status])').count()).toBeGreaterThan(925);

  await selectDataView(page, 'City View');
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Fire', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
  const point = await projectedPoint(page, 24, 23);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.fire-station-coverage-preview-cell')).toHaveCount(925);
  await expect(page.locator('.fire-station-coverage-preview-boundary')).toHaveCount(0);
  await expect(page.locator('.fire-station-coverage-preview')).toHaveAttribute('data-edge', 'fixed-radius-drop-off-map-tint');
  await expect(page.locator('.fire-station-coverage-preview-clip-path')).toHaveCount(1);
  await capture(page, testInfo, 'fire-station-radius-preview.png');
  const openingBoundary = await page.locator('.fire-station-coverage-preview-clip-path').getAttribute('d');
  for (let rotation = 1; rotation <= 4; rotation += 1) {
    await page.getByRole('button', { name: 'Rotate view right' }).click();
    await expect(page.locator('.fire-station-coverage-preview-cell')).toHaveCount(925);
    await expect(page.locator('.fire-station-coverage-preview-boundary')).toHaveCount(0);
    const boundary = await page.locator('.fire-station-coverage-preview-clip-path').getAttribute('d');
    if (rotation === 1) expect(boundary).not.toBe(openingBoundary);
  }
  const stationPreviewPerformance = await page.evaluate(() => {
    const snapshot = (window as unknown as {
      squareGridMayor: { interactionPerformanceSnapshot(): { previews: Array<{ action: string; durationMs: number; coverageCellCount?: number }> } };
    }).squareGridMayor.interactionPerformanceSnapshot();
    return snapshot.previews.filter((entry) => entry.action === 'facility:fire-station');
  });
  expect(stationPreviewPerformance.length).toBeGreaterThan(0);
  expect(Math.max(...stationPreviewPerformance.map((entry) => entry.durationMs))).toBeLessThan(100);
  expect(stationPreviewPerformance.some((entry) => entry.coverageCellCount === 925)).toBe(true);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.fire-station-placement-pulse-ring')).toHaveCount(8);
  await expect(page.locator('.fire-station-placement-pulse')).toHaveAttribute('data-wave-radii', '0,3,6,9,12,15,18,21');
  await expect(page.locator('.fire-station-placement-pulse-ring[data-segments="4"]')).toHaveCount(8);
  await expect(page.locator('#fire-station-placement-screen-feedback .fire-station-placement-flare')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await expect(page.locator('.fire-station-placement-pulse-ring')).toHaveCount(8);
  await page.waitForTimeout(850);
  await capture(page, testInfo, 'fire-station-placement-pulse.png');
  expect(problems).toEqual([]);
});

test('shows a Fire Station radius from a neutral map click and clears it on the next map click', async ({ page }) => {
  const cityId = `fire-station-click-radius-${Date.now()}`;
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);

  await dispatch(page, { type: 'place-facility', facility: 'fire-station', anchor: { x: 24, y: 24 } });
  const stationPoint = await projectedPoint(page, 24, 24);
  const emptyPoint = await projectedPoint(page, 4, 4);

  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveCount(0);
  await page.mouse.click(stationPoint.x, stationPoint.y);
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveCount(1);
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveAttribute('data-radius', '21');
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveAttribute('data-cell-count', '925');
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveAttribute('data-edge', 'fixed-radius-drop-off-map-outline');
  await expect(page.locator('.fire-station-selected-radius-outline-path')).toHaveCount(1);
  await expect(page.locator('.fire-station-selected-radius-outline-path')).toHaveAttribute('data-segments', '4');

  await page.mouse.click(stationPoint.x, stationPoint.y);
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveCount(0);

  await page.mouse.click(stationPoint.x, stationPoint.y);
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveCount(1);
  await page.mouse.click(emptyPoint.x, emptyPoint.y);
  await expect(page.locator('.fire-station-selected-radius-outline')).toHaveCount(0);
});

test('keeps a fresh red flare static at low opacity under reduced motion', async ({ page }, testInfo) => {
  const problems = monitorPageProblems(page);
  const cityId = `fire-station-reduced-motion-${Date.now()}`;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);

  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Fire', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
  const point = await projectedPoint(page, 24, 23);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.fire-station-coverage-preview-cell')).toHaveCount(925);
  await page.mouse.click(point.x, point.y);

  await expect(page.locator('.fire-station-placement-flare')).toHaveCount(1);
  const staticFlare = await page.locator('.fire-station-placement-flare').evaluate((element) => ({
    animationName: getComputedStyle(element).animationName,
    opacity: Number(getComputedStyle(element).opacity),
  }));
  expect(staticFlare.animationName).toBe('none');
  expect(staticFlare.opacity).toBeGreaterThan(0);
  expect(staticFlare.opacity).toBeLessThan(1);
  await page.waitForTimeout(160);
  await expect(page.locator('.fire-station-placement-flare')).toHaveCount(1);
  await capture(page, testInfo, 'fire-station-reduced-motion-static-flare.png');
  expect(problems).toEqual([]);
});

test('keeps an edge station radius fixed beyond the map while dropping only off-map tint', async ({ page }, testInfo) => {
  const problems = monitorPageProblems(page);
  const cityId = `fire-station-edge-${Date.now()}`;
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);

  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Fire', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
  const edgePoint = await projectedPoint(page, 2, 2);
  await page.mouse.move(edgePoint.x, edgePoint.y);

  await expect(page.locator('.fire-station-coverage-preview-cell')).toHaveCount(339);
  await expect(page.locator('.fire-station-coverage-preview')).toHaveAttribute('data-edge', 'fixed-radius-drop-off-map-tint');
  await expect(page.locator('.fire-station-coverage-preview-boundary')).toHaveCount(0);
  const hoverMetrics = await previewPathMetrics(page);
  expect(hoverMetrics.pointCount).toBe(4);
  expect(hoverMetrics.pointsOutsideSurfaceFrame).toBeGreaterThan(0);
  expect(hoverMetrics.everyTintedCellIsOnMap).toBe(true);
  await capture(page, testInfo, 'fire-station-edge-hover.png');

  await page.mouse.click(edgePoint.x, edgePoint.y);
  await expect(page.locator('.fire-station-placement-pulse')).toHaveAttribute('data-map-clip', 'in-map');
  await expect(page.locator('.fire-station-placement-pulse-ring')).toHaveCount(8);
  await expect(page.locator('.fire-station-placement-flare')).toHaveCount(1);
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await expect(page.locator('.fire-station-placement-pulse')).toHaveAttribute('data-map-clip', 'in-map');
  await expect(page.locator('.fire-station-placement-pulse-ring')).toHaveCount(8);
  await capture(page, testInfo, 'fire-station-edge-rotation.png');
  expect(problems).toEqual([]);
});

test('rejects an occupied fire-station placement without pulse or flare feedback', async ({ page }) => {
  const problems = monitorPageProblems(page);
  const cityId = `fire-station-invalid-${Date.now()}`;
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  await dispatch(page, { type: 'place-facility', facility: 'fire-station', anchor: { x: 12, y: 12 } });

  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Fire', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
  const point = await projectedPoint(page, 12, 12);
  await page.mouse.move(point.x, point.y);
  await expect(page.locator('.city-action-preview.invalid')).toHaveCount(1);
  await expect(page.locator('.fire-station-coverage-preview')).toHaveCount(0);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator('.fire-station-placement-pulse')).toHaveCount(0);
  await expect(page.locator('.fire-station-placement-flare')).toHaveCount(0);
  expect(problems).toEqual([]);
});

test('burns a pinned building, blocks mutations, persists rubble, and replays history without mutation', async ({ page }, testInfo) => {
  const problems = monitorPageProblems(page);
  const cityId = `building-fire-${Date.now()}`;
  await page.goto(cityUrl(cityId), { waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  await dispatch(page, { type: 'place-facility', facility: 'coal-power-plant', anchor: { x: 10, y: 16 } });
  await dispatch(page, { type: 'place-network', network: 'road', cells: cells(6, 20, 40, 20) });
  await dispatch(page, { type: 'place-network', network: 'power-line', cells: [{ x: 8, y: 16 }, { x: 9, y: 16 }] });
  await dispatch(page, { type: 'place-facility', facility: 'wind-turbine', anchor: { x: 8, y: 15 } });
  await dispatch(page, { type: 'place-facility', facility: 'water-tower', anchor: { x: 6, y: 16 } });
  await dispatch(page, {
    type: 'place-network',
    network: 'water-pipe',
    cells: [...cells(6, 20, 40, 20), ...cells(7, 17, 7, 20)],
  });
  await dispatch(page, { type: 'zone', kind: 'residential', level: 1, cells: cells(12, 17, 24, 19) });
  await dispatch(page, { type: 'zone', kind: 'commercial', level: 1, cells: cells(25, 17, 37, 19) });
  await dispatch(page, { type: 'zone', kind: 'industrial', level: 1, cells: cells(12, 21, 37, 24) });

  const burning = await page.evaluate(() => {
    const dashboard = window.marketCityDashboard as Dashboard;
    dashboard.setFireDifficulty('hard');
    for (let months = 0; months < 240; months += 1) {
      const state = dashboard.step(1);
      const incident = state.fire.incidents.find((candidate) => candidate.status === 'burning');
      if (incident) return { state, incident };
    }
    throw new Error('No deterministic fire ignited within 240 months.');
  });
  expect(burning.incident.tileIds.length).toBeGreaterThanOrEqual(1);
  await expect(page.locator(`[data-incident-id="${burning.incident.id}"]`)).not.toHaveCount(0);
  const burningTile = burning.incident.tileIds[0]!;
  const burningX = burningTile % 48;
  const burningY = Math.floor(burningTile / 48);
  await page.getByRole('button', { name: 'Bulldoze tools' }).click();
  const burningPoint = await projectedPoint(page, burningX, burningY);
  await page.mouse.click(burningPoint.x, burningPoint.y);
  await expect(page.locator('#ticker-copy')).toContainText(/locked/i);
  expect((await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot())).fire.incidents.some((candidate) => candidate.id === burning.incident.id)).toBe(true);
  await expect(page.locator(`.market-building-smoke[data-incident-id="${burning.incident.id}"]`)).toHaveCount(1);
  await expect(page.locator(`[data-incident-id="${burning.incident.id}"] [data-fire-stage]`)).toHaveCount(0);
  await capture(page, testInfo, 'building-fire-smoke-only.png');

  const pausedVisual = await smokeSignature(page, burning.incident.id);
  await page.waitForTimeout(250);
  expect(await smokeSignature(page, burning.incident.id)).toBe(pausedVisual);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(1));
  await expect.poll(() => smokeSignature(page, burning.incident.id)).not.toBe(pausedVisual);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const reducedVisual = await smokeSignature(page, burning.incident.id);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(1));
  await page.waitForTimeout(250);
  expect(await smokeSignature(page, burning.incident.id)).toBe(reducedVisual);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(0));
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  const fireHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => (window.marketCityDashboard as Dashboard)?.hash())).toBe(fireHash);

  await page.evaluate((incidentId) => {
    const dashboard = window.marketCityDashboard as Dashboard;
    for (let months = 0; months < 40; months += 1) {
      const incident = dashboard.step(1).fire.incidents.find((candidate) => candidate.id === incidentId);
      if (incident && incident.intensity >= 0.3) return;
    }
    throw new Error('The pinned fire did not reach the climbing stage.');
  }, burning.incident.id);
  await expect(page.locator(`[data-incident-id="${burning.incident.id}"] [data-fire-stage="climbing"]`)).not.toHaveCount(0);
  await capture(page, testInfo, 'building-fire-climbing.png');

  await page.evaluate((incidentId) => {
    const dashboard = window.marketCityDashboard as Dashboard;
    for (let months = 0; months < 40; months += 1) {
      const incident = dashboard.step(1).fire.incidents.find((candidate) => candidate.id === incidentId);
      if (incident && incident.intensity >= 0.7) return;
    }
    throw new Error('The pinned fire did not become fully involved.');
  }, burning.incident.id);
  await expect(page.locator(`[data-incident-id="${burning.incident.id}"] [data-fire-stage="fully-involved"]`)).not.toHaveCount(0);
  await capture(page, testInfo, 'building-fire-fully-involved.png');
  for (let rotation = 1; rotation <= 4; rotation += 1) {
    await page.getByRole('button', { name: 'Rotate view right' }).click();
    await expect(page.locator(`.market-building-smoke[data-incident-id="${burning.incident.id}"]`)).toHaveCount(1);
    await capture(page, testInfo, `building-fire-rotation-${rotation}.png`);
  }

  const collapsed = await page.evaluate((incidentId) => {
    const dashboard = window.marketCityDashboard as Dashboard;
    for (let months = 0; months < 80; months += 1) {
      const state = dashboard.step(1);
      const incident = state.fire.incidents.find((candidate) => candidate.id === incidentId);
      if (incident?.status === 'rubble') return { month: state.clock.month, incident };
    }
    throw new Error('The pinned fire did not collapse within 80 months.');
  }, burning.incident.id);
  expect(collapsed.incident.rubbleMonthsRemaining).toBe(50);
  await expect(page.locator(`.market-building-rubble[data-incident-id="${burning.incident.id}"]`)).toHaveCount(1);
  await expect(page.locator(`.market-building-smoke[data-incident-id="${burning.incident.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-incident-id="${burning.incident.id}"] .market-building-fire`)).toHaveCount(0);
  await capture(page, testInfo, 'building-fire-rubble.png');
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));

  const beforeHistoryHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  await selectDataView(page, 'Fire History');
  await expect(page.locator('[data-city-view-option="fire-history"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#fire-history-player')).toBeVisible();
  await expect(page.locator('.market-building-world').first()).toBeHidden();
  await expect(page.locator(`.market-building-rubble[data-incident-id="${burning.incident.id}"]`)).toBeHidden();
  await page.locator('#fire-history-scrubber').fill(String(burning.incident.startedMonth));
  await expect(page.locator(`.synthcity-data-fire-history[data-incident="${burning.incident.id}"][data-history-event="ignition"]`)).not.toHaveCount(0);
  await capture(page, testInfo, 'fire-history-ignition.png');
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash())).toBe(beforeHistoryHash);
  await page.locator('#fire-history-scrubber').fill(String(collapsed.month));
  await expect(page.locator(`.synthcity-data-fire-history[data-incident="${burning.incident.id}"][data-history-event="collapse"]`)).not.toHaveCount(0);
  await page.locator('#fire-history-scrubber').fill(String(collapsed.month + 1));
  await expect(page.locator(`.synthcity-data-fire-history[data-incident="${burning.incident.id}"][data-history-event="rubble"]`)).not.toHaveCount(0);
  await page.locator('#fire-history-scrubber').fill(String(burning.incident.startedMonth));
  await page.locator('#fire-history-play').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#fire-history-play')).toHaveText('Pause');
  await expect.poll(() => page.locator('#fire-history-scrubber').inputValue()).not.toBe(String(burning.incident.startedMonth));
  await page.keyboard.press('Enter');
  await expect(page.locator('#fire-history-play')).toHaveText('Play');

  const selectedHistoryMonth = await page.locator('#fire-history-scrubber').inputValue();
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(3));
  await expect.poll(() => page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot().clock.month), { timeout: 5_000 }).toBeGreaterThan(collapsed.month);
  expect(await page.locator('#fire-history-scrubber').inputValue()).toBe(selectedHistoryMonth);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setSpeed(0));

  const liveRubble = await page.evaluate((incidentId) => {
    const state = (window.marketCityDashboard as Dashboard).snapshot();
    return {
      month: state.clock.month,
      remaining: state.fire.incidents.find((candidate) => candidate.id === incidentId)?.rubbleMonthsRemaining ?? 0,
    };
  }, burning.incident.id);
  expect(liveRubble.remaining).toBeGreaterThan(1);
  await page.locator('#fire-history-latest').click();
  await expect(page.locator('#fire-history-live-month')).toContainText(`Live month ${liveRubble.month}`);

  await page.evaluate((months) => (window.marketCityDashboard as Dashboard).step(months), liveRubble.remaining - 1);
  await expect(page.locator(`.market-building-rubble[data-incident-id="${burning.incident.id}"]`)).toHaveCount(1);
  await expect(page.locator(`.market-building-smoke[data-incident-id="${burning.incident.id}"]`)).toHaveCount(0);
  await capture(page, testInfo, 'rubble-month-49.png');
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  const cleared = await page.evaluate((incidentId) => {
    const state = (window.marketCityDashboard as Dashboard).snapshot();
    return {
      incident: state.fire.incidents.find((candidate) => candidate.id === incidentId),
      event: [...state.fire.history].reverse().find((candidate) => candidate.incidentId === incidentId)?.event,
    };
  }, burning.incident.id);
  expect(cleared.incident).toBeUndefined();
  expect(cleared.event).toBe('rubble-cleared');
  await capture(page, testInfo, 'rubble-cleared-month-50.png');
  expect(problems).toEqual([]);
});
