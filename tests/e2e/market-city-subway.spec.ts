import { expect, test, type Page, type TestInfo } from '@playwright/test';

import { MARKET_CITY_RULES_VERSION, type MarketCityStateV2 } from '../../src/market-city/types';

type Dashboard = {
  snapshot(): MarketCityStateV2;
  canonicalSnapshot(): string;
  whenDurable(): Promise<boolean>;
};

const tile = (x: number, y: number): number => y * 48 + x;

async function openCity(page: Page, cityId: string): Promise<void> {
  await page.goto(`/design-review/square-grid-mayor.html?profile=city&size=48&city=${cityId}&newCityName=Subway%20QA&newMayorName=Browser%20Mayor&seed=42`, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-synthcity-rules', MARKET_CITY_RULES_VERSION);
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
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
    const point = new DOMPoint(
      vertices.reduce((sum, vertex) => sum + vertex[0]!, 0) / vertices.length,
      vertices.reduce((sum, vertex) => sum + vertex[1]!, 0) / vertices.length,
    ).matrixTransform(surface.getScreenCTM()!);
    return { x: point.x, y: point.y };
  }, { x, y });
}

async function selectSubwayItem(page: Page, action: 'network:subway' | 'facility:subway-station'): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray').getByRole('button', { name: 'Passenger Rail', exact: true }).click();
  await expect(page.locator('#transit-catalog-title')).toHaveText('Passenger Rail & Subway');
  await page.locator(`#transit-catalog-grid [data-action="${action}"]`).click();
}

test('builds, renders, saves, and reloads a Subway entirely through Underground View', async ({ page }, testInfo) => {
  await openCity(page, `subway-browser-${Date.now()}`);

  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'Underground View', exact: true }).click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.city-client')).not.toHaveAttribute('data-active-map-action', /.+/);

  await selectSubwayItem(page, 'network:subway');
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.city-client')).toHaveAttribute('data-active-map-action', 'network:subway');

  const start = await projectedPoint(page, 10, 10);
  const end = await projectedPoint(page, 13, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:subway"]');
  await expect(preview).toHaveCount(4);
  expect(await preview.evaluateAll((elements) => elements.every((element) => element.getAttribute('data-valid') === 'true'))).toBe(true);
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.subways.some(Boolean)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('subway-preview.png') });

  await page.mouse.up();
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect([10, 11, 12, 13].every((x) => state.map.subways[tile(x, 10)])).toBe(true);
  await expect(page.locator('#underground-network-overlays .underground-subway')).not.toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('subway-route-released.png') });

  await selectSubwayItem(page, 'facility:subway-station');
  const station = await projectedPoint(page, 11, 10);
  await page.mouse.move(station.x, station.y);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="facility:subway-station"][data-valid="true"]')).toHaveCount(1);
  await page.mouse.click(station.x, station.y);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.facilities).toContainEqual(expect.objectContaining({ kind: 'subway-station', anchor: tile(11, 10) }));
  await expect(page.locator('.underground-subway-station-world')).not.toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('subway-station-underground.png') });

  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'city');
  await expect(page.locator('.tile.facility-subway-station')).toHaveCount(1);
  await page.screenshot({ path: testInfo.outputPath('subway-station-city-view.png') });

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'Underground View', exact: true }).click();
  await expect(page.locator('#underground-network-overlays .underground-subway')).not.toHaveCount(0);
});
