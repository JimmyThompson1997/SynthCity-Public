import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { MARKET_ITEM_MANIFEST } from '../../src/market-city/item-manifest';
import { derivePower } from '../../src/market-city/spatial';
import { createMarketCityState } from '../../src/market-city/state';
import { deriveWaterService } from '../../src/market-city/water';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT,
  type MarketCityStateV2,
} from '../../src/market-city/types';

type Dashboard = {
  hash(): string;
  snapshot(): MarketCityStateV2;
  canonicalSnapshot(): string;
  preview(command: unknown): { tileOutcomes: Array<{ tileId: number; disposition: string }> };
  dispatch(command: unknown): { accepted: boolean; reason?: string; changedTileIds: number[] };
  step(months?: number): MarketCityStateV2;
  setSpeed(speed: 0 | 1 | 2 | 3): void;
  setFireDifficulty(difficulty: 'easy' | 'normal' | 'hard'): void;
  setVerticalDevelopmentLevel(level: number): void;
  save(): Promise<boolean>;
  reload(): Promise<boolean>;
  whenDurable(): Promise<boolean>;
};

interface RailShuttleAnimationEntry {
  legId: string;
  componentId: string;
  stationAId: string;
  stationBId: string;
  pathTileIds: number[];
  pathIndex: number;
  progress: number;
  direction: 'forward' | 'reverse';
  paused: boolean;
  ridership: number;
}

interface RailShuttleAnimationSnapshot {
  animationState: 'running' | 'paused';
  shuttles: RailShuttleAnimationEntry[];
}

type MayorBridge = {
  viewSnapshot(): { rotation: number; panX: number; panY: number; zoom: number; dataView: string };
  restoreViewState(view: { rotation: number; panX: number; panY: number; zoom: number; dataView: string }): void;
  fitViewToTileBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }, padding?: number): void;
  railShuttleAnimationSnapshot(): RailShuttleAnimationSnapshot;
};

const expectedCommit = process.env.SYNTHCITY_EXPECTED_COMMIT;
const requireHosted = process.env.SYNTHCITY_REQUIRE_PRODUCTION === '1';
const captureEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';
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

function cityUrl(cityId: string): string {
  return `/design-review/square-grid-mayor.html?profile=city&size=60&terrain=flat&city=${cityId}&newCityName=SynthCity%20Cutover%20QA&newMayorName=Browser%20Mayor&seed=1`;
}

async function openCity(page: Page, cityId: string, additionalQuery = ''): Promise<void> {
  await page.goto(`${cityUrl(cityId)}${additionalQuery}`, { waitUntil: 'networkidle' });
  await expect(page.locator('html')).toHaveAttribute('data-synthcity-schema', '2');
  await expect(page.locator('html')).toHaveAttribute('data-synthcity-rules', MARKET_CITY_RULES_VERSION);
  await expect(page.locator('html')).toHaveAttribute('data-market-tax-rate', '0.025');
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'market-city-v2');
  await expect(page.locator('.city-grid')).toHaveCSS('--map-cells', '48');
  await expect(page.locator('.tile')).toHaveCount(2_304);
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  if (expectedCommit) await expect(page.locator('html')).toHaveAttribute('data-synthcity-commit', expectedCommit);
  if (requireHosted) await expect(page.locator('html')).toHaveAttribute('data-synthcity-environment', /preview|production/);
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

async function projectedEdgePoint(
  page: Page,
  x: number,
  y: number,
  edge: 'north' | 'east' | 'south' | 'west',
): Promise<{ x: number; y: number }> {
  return page.evaluate(({ x: cellX, y: cellY, edge: requestedEdge }) => {
    const picker = document.querySelector<SVGPolygonElement>(`.terrain-picker[data-x="${cellX}"][data-y="${cellY}"]`);
    const surface = document.querySelector<SVGSVGElement>('#terrain-surface');
    if (!picker || !surface) {
      const tile = document.querySelector<HTMLElement>(`.tile[data-x="${cellX}"][data-y="${cellY}"]`);
      if (!tile) throw new Error(`Tile ${cellX},${cellY} has no projected terrain edge.`);
      const bounds = tile.getBoundingClientRect();
      const inset = .18;
      if (requestedEdge === 'north') return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height * inset };
      if (requestedEdge === 'east') return { x: bounds.left + bounds.width * (1 - inset), y: bounds.top + bounds.height / 2 };
      if (requestedEdge === 'south') return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height * (1 - inset) };
      return { x: bounds.left + bounds.width * inset, y: bounds.top + bounds.height / 2 };
    }
    const vertices = (picker.getAttribute('points') ?? '').trim().split(/\s+/).map((token) => token.split(',').map(Number));
    const edgeIndex = { north: 0, east: 1, south: 2, west: 3 }[requestedEdge];
    const first = vertices[edgeIndex]!;
    const second = vertices[(edgeIndex + 1) % 4]!;
    const local = new DOMPoint((first[0]! + second[0]!) / 2, (first[1]! + second[1]!) / 2);
    const screen = local.matrixTransform(surface.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  }, { x, y, edge });
}

async function clickMapCell(page: Page, x: number, y: number): Promise<void> {
  const point = await projectedPoint(page, x, y);
  await page.mouse.click(point.x, point.y);
}

async function moveToMapCell(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  const point = await projectedPoint(page, x, y);
  await page.mouse.move(point.x, point.y);
  return point;
}

async function previewAndClickMapCell(
  page: Page,
  x: number,
  y: number,
  action: string,
  expectedFootprint: number,
): Promise<void> {
  const point = await moveToMapCell(page, x, y);
  const selector = `#city-action-preview-overlays .city-action-preview[data-action="${action}"]`;
  const preview = page.locator(selector);
  await expect(preview).toHaveCount(expectedFootprint);
  await expect(page.locator(`${selector}[data-valid="true"]`)).toHaveCount(expectedFootprint);
  if (action === 'facility:solar-plant') {
    expect(await preview.evaluateAll((elements) => elements.every((element) => (
      getComputedStyle(element).fill.includes('49, 209, 154')
        && getComputedStyle(element).stroke.includes('180, 255, 222')
    )))).toBe(true);
  }
  await page.mouse.click(point.x, point.y);
}

async function selectRoad(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray').getByRole('button', { name: 'Roads', exact: true }).click();
  await page.locator('#transit-catalog-grid [data-action="road"]').click();
}

async function openAvenueCard(page: Page): Promise<ReturnType<Page['locator']>> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  await page.locator('.transit-tray').getByRole('button', { name: 'Roads', exact: true }).click();
  const card = page.locator('#transit-catalog-grid [data-action="network:avenue"]');
  await expect(card).toBeVisible();
  return card;
}

async function selectAvenue(
  page: Page,
  _legacyExpansionSide?: 'left' | 'right',
): Promise<void> {
  const card = await openAvenueCard(page);
  await card.click();
}

async function openPassengerRailCatalog(page: Page): Promise<void> {
  await page.locator('.rail-tool[data-panel="transit"]').click();
  const category = page.locator('button[data-transit-category="rail"]');
  await expect(category).toHaveAccessibleName('Passenger Rail');
  await category.click();
  await expect(page.locator('#transit-catalog-dialog')).toBeVisible();
}

async function openRailCard(page: Page): Promise<ReturnType<Page['locator']>> {
  await openPassengerRailCatalog(page);
  const card = page.locator('button[data-catalog-kind="rail"][data-action="network:rail"]');
  await expect(card).toBeVisible();
  return card;
}

async function selectRail(page: Page): Promise<void> {
  const card = await openRailCard(page);
  await card.click();
}

async function selectSubway(page: Page): Promise<void> {
  await openPassengerRailCatalog(page);
  const card = page.locator('button[data-catalog-kind="subway"][data-action="network:subway"]');
  await expect(card).toBeVisible();
  await card.click();
}

async function openTrainStationCard(page: Page): Promise<ReturnType<Page['locator']>> {
  await openPassengerRailCatalog(page);
  const card = page.locator('button[data-catalog-kind="train-station"][data-action="facility:train-station"]');
  await expect(card).toBeVisible();
  return card;
}

async function selectTrainStation(page: Page): Promise<void> {
  const card = await openTrainStationCard(page);
  await card.click();
}

async function selectSubwayStation(page: Page): Promise<void> {
  await openPassengerRailCatalog(page);
  const card = page.locator('button[data-catalog-kind="subway-station"][data-action="facility:subway-station"]');
  await expect(card).toBeVisible();
  await card.click();
}

async function selectBulldoze(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Bulldoze tools', exact: true }).click();
}

async function dragMapRoute(
  page: Page,
  from: Readonly<{ x: number; y: number }>,
  to: Readonly<{ x: number; y: number }>,
  preview: Readonly<{ action: string; footprint?: number; valid?: boolean }> = { action: 'network:avenue' },
): Promise<void> {
  const start = await projectedPoint(page, from.x, from.y);
  const end = await projectedPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const overlays = page.locator(`#city-action-preview-overlays .city-action-preview[data-action="${preview.action}"]`);
  if (preview.footprint !== undefined) await expect(overlays).toHaveCount(preview.footprint);
  if (preview.valid !== undefined) {
    await expect(overlays).not.toHaveCount(0);
    expect(await overlays.evaluateAll((elements, valid) => (
      elements.every((element) => element.getAttribute('data-valid') === valid)
    ), String(preview.valid))).toBe(true);
  }
  await page.mouse.up();
}

async function railGeometryFingerprint(page: Page, scope: string): Promise<string[]> {
  return page.locator(`${scope} [data-network-kind="rail"][data-world-recipe-id="network:rail:v5"]`).evaluateAll((roots) => roots
    .map((root) => {
      const partGeometry = [...root.querySelectorAll<SVGElement>('.terrain-rail-ballast, .terrain-rail-track, .terrain-rail-track-highlight, .terrain-rail-sleeper')]
        .map((part) => [
          part.getAttribute('class'),
          part.getAttribute('x1'), part.getAttribute('y1'), part.getAttribute('x2'), part.getAttribute('y2'),
          part.getAttribute('d'), part.getAttribute('stroke'), part.getAttribute('stroke-width'), part.getAttribute('stroke-linecap'),
          part.getAttribute('data-tie-phase'), part.getAttribute('data-tie-cadence'), part.getAttribute('data-seam-contract'),
        ].join('|'))
        .sort()
        .join('~');
      return `${root.getAttribute('data-tile')}#${root.getAttribute('data-connection-mask')}#${root.getAttribute('data-network-topology')}#${partGeometry}`;
    })
    .sort());
}

async function focusRailEvidence(page: Page): Promise<void> {
  await page.evaluate(() => {
    (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor
      .fitViewToTileBounds({ minX: 8, minY: 8, maxX: 17, maxY: 12 }, 1);
  });
}

function avenueTileIds(state: MarketCityStateV2): number[] {
  return state.map.avenueLanes.flatMap((lane, tile) => lane ? [tile] : []);
}

function railTileIds(state: MarketCityStateV2): number[] {
  return state.map.rails.flatMap((rail, tile) => rail ? [tile] : []);
}

function oppositeMask(mask: number): number {
  return ((mask & 1) ? 4 : 0)
    | ((mask & 2) ? 8 : 0)
    | ((mask & 4) ? 1 : 0)
    | ((mask & 8) ? 2 : 0);
}

function neighborForMaskBit(tile: number, bit: 1 | 2 | 4 | 8): number {
  if (bit === 1) return tile - 48;
  if (bit === 2) return tile + 1;
  if (bit === 4) return tile + 48;
  return tile - 1;
}

function assertReciprocalAvenueMasks(state: MarketCityStateV2): void {
  const laneTiles = avenueTileIds(state);
  expect(laneTiles.length).toBeGreaterThan(0);
  let pairedCrossSections = 0;
  for (const tile of laneTiles) {
    const pairMask = state.map.avenuePairMasks[tile] ?? 0;
    for (const bit of [1, 2, 4, 8] as const) {
      if ((pairMask & bit) === 0) continue;
      pairedCrossSections += 1;
      const neighbor = neighborForMaskBit(tile, bit);
      expect(state.map.avenueLanes[neighbor], `pair ${tile}->${neighbor} must land on an avenue lane`).toBe(true);
      expect(
        (state.map.avenuePairMasks[neighbor] ?? 0) & oppositeMask(bit),
        `pair ${tile}<->${neighbor} must be reciprocal`,
      ).not.toBe(0);
    }
  }
  // Outer-corner filler tiles can legitimately lack an orthogonal mate. Every
  // actual cross-section is reciprocal, and at least one must exist.
  expect(pairedCrossSections).toBeGreaterThan(0);
}

function assertStraightAvenueDirectionOpposition(
  state: MarketCityStateV2,
  laneTiles: readonly number[],
): void {
  const tileSet = new Set(laneTiles);
  const directionPairs: Array<{ lane: number; pair: number; laneTravel: number; pairTravel: number }> = [];
  for (const lane of laneTiles) {
    const laneTravel = state.map.avenueTravelMasks[lane] ?? 0;
    for (const bit of [1, 2, 4, 8] as const) {
      if ((laneTravel & bit) === 0) continue;
      expect(
        tileSet.has(neighborForMaskBit(lane, bit)),
        `travel edge ${lane}:${bit} must target another avenue tile`,
      ).toBe(true);
    }
    const pairMask = state.map.avenuePairMasks[lane] ?? 0;
    for (const bit of [1, 2, 4, 8] as const) {
      if ((pairMask & bit) === 0) continue;
      const pair = neighborForMaskBit(lane, bit);
      if (tileSet.has(pair) && lane < pair) directionPairs.push({
        lane,
        pair,
        laneTravel,
        pairTravel: state.map.avenueTravelMasks[pair] ?? 0,
      });
    }
  }
  expect(directionPairs.length).toBeGreaterThan(0);
  // Directed terminal masks can be zero on one side. At least one interior
  // cross-section must prove the opposing aggregate carriageway directions.
  expect(directionPairs.some(({ laneTravel, pairTravel }) => (
    laneTravel !== 0 && pairTravel !== 0 && (pairTravel & oppositeMask(laneTravel)) !== 0
  ))).toBe(true);
}

function assertReciprocalRailMasks(state: MarketCityStateV2): void {
  const rails = new Set(railTileIds(state));
  for (const tile of rails) {
    const mask = state.map.railConnectionMasks[tile] ?? 0;
    for (const bit of [1, 2, 4, 8] as const) {
      if ((mask & bit) === 0) continue;
      const neighbor = neighborForMaskBit(tile, bit);
      expect(rails.has(neighbor), `rail edge ${tile}->${neighbor} must land on rail`).toBe(true);
      expect(
        (state.map.railConnectionMasks[neighbor] ?? 0) & oppositeMask(bit),
        `rail edge ${tile}<->${neighbor} must be reciprocal`,
      ).not.toBe(0);
    }
  }
}

async function railAnimationSnapshot(page: Page): Promise<RailShuttleAnimationSnapshot> {
  return page.evaluate(() => (
    (window as unknown as { squareGridMayor: MayorBridge }).squareGridMayor.railShuttleAnimationSnapshot()
  ));
}

function stationPair(stationAId: string, stationBId: string): string {
  return [stationAId, stationBId].sort().join('|');
}

function expectRailPath(state: MarketCityStateV2, pathTileIds: readonly number[]): void {
  expect(pathTileIds.length).toBeGreaterThanOrEqual(2);
  for (const tile of pathTileIds) expect(state.map.rails[tile]).toBe(true);
  for (let index = 1; index < pathTileIds.length; index += 1) {
    const previous = pathTileIds[index - 1]!;
    const current = pathTileIds[index]!;
    expect(Math.abs((previous % 48) - (current % 48)) + Math.abs(Math.floor(previous / 48) - Math.floor(current / 48)))
      .toBe(1);
  }
}

async function pauseSimulationVisibly(page: Page): Promise<void> {
  const speed = page.locator('#simulation-speed');
  for (let attempt = 0; attempt < 4 && await speed.getAttribute('data-speed') !== '0'; attempt += 1) {
    await speed.click();
  }
  await expect(speed).toHaveAttribute('data-speed', '0');
  await expect(page.locator('#rail-shuttle-overlays')).toHaveAttribute('data-animation-state', 'paused');
}

async function selectPowerItem(page: Page, action: string): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray').getByRole('button', { name: 'Power', exact: true }).click();
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function selectWaterItem(page: Page, action: string): Promise<void> {
  await page.getByRole('button', { name: 'Utilities', exact: true }).click();
  await page.locator('.utilities-tray').getByRole('button', { name: 'Water', exact: true }).click();
  await page.locator(`#utility-catalog-grid [data-action="${action}"]`).click();
}

async function paintSurfaceWater(page: Page, x: number, y: number): Promise<void> {
  await page.getByRole('button', { name: 'Landscape', exact: true }).click();
  await page.locator('[data-terrain-brush="water"]').click();
  await clickMapCell(page, x, y);
  await expect.poll(() => page.evaluate(({ x: tileX, y: tileY }) => (
    (window.marketCityDashboard as Dashboard).snapshot().map.terrain.water[tileY * 48 + tileX]
  ), { x, y })).toBe(true);
}

async function selectFireStation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Fire', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:fire-station"]').click();
}

async function selectPoliceStation(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Police', exact: true }).click();
  await page.locator('#public-service-catalog-grid [data-action="facility:police-station"]').click();
}

async function selectLandfillZone(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Waste', exact: true }).click();
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

async function appearanceSignature(page: Page): Promise<string[]> {
  return page.locator('[data-render-contract="market-rci-svg-v1"][data-world-part-kind="lot"]').evaluateAll((lots) => lots.map((lot) => [
    lot.getAttribute('data-market-lot-id'),
    lot.getAttribute('data-tile-ids'),
    lot.getAttribute('data-zone'),
    lot.getAttribute('data-height'),
    lot.getAttribute('data-footprint'),
    lot.getAttribute('data-roof-kind'),
    lot.getAttribute('data-landmark'),
  ].join('|')).sort());
}

/** The live renderer's durable visual contract: every independently sorted RCI part. */
async function rciPrimitiveSignature(page: Page): Promise<string[]> {
  return page.locator('#terrain-construction-overlays > [data-render-contract="market-rci-svg-v1"][data-world-part-kind]')
    .evaluateAll((parts) => parts.map((part) => [
      part.getAttribute('data-render-item-id'),
      part.getAttribute('data-world-part-kind'),
      part.getAttribute('data-render-anchor-x'),
      part.getAttribute('data-render-anchor-y'),
      part.getAttribute('data-render-elevation'),
      part.getAttribute('data-render-depth'),
      part.getAttribute('data-occlusion-rank'),
    ].join('|')));
}

async function marketLotDepthProof(page: Page): Promise<{
  multiTileLots: number;
  mismatches: Array<{ id: string | undefined; actual: number; expected: number; tileIds: number[] }>;
}> {
  return page.locator('#terrain-construction-overlays').evaluate((scene) => {
    const rotation = Number(document.querySelector<HTMLElement>('.city-client')?.dataset.viewRotation ?? 0);
    const rotate = (x: number, y: number): { x: number; y: number } => {
      switch (((rotation % 4) + 4) % 4) {
        case 1: return { x: 48 - y, y: x };
        case 2: return { x: 48 - x, y: 48 - y };
        case 3: return { x: y, y: 48 - x };
        default: return { x, y };
      }
    };
    const parts = [...scene.querySelectorAll<SVGGElement>(':scope > [data-render-contract="market-rci-svg-v1"][data-world-part-kind]')];
    const mismatches: Array<{ id: string | undefined; actual: number; expected: number; tileIds: number[] }> = [];
    const multiTileLotIds = new Set<string>();
    let previousDepth = -Infinity;
    for (const part of parts) {
      const tileIds = (part.dataset.tileIds ?? '').split(',').filter(Boolean).map(Number);
      if (tileIds.length > 1 && part.dataset.marketLotId) multiTileLotIds.add(part.dataset.marketLotId);
      const anchorX = Number(part.dataset.renderAnchorX);
      const anchorY = Number(part.dataset.renderAnchorY);
      const elevation = Number(part.dataset.renderElevation);
      const view = rotate(anchorX, anchorY);
      const expected = view.x + view.y - (elevation - 2);
      const actual = Number(part.dataset.renderDepth);
      // The DOM contract is deliberately serialised to four decimal places;
      // compare the recomputed painter depth at that published precision.
      if (Math.abs(actual - expected) > 0.00011) {
        mismatches.push({ id: part.dataset.marketLotId, actual, expected, tileIds });
      }
      if (actual + 0.00011 < previousDepth) mismatches.push({ id: part.dataset.marketLotId, actual, expected: previousDepth, tileIds });
      previousDepth = actual;
    }
    return { multiTileLots: multiTileLotIds.size, mismatches };
  });
}

/**
 * Exercise the repaired renderer in a real developed city rather than a
 * separate authoring surface. Every pair below is a pair of distinct lots
 * whose actual painted bounds intersect in the current camera projection.
 */
async function rciProjectedOverlapProof(page: Page): Promise<{
  overlaps: number;
  orderingViolations: Array<{ far: string; near: string; farRank: number; nearRank: number }>;
}> {
  return page.locator('#terrain-construction-overlays').evaluate((scene) => {
    type Part = {
      id: string;
      lotId: string;
      depth: number;
      sublayer: number;
      rank: number;
      box: DOMRect;
    };
    const parts = [...scene.querySelectorAll<SVGGElement>(':scope > [data-render-contract="market-rci-svg-v1"][data-world-part-kind]')]
      .map((part): Part | null => {
        const box = part.getBBox();
        const id = part.dataset.renderItemId;
        const lotId = part.dataset.marketLotId;
        if (!id || !lotId || box.width <= .01 || box.height <= .01) return null;
        return {
          id,
          lotId,
          depth: Number(part.dataset.renderDepth),
          sublayer: Number(part.dataset.renderSublayer),
          rank: Number(part.dataset.occlusionRank),
          box,
        };
      })
      .filter((part): part is Part => part !== null);
    const comparePainterOrder = (left: Part, right: Part): number => (
      Math.abs(left.depth - right.depth) > .00011 ? left.depth - right.depth
        : left.sublayer - right.sublayer || left.id.localeCompare(right.id)
    );
    const orderingViolations: Array<{ far: string; near: string; farRank: number; nearRank: number }> = [];
    let overlaps = 0;
    for (let leftIndex = 0; leftIndex < parts.length; leftIndex += 1) {
      const left = parts[leftIndex]!;
      for (let rightIndex = leftIndex + 1; rightIndex < parts.length; rightIndex += 1) {
        const right = parts[rightIndex]!;
        if (left.lotId === right.lotId) continue;
        const width = Math.min(left.box.x + left.box.width, right.box.x + right.box.width) - Math.max(left.box.x, right.box.x);
        const height = Math.min(left.box.y + left.box.height, right.box.y + right.box.height) - Math.max(left.box.y, right.box.y);
        if (width <= .25 || height <= .25) continue;
        overlaps += 1;
        const [far, near] = comparePainterOrder(left, right) <= 0 ? [left, right] : [right, left];
        if (far.rank >= near.rank) orderingViolations.push({ far: far.id, near: near.id, farRank: far.rank, nearRank: near.rank });
      }
    }
    return { overlaps, orderingViolations };
  });
}

async function maybeScreenshot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  if (!captureEvidence) return;
  const path = testInfo.outputPath(name);
  await page.screenshot({ path });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

async function seedV2City(page: Page, state: MarketCityStateV2): Promise<void> {
  const seedUrl = '**/__market-city-v2-seed__.html';
  await page.route(seedUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>MarketCity V2 seed</title>',
  }));
  await page.goto('/__market-city-v2-seed__.html', { waitUntil: 'domcontentloaded' });
  await page.unroute(seedUrl);
  await page.evaluate(async (seed) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v2-fire', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('market-cities-v2-fire')) {
        database.createObjectStore('market-cities-v2-fire', { keyPath: 'cityId' });
      }
      if (!database.objectStoreNames.contains('market-profile-v2-fire')) {
        database.createObjectStore('market-profile-v2-fire', { keyPath: 'key' });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v2-fire', 'readwrite');
      transaction.objectStore('market-cities-v2-fire').put({
        cityId: seed.identity.cityId,
        savedAt: '2026-08-12T00:00:00.000Z',
        state: seed,
      });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  }), state);
}

function legacyV1City(cityId: string): Record<string, unknown> {
  const count = 48 * 48;
  const fireTile = 10 * 48 + 10;
  const windTile = 6 * 48 + 6;
  const zones = Array<'R' | 'C' | 'I' | null>(count).fill(null);
  const roads = Array<boolean>(count).fill(false);
  const powerLines = Array<boolean>(count).fill(false);
  const density = Array<number>(count).fill(0);
  const wealth = Array<number>(count).fill(0);
  const roadAccess = Array<boolean>(count).fill(false);
  const powered = Array<boolean>(count).fill(false);
  const intensity = Array<number>(count).fill(0);
  const damage = Array<number>(count).fill(0);
  const age = Array<number>(count).fill(0);
  const char = Array<number>(count).fill(0);
  zones[fireTile] = 'R';
  roads[fireTile + 48] = true;
  powerLines[fireTile - 1] = true;
  density[fireTile] = 0.72;
  wealth[fireTile] = 18_000;
  roadAccess[fireTile] = true;
  powered[fireTile] = true;
  intensity[fireTile] = 0.4;
  damage[fireTile] = 2;
  age[fireTile] = 3;
  char[fireTile] = 0.1;
  return {
    schemaVersion: 1,
    rulesVersion: 'claude-market-1.0.0',
    identity: {
      cityId, cityName: 'Migrated Legacy City', mayorName: 'Legacy Mayor', seed: 71,
      createdAt: '2026-08-11T00:00:00.000Z',
    },
    clock: { month: 19, paused: true, speed: 2, fireDifficulty: 'hard' },
    map: {
      size: 48,
      terrain: {
        water: Array<boolean>(count).fill(false),
        elevation: Array<number>(count).fill(0),
        material: Array<'grass'>(count).fill('grass'),
        trees: Array<number>(count).fill(0),
      },
      zones,
      roads,
      powerLines,
      facilities: [{ id: 'legacy-wind', kind: 'wind-turbine', anchor: windTile, tiles: [windTile] }],
    },
    economy: {
      density, wealth, treasury: 4_321, lastRevenue: 55, lastOperatingExpense: 99, lastNet: -44,
    },
    environment: {
      pollution: Array<number>(count).fill(0),
      congestion: Array<number>(count).fill(0),
      roadAccess,
      powered,
    },
    fire: { intensity, damage, age, char, collapsedTotal: 1 },
    market: { demand: { R: 12, C: 7, I: 9 }, margin: { R: -1, C: 2, I: 3 } },
  };
}

async function seedLegacyV1City(page: Page, cityId: string, state: Record<string, unknown>): Promise<void> {
  const seedUrl = '**/__market-city-v1-seed__.html';
  await page.route(seedUrl, (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>MarketCity V1 seed</title>',
  }));
  await page.goto('/__market-city-v1-seed__.html', { waitUntil: 'domcontentloaded' });
  await page.unroute(seedUrl);
  await page.evaluate(async ({ id, legacy }) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v1', 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('market-cities-v1')) {
        database.createObjectStore('market-cities-v1', { keyPath: 'cityId' });
      }
      if (!database.objectStoreNames.contains('market-profile-v1')) {
        database.createObjectStore('market-profile-v1', { keyPath: 'key' });
      }
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v1', 'readwrite');
      transaction.objectStore('market-cities-v1').put({
        cityId: id,
        savedAt: '2026-08-11T14:00:00.000Z',
        state: legacy,
      });
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
    };
  }), { id: cityId, legacy: state });
}

async function hasLegacyV1City(page: Page, cityId: string): Promise<boolean> {
  return page.evaluate(async (id) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v1', 2);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v1', 'readonly');
      const read = transaction.objectStore('market-cities-v1').get(id);
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        database.close();
        resolve(read.result !== undefined);
      };
    };
  }), cityId);
}

async function readPersistedV2City(page: Page, cityId: string): Promise<MarketCityStateV2> {
  return page.evaluate(async (id) => new Promise<MarketCityStateV2>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v2-fire', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v2-fire', 'readonly');
      const read = transaction.objectStore('market-cities-v2-fire').get(id);
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        const record = read.result as { state?: MarketCityStateV2 } | undefined;
        database.close();
        if (!record?.state) reject(new Error(`No persisted MarketCityV2 record exists for ${id}.`));
        else resolve(record.state);
      };
    };
  }), cityId);
}

async function hasPersistedV2City(page: Page, cityId: string): Promise<boolean> {
  return page.evaluate(async (id) => new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open('synthcity-market-v2-fire', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('market-cities-v2-fire', 'readonly');
      const read = transaction.objectStore('market-cities-v2-fire').get(id);
      read.onerror = () => reject(read.error);
      read.onsuccess = () => {
        database.close();
        resolve(read.result !== undefined);
      };
    };
  }), cityId);
}

function powerOverloadFixture(cityId: string): {
  state: MarketCityStateV2;
  consumerTiles: number[];
  expectedWindServed: number[];
} {
  const state = createMarketCityState({
    cityId,
    cityName: 'Power Allocation Lab',
    mayorName: 'Browser Mayor',
    seed: 37,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  state.market.verticalDevelopmentLevel = 2;
  const tile = (x: number, y: number): number => y * 48 + x;
  const consumerTiles = Array.from({ length: 21 }, (_, index) => (
    tile(12 + index % 5, 10 + Math.floor(index / 5))
  ));
  for (const consumer of consumerTiles) {
    state.map.zones[consumer] = 'I';
    state.economy.density[consumer] = 0.2;
    state.economy.wealth[consumer] = 10_000;
  }

  // Twenty-one nearby industrial lots have a valid Level-2 cap of 0.2. After
  // one simulated month each settles to 0.15 density, so the 60-power wind
  // serves the first twenty prior consumers and sheds the final one.
  for (const consumer of consumerTiles.slice(0, 15)) state.environment.powered[consumer] = true;
  for (let y = 10; y <= 15; y += 1) state.map.powerLines[tile(11, y)] = true;
  state.map.roads[tile(9, 12)] = true;
  state.map.roads[tile(8, 14)] = true;
  return {
    state,
    consumerTiles,
    expectedWindServed: consumerTiles.slice(0, 20),
  };
}

function lowDensityZoneColourFixture(cityId: string): MarketCityStateV2 {
  const state = createMarketCityState({
    cityId,
    cityName: 'Zone Colour Lab',
    mayorName: 'Browser Mayor',
    seed: 59,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  const zones = [
    { x: 18, zone: 'R' },
    { x: 22, zone: 'C' },
    { x: 26, zone: 'I' },
  ] as const;
  for (const { x, zone } of zones) {
    const tile = 20 * 48 + x;
    state.map.zones[tile] = zone;
    state.economy.density[tile] = 0.03;
    state.economy.wealth[tile] = 10_000;
  }
  return state;
}

function windTurbineForegroundFixture(cityId: string): {
  state: MarketCityStateV2;
  rearZone: number;
  frontZone: number;
  frontWind: number;
} {
  const state = createMarketCityState({
    cityId,
    cityName: 'Wind Turbine Depth Lab',
    mayorName: 'Browser Mayor',
    seed: 79,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
  // The blue cell at rearZone is three cells behind the turbine in the default
  // south camera. frontZone intentionally shares its sector: the legacy
  // batcher used its nearer depth for *both* blue cells, making the rear tile
  // overpaint the turbine in the supplied screenshot.
  state.market.verticalDevelopmentLevel = 10;
  const rearZone = tile(20, 20);
  const frontZone = tile(20, 24);
  const frontWind = tile(20, 23);
  state.map.zones[rearZone] = 'C';
  state.map.zones[frontZone] = 'C';
  state.map.facilities.push({
    id: 'wind-depth-lab', kind: 'wind-turbine', anchor: frontWind, tiles: [frontWind],
  });
  return { state, rearZone, frontZone, frontWind };
}

function contiguousServiceWarningFixture(cityId: string): {
  state: MarketCityStateV2;
  northTiles: number[];
  southTiles: number[];
} {
  const state = createMarketCityState({
    cityId,
    cityName: 'Contiguous Service Warning Lab',
    mayorName: 'Browser Mayor',
    seed: 61,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
  const northTiles = [tile(19, 18), tile(20, 18), tile(19, 19), tile(20, 19)];
  const southTiles = [tile(19, 21), tile(20, 21), tile(19, 22), tile(20, 22)];
  for (const [index, zoneTile] of [...northTiles, ...southTiles].entries()) {
    state.map.zones[zoneTile] = (['R', 'C', 'I'] as const)[index % 3]!;
  }
  // A road separates the two failed zoning areas but leaves every tile within
  // its normal Manhattan-three service reach. It is deliberately not powered
  // or watered so only those two warning kinds are emitted.
  for (let x = 17; x <= 25; x += 1) state.map.roads[tile(x, 20)] = true;
  return { state, northTiles, southTiles };
}

function perTileRoadWarningFixture(cityId: string): {
  state: MarketCityStateV2;
  allZoneTiles: number[];
  roadlessTiles: number[];
} {
  const state = createMarketCityState({
    cityId,
    cityName: 'Per-Tile Road Warning Lab',
    mayorName: 'Browser Mayor',
    seed: 67,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
  // The front lot is exactly three Manhattan tiles from the road. The three
  // contiguous lots behind it are four, five, and six tiles away. All four
  // still form one missing-power and missing-water component.
  const allZoneTiles = [tile(20, 14), tile(20, 15), tile(20, 16), tile(20, 17)];
  const roadlessTiles = allZoneTiles.slice(0, 3);
  for (const [index, zoneTile] of allZoneTiles.entries()) {
    state.map.zones[zoneTile] = (['R', 'C', 'I'] as const)[index % 3]!;
  }
  state.map.roads[tile(20, 20)] = true;
  return { state, allZoneTiles, roadlessTiles };
}

function dezoneOverlayFixture(cityId: string): {
  state: MarketCityStateV2;
  developed: number;
  empty: number;
  roadOverlay: number;
} {
  const state = createMarketCityState({
    cityId,
    cityName: 'Dezone Overlay Lab',
    mayorName: 'Browser Mayor',
    seed: 71,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
  const developed = tile(10, 10);
  const empty = tile(11, 10);
  const roadOverlay = tile(12, 10);
  state.map.zones[developed] = 'R';
  state.economy.density[developed] = 0.06;
  state.economy.wealth[developed] = 10_000;
  state.map.zones[empty] = 'R';
  state.map.zones[roadOverlay] = 'R';
  state.map.roads[roadOverlay] = true;
  return { state, developed, empty, roadOverlay };
}

interface RailStationSite {
  name: 'A' | 'B' | 'C';
  x: number;
  y: number;
  anchor: number;
}

function railStationSites(xs: readonly [number, number, number]): RailStationSite[] {
  const names: readonly ['A', 'B', 'C'] = ['A', 'B', 'C'];
  return xs.map((x, index) => ({
    name: names[index]!,
    x,
    y: 17,
    anchor: 17 * 48 + x,
  }));
}

function railServiceFixture(
  cityId: string,
  stationXs: readonly [number, number, number],
  withRidership = false,
): { state: MarketCityStateV2; stations: RailStationSite[] } {
  const state = createMarketCityState({
    cityId,
    cityName: withRidership ? 'Rail Ridership Lab' : 'Rail Animation Lab',
    mayorName: 'Browser Mayor',
    seed: 83,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  const tile = (x: number, y: number): number => y * 48 + x;
  const stations = railStationSites(stationXs);

  if (withRidership) {
    const stocks = [
      { x: 7, y: 11, zone: 'R' as const, density: 0.4 },
      { x: 1, y: 17, zone: 'C' as const, density: 0.1 },
      { x: 22, y: 11, zone: 'R' as const, density: 0.3 },
      { x: 16, y: 17, zone: 'C' as const, density: 0.4 },
      { x: 28, y: 17, zone: 'I' as const, density: 0.3 },
      { x: 36, y: 11, zone: 'R' as const, density: 0.9 },
      { x: 42, y: 17, zone: 'I' as const, density: 0.2 },
      // These high-density controls are exactly seven tiles from the nearest
      // 2x2 footprint cell and must never enter a radius-six catchment.
      { x: 7, y: 10, zone: 'R' as const, density: 0.99 },
      { x: 44, y: 17, zone: 'C' as const, density: 0.99 },
    ];
    for (const stock of stocks) {
      const id = tile(stock.x, stock.y);
      state.map.zones[id] = stock.zone;
      state.economy.density[id] = stock.density;
      state.economy.wealth[id] = 10_000;
    }
  }
  return { state, stations };
}

async function buildThreeStationRail(
  page: Page,
  stations: readonly RailStationSite[],
  railStartX: number,
  railEndX: number,
): Promise<void> {
  // Every operational prerequisite is built through the player-facing UI.
  // The 3x station row shares one road, one wind-backed power trunk, and one
  // source-fed water coverage run; the fixture itself provides only demand.
  await selectRoad(page);
  await dragMapRoute(page, { x: 3, y: 16 }, { x: 44, y: 16 }, {
    action: 'road', footprint: 42, valid: true,
  });
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 3, 15, 'facility:wind-turbine', 1);
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 2, 15, 'facility:wind-turbine', 1);
  await selectPowerItem(page, 'power-line');
  await dragMapRoute(page, { x: 4, y: 15 }, { x: 44, y: 15 }, {
    action: 'power-line', footprint: 41, valid: true,
  });
  await clickMapCell(page, 4, 14);
  await selectWaterItem(page, 'network:water-pipe');
  await dragMapRoute(page, { x: 3, y: 14 }, { x: 44, y: 14 }, {
    action: 'network:water-pipe', footprint: 42, valid: true,
  });
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 4, 12, 'facility:water-tower', 4);
  await selectRail(page);
  await dragMapRoute(page, { x: railStartX, y: 19 }, { x: railEndX, y: 19 }, {
    action: 'network:rail', footprint: railEndX - railStartX + 1, valid: true,
  });
  for (const station of stations) {
    await selectTrainStation(page);
    await previewAndClickMapCell(page, station.x, station.y, 'facility:train-station', 4);
  }
  await expect(page.locator(
    '#terrain-construction-overlays .terrain-facility-world[data-facility-kind="train-station"]',
  )).toHaveCount(3);
  await expect(page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]')).toHaveCount(2);
}

async function attachJson(testInfo: TestInfo, name: string, value: unknown): Promise<void> {
  const body = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  if (!captureEvidence) {
    await testInfo.attach(name, { body, contentType: 'application/json' });
    return;
  }
  const path = testInfo.outputPath(name);
  await writeFile(path, body);
  await testInfo.attach(name, { path, contentType: 'application/json' });
}

test('opens the MarketCityV2 shell and ignores unrelated legacy browser data', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('synthcity-v5-autosave', '{"schemaVersion":5,"cityName":"Legacy Ghost"}');
  });
  await page.goto('/design-review/square-grid-mayor.html?profile=city&size=60', { waitUntil: 'networkidle' });

  await expect(page.getByRole('dialog', { name: 'SynthCity' })).toBeVisible();
  await expect(page.locator('#city-opening-list')).toContainText('No cities yet.');
  await expect(page.locator('#city-opening-list')).not.toContainText('Legacy Ghost');
  expect(await page.evaluate(() => localStorage.getItem('synthcity-v5-autosave'))).toContain('Legacy Ghost');
  await expect(page.locator('.tile')).toHaveCount(2_304);
});

test('shows a Play affordance while paused and starts the simulation on click', async ({ page }) => {
  await openCity(page, `market-play-affordance-${Date.now()}`);
  const speed = page.locator('#simulation-speed');

  await expect(speed).toHaveText('▶ Play');
  await expect(speed).toHaveAttribute('aria-label', 'Play simulation');
  await expect(speed).toHaveAttribute('data-speed', '0');
  await speed.click();
  await expect(speed).toHaveText('1× Running');
  await expect(speed).toHaveAttribute('data-speed', '1');

  await speed.click();
  await speed.click();
  await speed.click();
  await expect(speed).toHaveText('▶ Play');
  await expect(speed).toHaveAttribute('aria-label', 'Play simulation');
  await expect(speed).toHaveAttribute('data-speed', '0');
});

test('keeps low-density empty-looking RCI permissions visibly sector-coloured', async ({ page }) => {
  const cityId = `market-zone-colours-${Date.now()}`;
  await seedV2City(page, lowDensityZoneColourFixture(cityId));
  await openCity(page, cityId);

  await expect(page.locator('.market-building-world')).toHaveCount(0);
  const overlays = page.locator('.terrain-zone-world .terrain-zone');
  await expect(overlays).toHaveCount(3);

  const colours = await overlays.evaluateAll((paths) => Object.fromEntries(paths.map((path) => {
    const sector = path.classList.contains('commercial')
      ? 'commercial'
      : path.classList.contains('industrial')
        ? 'industrial'
        : 'residential';
    const channels = getComputedStyle(path).fill.match(/[\d.]+/g)?.map(Number) ?? [];
    return [sector, channels];
  })));
  expect(colours.residential?.[1]).toBeGreaterThan(colours.residential?.[0] ?? Infinity);
  expect(colours.commercial?.[2]).toBeGreaterThan(colours.commercial?.[1] ?? Infinity);
  expect(colours.industrial?.[0]).toBeGreaterThan(colours.industrial?.[1] ?? Infinity);
  expect(colours.industrial?.[1]).toBeGreaterThan(colours.industrial?.[2] ?? Infinity);
  expect(colours.residential?.[3]).toBeGreaterThanOrEqual(0.78);
  expect(colours.commercial?.[3]).toBeGreaterThanOrEqual(0.78);
  expect(colours.industrial?.[3]).toBeGreaterThanOrEqual(0.78);
});

test('migrates a real V1 IndexedDB city without deleting its legacy record', async ({ page }, testInfo) => {
  const cityId = `market-v1-migration-${Date.now()}`;
  await seedLegacyV1City(page, cityId, legacyV1City(cityId));
  await openCity(page, cityId);

  const migrated = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const fireTile = 10 * 48 + 10;
  expect(migrated).toMatchObject({
    schemaVersion: 2,
    rulesVersion: MARKET_CITY_RULES_VERSION,
    identity: { cityId, cityName: 'Migrated Legacy City', mayorName: 'Legacy Mayor' },
    clock: { month: 19, fireDifficulty: 'hard' },
    economy: { treasury: 4_321 },
    fire: { collapsedTotal: 1 },
  });
  expect(migrated.map.zones[fireTile]).toBe('R');
  expect(migrated.map.roads[fireTile + 48]).toBe(true);
  expect(migrated.map.facilities).toContainEqual(expect.objectContaining({ id: 'legacy-wind', kind: 'wind-turbine' }));
  expect(migrated.fire.char[fireTile]).toBeCloseTo(0.1, 12);
  expect(migrated.fire.incidents).toContainEqual(expect.objectContaining({
    tileIds: [fireTile], intensity: 0.4, damage: 2, age: 3, status: 'burning',
  }));
  expect(await hasLegacyV1City(page, cityId)).toBe(true);

  await page.evaluate(async () => {
    const dashboard = window.marketCityDashboard as Dashboard;
    await dashboard.save();
    await dashboard.whenDurable();
  });
  expect(await hasPersistedV2City(page, cityId)).toBe(true);
  const migratedHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => (window.marketCityDashboard as Dashboard)?.hash())).toBe(migratedHash);
  expect(await hasLegacyV1City(page, cityId)).toBe(true);
  await attachJson(testInfo, 'v1-migration-proof.json', {
    cityId,
    hash: migratedHash,
    incidentTile: fireTile,
    legacyRecordRetained: true,
    currentRecordSaved: true,
  });
});

test('migrates a real pre-4×2 Solar IndexedDB city without overwriting adjacent roads', async ({ page }, testInfo) => {
  const cityId = `solar-footprint-prior-rules-${Date.now()}`;
  const anchor = 10 * 48 + 10;
  const current = createMarketCityState({
    cityId, cityName: 'Solar Migration City', mayorName: 'Browser Mayor', seed: 618, createdAt: '2026-08-12T00:00:00.000Z',
  });
  current.map.roads[10 * 48 + 12] = true;
  current.map.roads[10 * 48 + 13] = true;
  const prior = JSON.parse(JSON.stringify(current)) as Record<string, unknown>;
  prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT;
  // A save from before 2.11 has no crime record; this fixture is cloned from a
  // CURRENT state, so the key has to come back off or migration correctly rejects it.
  delete (prior as { crime?: unknown }).crime;
  (prior.map as { facilities: unknown[] }).facilities = [{
    id: 'legacy-solar', kind: 'solar-plant', anchor,
    tiles: [anchor, anchor + 1, anchor + 48, anchor + 49],
  }];
  await seedV2City(page, prior as unknown as MarketCityStateV2);
  await openCity(page, cityId);

  let migrated = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
  expect(migrated.map.roads[10 * 48 + 12]).toBe(true);
  expect(migrated.map.roads[10 * 48 + 13]).toBe(true);
  expect(migrated.map.facilities.find(({ id }) => id === 'legacy-solar')?.tiles)
    .toEqual([anchor, anchor + 1, anchor + 48, anchor + 49]);

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
  expect(migrated.map.facilities.find(({ id }) => id === 'legacy-solar')?.tiles)
    .toEqual([anchor, anchor + 1, anchor + 48, anchor + 49]);

  await attachJson(testInfo, 'solar-prior-rules-indexeddb-migration.json', {
    cityId, fromRules: MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT, toRules: MARKET_CITY_RULES_VERSION,
    preservedTiles: [anchor, anchor + 1, anchor + 48, anchor + 49], adjacentRoadsRetained: true, exactReload: true,
  });
});

test('places every active manifest item through visible player controls and reloads it', async ({ page }) => {
  const cityId = `market-active-manifest-${Date.now()}`;
  await openCity(page, cityId);
  const handled: string[] = [];
  const positions: Record<string, { x: number; y: number }> = {
    'zone-residential': { x: 5, y: 5 },
    'zone-commercial': { x: 6, y: 5 },
    'zone-industrial': { x: 7, y: 5 },
    road: { x: 5, y: 8 },
    avenue: { x: 7, y: 8 },
    rail: { x: 10, y: 10 },
    subway: { x: 10, y: 13 },
    'power-line': { x: 5, y: 10 },
    'water-pipe': { x: 5, y: 15 },
    'coal-power-plant': { x: 10, y: 5 },
    'gas-power-plant': { x: 15, y: 5 },
    'nuclear-power-plant': { x: 20, y: 5 },
    'wind-turbine': { x: 25, y: 5 },
    'solar-plant': { x: 28, y: 5 },
    'water-tower': { x: 10, y: 15 },
    'coastal-water-pump': { x: 25, y: 15 },
    'water-treatment-plant': { x: 15, y: 15 },
    'fire-station': { x: 32, y: 5 },
    'police-station': { x: 38, y: 5 },
    'train-station': { x: 35, y: 8 },
    'subway-station': { x: 11, y: 13 },
    'landfill-zone': { x: 42, y: 42 },
  };

  for (const item of MARKET_ITEM_MANIFEST.filter(({ status }) => status === 'active')) {
    const position = positions[item.id];
    if (!position) throw new Error(`Active manifest item ${item.id} has no visible-control browser placement.`);
    let placedByGesture = false;
    switch (item.id) {
      case 'zone-residential': await selectZone(page, 'residential'); break;
      case 'zone-commercial': await selectZone(page, 'commercial'); break;
      case 'zone-industrial': await selectZone(page, 'industrial'); break;
      case 'road': await selectRoad(page); break;
      case 'avenue':
        await selectAvenue(page, 'right');
        await dragMapRoute(page, position, { x: position.x + 1, y: position.y }, {
          action: 'network:avenue', footprint: 4, valid: true,
        });
        placedByGesture = true;
        break;
      case 'rail':
        await selectRail(page);
        await dragMapRoute(page, position, { x: position.x + 1, y: position.y }, {
          action: 'network:rail', footprint: 2, valid: true,
        });
        placedByGesture = true;
        break;
      case 'subway':
        await selectSubway(page);
        await dragMapRoute(page, position, { x: position.x + 1, y: position.y }, {
          action: 'network:subway', footprint: 2, valid: true,
        });
        placedByGesture = true;
        break;
      case 'power-line': await selectPowerItem(page, 'power-line'); break;
      case 'water-pipe': await selectWaterItem(page, 'network:water-pipe'); break;
      case 'coal-power-plant':
      case 'gas-power-plant':
      case 'nuclear-power-plant':
      case 'wind-turbine':
      case 'solar-plant':
        await selectPowerItem(page, `facility:${item.id}`);
        break;
      case 'water-tower':
      case 'water-treatment-plant':
        await selectWaterItem(page, `facility:${item.id}`);
        break;
      case 'coastal-water-pump':
        await paintSurfaceWater(page, position.x - 1, position.y);
        await selectWaterItem(page, `facility:${item.id}`);
        break;
      case 'train-station': await selectTrainStation(page); break;
      case 'subway-station': await selectSubwayStation(page); break;
      case 'fire-station': await selectFireStation(page); break;
      case 'police-station': await selectPoliceStation(page); break;
      case 'landfill-zone': await selectLandfillZone(page); break;
      default: throw new Error(`Active manifest item ${item.id} is not bound to a visible player control.`);
    }
    if (!placedByGesture) await clickMapCell(page, position.x, position.y);
    handled.push(item.id);
  }

  expect(handled).toEqual(MARKET_ITEM_MANIFEST.filter(({ status }) => status === 'active').map(({ id }) => id));
  expect(handled).toEqual(expect.arrayContaining(['rail', 'train-station', 'subway', 'subway-station']));
  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect([state.map.zones[5 * 48 + 5], state.map.zones[5 * 48 + 6], state.map.zones[5 * 48 + 7]])
    .toEqual(['R', 'C', 'I']);
  expect(state.map.roads[8 * 48 + 5]).toBe(true);
  expect(avenueTileIds(state)).toHaveLength(4);
  assertReciprocalAvenueMasks(state);
  expect(railTileIds(state)).toHaveLength(2);
  assertReciprocalRailMasks(state);
  expect([state.map.subways[13 * 48 + 10], state.map.subways[13 * 48 + 11]]).toEqual([true, true]);
  expect(state.map.subwayConnectionMasks[13 * 48 + 10]).toBeGreaterThan(0);
  expect(state.map.subwayConnectionMasks[13 * 48 + 11]).toBeGreaterThan(0);
  expect(state.map.powerLines[10 * 48 + 5]).toBe(true);
  expect(state.map.waterPipes[15 * 48 + 5]).toBe(true);
  expect(state.map.landfillZones[42 * 48 + 42]).toBe(true);
  const facilityKinds = state.map.facilities.map(({ kind }) => kind).sort();
  expect(facilityKinds).toEqual([
    'coal-power-plant',
    'coastal-water-pump',
    'fire-station',
    'gas-power-plant',
    'nuclear-power-plant',
    'police-station',
    'solar-plant',
    'subway-station',
    'train-station',
    'water-tower',
    'water-treatment-plant',
    'wind-turbine',
  ]);
  await expect(page.locator('.terrain-zone-world')).not.toHaveCount(0);
  await expect(page.locator('.terrain-road-world')).not.toHaveCount(0);
  await expect(page.locator('.terrain-avenue-world')).toHaveCount(4);
  await expect(page.locator('.terrain-rail-world')).toHaveCount(2);
  await expect(page.locator('#underground-network-overlays .underground-subway')).not.toHaveCount(0);
  await expect(page.locator('.terrain-power-pole-world')).not.toHaveCount(0);
  await expect(page.locator('.terrain-landfill-world[data-tile="2058"]')).toHaveCount(1);
  for (const kind of facilityKinds) {
    await expect(page.locator(`.terrain-facility-world.facility-${kind}, [data-facility-art="${kind}"]`).first())
      .toBeVisible();
  }

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);
});

test('offers a truthful paired-lane Avenue card with automatic right-hand placement through every rotation', async ({ page }, testInfo) => {
  await openCity(page, `market-avenue-catalog-${Date.now()}`);

  let card = await openAvenueCard(page);
  await expect(card).toHaveAccessibleName('Avenue');
  await expect(card).toContainText('2 × 2 tiles');
  await expect(card).toContainText('$1,293 per tile each month');
  const cardWorld = card.locator('.catalog-thumbnail-network-avenue');
  await expect(cardWorld).toHaveAttribute('data-world-recipe-id', 'network:avenue:v1');
  await expect(cardWorld).toHaveAttribute('data-driving-side', 'right');
  await card.click();

  await expect(page.locator('#avenue-expansion-side')).toHaveCount(0);
  await expect(page.locator('.city-client')).toHaveAttribute('data-avenue-traffic', 'right-hand');
  await dragMapRoute(page, { x: 10, y: 10 }, { x: 15, y: 10 }, {
    action: 'network:avenue', footprint: 12, valid: true,
  });

  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(state)).toEqual([
    ...Array.from({ length: 6 }, (_, index) => 9 * 48 + 10 + index),
    ...Array.from({ length: 6 }, (_, index) => 10 * 48 + 10 + index),
  ]);
  assertReciprocalAvenueMasks(state);
  assertStraightAvenueDirectionOpposition(state, avenueTileIds(state));
  expect(Array.from({ length: 6 }, (_, index) => state.map.avenueTravelMasks[10 * 48 + 10 + index] ?? 0).some((mask) => (mask & 2) !== 0)).toBe(true);
  expect(Array.from({ length: 6 }, (_, index) => state.map.avenueTravelMasks[9 * 48 + 10 + index] ?? 0).some((mask) => (mask & 8) !== 0)).toBe(true);

  const world = page.locator('#terrain-construction-overlays .terrain-avenue-world[data-tile]');
  await expect(world).toHaveCount(12);
  await expect(world.locator('.terrain-avenue-direction-marking')).not.toHaveCount(0);
  for (let rotation = 0; rotation < 4; rotation += 1) {
    card = await openAvenueCard(page);
    await expect(card.locator('.utility-catalog-preview-svg')).toHaveAttribute('data-preview-rotation', String(rotation));
    await page.getByRole('button', { name: 'Close transit catalogue' }).click();
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await attachJson(testInfo, 'avenue-visible-card-right-hand.json', {
    footprint: [2, 2], laneTiles: avenueTileIds(state), rotations: [0, 1, 2, 3], drivingSide: 'right',
  });
  await maybeScreenshot(page, testInfo, 'avenue-card-world-four-rotations.png');
});

test('shows and commits a directional 2 by 2 Avenue before a drag, then flips direction when the gesture reverses', async ({ page }, testInfo) => {
  await openCity(page, `market-avenue-single-click-${Date.now()}`);
  await selectAvenue(page, 'left');
  const initial = await projectedPoint(page, 20, 20);
  await page.mouse.move(initial.x, initial.y);
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');
  await expect(preview).toHaveCount(4);
  expect(await preview.evaluateAll((elements) => elements.every((element) => element.dataset.valid === 'true'))).toBe(true);
  await expect(preview.first()).toHaveAttribute('data-gesture-direction', 'east');
  await expect(page.locator('#network-preview-label')).toContainText('Avenue direction east');

  await page.mouse.click(initial.x, initial.y);
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(state)).toEqual([tile(20, 19), tile(21, 19), tile(20, 20), tile(21, 20)]);

  const eastStart = await projectedPoint(page, 20, 20);
  const eastEnd = await projectedPoint(page, 21, 20);
  await page.mouse.move(eastStart.x, eastStart.y);
  await page.mouse.down();
  await page.mouse.move(eastEnd.x, eastEnd.y, { steps: 8 });
  await expect(preview).toHaveCount(4);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"][data-lane-role="drawn"]')).toHaveCount(2);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"][data-lane-role="paired"]')).toHaveCount(2);
  await expect(preview.first()).toHaveAttribute('data-gesture-direction', 'east');
  await expect(page.locator('#network-preview-label')).toContainText('Avenue direction east');
  await page.mouse.up();

  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(state)).toEqual([tile(20, 19), tile(21, 19), tile(20, 20), tile(21, 20)]);
  expect(state.map.avenueTravelMasks[tile(20, 20)]).toBe(2);

  const world = page.locator('#terrain-construction-overlays .terrain-avenue-world[data-tile]');
  await expect(world).toHaveCount(4);
  await expect(world.locator('.terrain-avenue-direction-marking')).not.toHaveCount(0);

  await selectAvenue(page, 'left');
  const westStart = await projectedPoint(page, 21, 24);
  const westEnd = await projectedPoint(page, 20, 24);
  await page.mouse.move(westStart.x, westStart.y);
  await page.mouse.down();
  await page.mouse.move(westEnd.x, westEnd.y, { steps: 8 });
  await expect(preview).toHaveCount(4);
  await expect(preview.first()).toHaveAttribute('data-gesture-direction', 'west');
  await expect(page.locator('#network-preview-label')).toContainText('Avenue direction west');
  await page.mouse.up();

  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(state)).toHaveLength(8);
  expect(state.map.avenueTravelMasks[tile(21, 24)]).toBe(8);

  await maybeScreenshot(page, testInfo, 'avenue-two-by-two-directional-drag.png');
});

test('aims a valid 2 by 2 Avenue ghost from each hovered tile edge without mutating the city', async ({ page }) => {
  await openCity(page, `market-avenue-hover-aim-${Date.now()}`);
  await selectAvenue(page);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');

  for (const direction of ['north', 'east', 'south', 'west'] as const) {
    const point = await projectedEdgePoint(page, 24, 24, direction);
    await page.mouse.move(point.x, point.y);
    await expect(preview).toHaveCount(4);
    await expect(preview.first()).toHaveAttribute('data-gesture-direction', direction);
    expect(await preview.evaluateAll((elements) => elements.every((element) => element.dataset.valid === 'true'))).toBe(true);
    await expect(page.locator('#network-preview-label')).toContainText(`Avenue direction ${direction}`);
  }

  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
});

test('mirrors an off-map preferred Avenue side only when the canonical alternative is valid', async ({ page }, testInfo) => {
  const cityId = `market-avenue-edge-mirror-${Date.now()}`;
  await openCity(page, cityId);
  await selectAvenue(page, 'left');

  const edge = await projectedPoint(page, 0, 0);
  const edgeEnd = await projectedPoint(page, 1, 0);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edgeEnd.x, edgeEnd.y, { steps: 8 });
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');
  await expect(preview).toHaveCount(4);
  expect(await preview.evaluateAll((elements) => elements.every((element) => (
    element.getAttribute('data-requested-expansion-side') === 'left'
      && element.getAttribute('data-expansion-side') === 'right'
      && element.getAttribute('data-auto-mirrored-at-edge') === 'true'
      && element.getAttribute('data-valid') === 'true'
  )))).toBe(true);
  await expect(page.locator('#placement-preview-world-overlays .network-action-preview-art'))
    .toHaveAttribute('data-auto-mirrored-at-edge', 'true');
  await expect(page.locator('#network-preview-label')).toContainText('right-hand traffic');
  await expect(page.locator('#network-preview-label')).toContainText('Auto-mirrored at map edge');

  await page.mouse.up();
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(state)).toEqual([tile(0, 0), tile(1, 0), tile(0, 1), tile(1, 1)]);
  await expect(page.locator('#ticker-copy')).toContainText('auto-mirrored right at map edge');

  await selectAvenue(page, 'left');
  const interiorStart = await projectedPoint(page, 10, 10);
  const interiorEnd = await projectedPoint(page, 11, 10);
  await page.mouse.move(interiorStart.x, interiorStart.y);
  await page.mouse.down();
  await page.mouse.move(interiorEnd.x, interiorEnd.y, { steps: 8 });
  const interior = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');
  await expect(interior).toHaveCount(4);
  expect(await interior.evaluateAll((elements) => elements.every((element) => (
    element.getAttribute('data-requested-expansion-side') === 'left'
      && element.getAttribute('data-expansion-side') === 'left'
      && element.getAttribute('data-auto-mirrored-at-edge') === null
  )))).toBe(true);
  await page.mouse.up();

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);

  await attachJson(testInfo, 'avenue-edge-mirror.json', {
    requestedSide: 'left',
    effectiveSide: 'right',
    edgeFootprint: [tile(0, 0), tile(1, 0), tile(0, 1), tile(1, 1)],
    interiorSide: 'left',
  });
  await maybeScreenshot(page, testInfo, 'avenue-edge-mirror.png');
});

test('does not mirror an off-map Avenue side around a blocked paired lane', async ({ page }) => {
  const cityId = `market-avenue-edge-blocked-${Date.now()}`;
  const state = createMarketCityState({
    cityId,
    cityName: 'Avenue Edge Blocked Lab',
    mayorName: 'Browser Mayor',
    seed: 67,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  state.map.zones[tile(0, 1)] = 'R';
  state.economy.density[tile(0, 1)] = 0.4;
  state.economy.wealth[tile(0, 1)] = 12_000;
  await seedV2City(page, state);
  await openCity(page, cityId);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());

  await selectAvenue(page, 'left');
  const edge = await projectedPoint(page, 0, 0);
  const edgeEnd = await projectedPoint(page, 1, 0);
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  await page.mouse.move(edgeEnd.x, edgeEnd.y, { steps: 8 });
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');
  await expect(preview).toHaveCount(2);
  await expect(preview.first()).toHaveAttribute('data-requested-expansion-side', 'left');
  await expect(preview.first()).toHaveAttribute('data-expansion-side', 'left');
  await expect(preview.first()).not.toHaveAttribute('data-auto-mirrored-at-edge', 'true');
  await expect(preview.first()).toHaveAttribute('data-valid', 'false');
  await expect(page.locator('#network-preview-label')).toContainText('outside the city map');

  await page.mouse.up();
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
});

test('rejects an obstructed Avenue atomically without changing the canonical snapshot', async ({ page }, testInfo) => {
  const cityId = `market-avenue-obstruction-${Date.now()}`;
  const state = createMarketCityState({
    cityId,
    cityName: 'Avenue Obstruction Lab',
    mayorName: 'Browser Mayor',
    seed: 67,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  state.map.zones[9 * 48 + 12] = 'R';
  state.economy.density[9 * 48 + 12] = 0.4;
  state.economy.wealth[9 * 48 + 12] = 12_000;
  await seedV2City(page, state);
  await openCity(page, cityId);
  const before = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());

  await selectAvenue(page, 'right');
  const start = await projectedPoint(page, 10, 10);
  const end = await projectedPoint(page, 15, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="network:avenue"]');
  await expect(preview).toHaveCount(12);
  await expect(page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:avenue"][data-valid="false"]',
  )).toHaveCount(12);
  await expect(page.locator('#network-preview-label')).toContainText(/Illegal route|conflict|obstruct/i);
  await page.mouse.up();

  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(before);
  expect(avenueTileIds(await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot()))).toEqual([]);
  await expect(page.locator('.terrain-avenue-world')).toHaveCount(0);
  await attachJson(testInfo, 'avenue-atomic-obstruction.json', {
    blocker: 9 * 48 + 12,
    previewTiles: 12,
    canonicalSnapshotUnchanged: true,
  });
  await maybeScreenshot(page, testInfo, 'avenue-atomic-obstruction.png');
});

test('draws Avenue bends, extensions, intersections, and ordinary-road joins with live topology', async ({ page }, testInfo) => {
  await openCity(page, `market-avenue-topology-${Date.now()}`);

  // Straight corridor and overlapping extension.
  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 5, y: 5 }, { x: 11, y: 5 }, {
    action: 'network:avenue', footprint: 14, valid: true,
  });
  const afterStraight = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(afterStraight)).toHaveLength(14);
  assertReciprocalAvenueMasks(afterStraight);

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 11, y: 5 }, { x: 16, y: 5 }, {
    action: 'network:avenue', valid: true,
  });
  const afterExtension = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(afterExtension).length).toBeGreaterThan(avenueTileIds(afterStraight).length);
  expect(afterExtension.map.avenueLanes[5 * 48 + 16]).toBe(true);
  expect(afterExtension.map.avenueLanes[4 * 48 + 16]).toBe(true);
  assertReciprocalAvenueMasks(afterExtension);

  // A diagonal endpoint gesture resolves to one deterministic right-angle
  // route; its paired carriageway includes the necessary outer-corner filler.
  await selectAvenue(page, 'left');
  await dragMapRoute(page, { x: 24, y: 5 }, { x: 30, y: 11 }, {
    action: 'network:avenue', valid: true,
  });
  const afterBend = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(avenueTileIds(afterBend).length).toBeGreaterThan(avenueTileIds(afterExtension).length + 10);
  expect(avenueTileIds(afterBend).some((tile) => (afterBend.map.avenuePairMasks[tile] ?? 0) === 0)).toBe(true);
  assertReciprocalAvenueMasks(afterBend);

  // A north/south pair stops at a horizontal pair, then extends through it to
  // turn the T into a four-way junction. Existing lane masks must merge.
  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 10, y: 20 }, { x: 20, y: 20 }, {
    action: 'network:avenue', footprint: 22, valid: true,
  });
  const beforeT = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 15, y: 15 }, { x: 15, y: 20 }, {
    action: 'network:avenue', valid: true,
  });
  const afterT = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const tJunctions = avenueTileIds(afterT).filter((tile) => {
    const mask = afterT.map.avenueTravelMasks[tile] ?? 0;
    return (mask & (mask - 1)) !== 0;
  });
  expect(tJunctions.length).toBeGreaterThan(0);
  const tMergeTiles = avenueTileIds(afterT).filter((tile) => (
    (afterT.map.avenueTravelMasks[tile] ?? 0) & (afterT.map.avenuePairMasks[tile] ?? 0)
  ));
  expect(tMergeTiles).toHaveLength(4);
  for (const merge of tMergeTiles) {
    const x = merge % 48;
    const y = Math.floor(merge / 48);
    const world = page.locator(
      `#terrain-construction-overlays .terrain-avenue-world[data-tile="${x},${y}"]`,
    );
    await expect(world.locator('.terrain-avenue-direction-marking')).toHaveCount(0);
    for (const [_bit, dx, dy, edge] of [[1, 0, -1, 'north'], [2, 1, 0, 'east'], [4, 0, 1, 'south'], [8, -1, 0, 'west']] as const) {
      if (!tMergeTiles.includes((y + dy) * 48 + x + dx)) continue;
      await expect(world.locator(`.terrain-avenue-median-edge[data-edge="${edge}"]`)).toHaveCount(0);
    }
  }
  for (const tile of avenueTileIds(beforeT)) {
    expect(afterT.map.avenueMedianMasks[tile]).toBe(beforeT.map.avenueMedianMasks[tile]);
  }
  // The old Avenue retains its durable median history, while the renderer
  // suppresses only its shared 2×2 junction seams.

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 15, y: 20 }, { x: 15, y: 26 }, {
    action: 'network:avenue', valid: true,
  });
  const afterFourWay = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const fourWayJunctions = avenueTileIds(afterFourWay).filter((tile) => {
    const mask = afterFourWay.map.avenueTravelMasks[tile] ?? 0;
    return (mask & (mask - 1)) !== 0;
  });
  expect(fourWayJunctions.length).toBeGreaterThanOrEqual(tJunctions.length);
  assertReciprocalAvenueMasks(afterFourWay);
  const sharedJunctionTiles = fourWayJunctions.filter((tile) => {
    const mask = afterFourWay.map.avenueTravelMasks[tile] ?? 0;
    return Boolean(mask & (1 | 4)) && Boolean(mask & (2 | 8));
  });
  expect(sharedJunctionTiles).toHaveLength(4);
  for (const junction of sharedJunctionTiles) {
    const x = junction % 48;
    const y = Math.floor(junction / 48);
    const markings = page.locator(
      `#terrain-construction-overlays .terrain-avenue-world[data-tile="${x},${y}"] .terrain-avenue-direction-marking`,
    );
    await expect(markings).toHaveCount(0);
    const world = page.locator(`#terrain-construction-overlays .terrain-avenue-world[data-tile="${x},${y}"]`);
    for (const [bit, dx, dy, edge] of [[1, 0, -1, 'north'], [2, 1, 0, 'east'], [4, 0, 1, 'south'], [8, -1, 0, 'west']] as const) {
      if (!sharedJunctionTiles.includes((y + dy) * 48 + x + dx)) continue;
      await expect(world.locator(`.terrain-avenue-median-edge[data-edge="${edge}"]`)).toHaveCount(0);
    }
  }

  // Adjacent Avenue asphalt never invents an ordinary-road edge. A player
  // who wants a real join drags through the shared Avenue tile instead.
  await selectRoad(page);
  await dragMapRoute(page, { x: 1, y: 5 }, { x: 4, y: 5 }, {
    action: 'road', footprint: 4, valid: true,
  });
  const joiningRoad = page.locator(
    '#terrain-construction-overlays .terrain-road-bed[data-x="4"][data-y="5"]',
  );
  await expect(joiningRoad).toHaveCount(1);
  expect(Number(await joiningRoad.getAttribute('data-connection-mask')) & 2).toBe(0);

  // A perpendicular ordinary road may share the same surface tile with an
  // Avenue. Both canonical layers remain true, but the junction stays plain
  // asphalt rather than acquiring a checkerboard/crossing overlay.
  await selectRoad(page);
  await dragMapRoute(page, { x: 8, y: 2 }, { x: 8, y: 8 }, {
    action: 'road', footprint: 7, valid: true,
  });
  const afterRoadCrossing = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(afterRoadCrossing.map.roads[4 * 48 + 8]).toBe(true);
  expect(afterRoadCrossing.map.avenueLanes[4 * 48 + 8]).toBe(true);
  expect(afterRoadCrossing.map.roads[5 * 48 + 8]).toBe(true);
  expect(afterRoadCrossing.map.avenueLanes[5 * 48 + 8]).toBe(true);
  await expect(page.locator(
    '#terrain-construction-overlays .terrain-avenue-world .terrain-avenue-road-crossing',
  )).toHaveCount(0);
  for (const roadSharedAvenueTile of [{ x: 8, y: 4 }, { x: 8, y: 5 }]) {
    const avenueWorld = page.locator(
      `#terrain-construction-overlays .terrain-avenue-world[data-tile="${roadSharedAvenueTile.x},${roadSharedAvenueTile.y}"]`,
    );
    await expect(avenueWorld).toHaveCount(0);
    await expect(page.locator(
      `#terrain-construction-overlays .terrain-road-primary-overlap .terrain-road-bed[data-x="${roadSharedAvenueTile.x}"][data-y="${roadSharedAvenueTile.y}"]`,
    )).toHaveCount(1);
    await expect(page.locator(
      `#terrain-construction-overlays .terrain-road-svg-details[data-x="${roadSharedAvenueTile.x}"][data-y="${roadSharedAvenueTile.y}"] .terrain-road-centre-line`,
    )).not.toHaveCount(0);
  }

  // Directly adjacent parallel road drags remain parallel strokes. Their
  // shared border is not silently promoted into a string of intersections.
  await selectRoad(page);
  await dragMapRoute(page, { x: 30, y: 30 }, { x: 36, y: 30 }, {
    action: 'road', footprint: 7, valid: true,
  });
  await selectRoad(page);
  await dragMapRoute(page, { x: 30, y: 31 }, { x: 36, y: 31 }, {
    action: 'road', footprint: 7, valid: true,
  });
  const afterParallelRoads = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  for (const y of [30, 31]) {
    for (const x of [31, 32, 33, 34, 35]) {
      expect(afterParallelRoads.map.roadConnectionMasks[y * 48 + x]).toBe(10);
      await expect(page.locator(
        `#terrain-construction-overlays .terrain-road-bed[data-x="${x}"][data-y="${y}"]`,
      )).toHaveAttribute('data-connection-mask', '10');
    }
  }

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 8, 5);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'road');
  await expect(page.locator('#route-query-title')).toHaveText('Avenue');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');

  // The neutral junction and clean road overlap are camera-invariant.
  for (let rotation = 0; rotation < 4; rotation += 1) {
    await expect(page.locator('.city-client')).toHaveAttribute('data-view-rotation', String(rotation));
    await expect(page.locator('#terrain-construction-overlays .terrain-avenue-road-crossing')).toHaveCount(0);
    for (const junction of sharedJunctionTiles) {
      const x = junction % 48;
      const y = Math.floor(junction / 48);
      await expect(page.locator(
        `#terrain-construction-overlays .terrain-avenue-world[data-tile="${x},${y}"] .terrain-avenue-direction-marking`,
      )).toHaveCount(0);
    }
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const canonicalBeforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonicalBeforeReload);
  await expect(page.locator('#terrain-construction-overlays .terrain-avenue-road-crossing')).toHaveCount(0);

  // Passenger rail now owns its own category and contracts below; opening it
  // here proves the Avenue inspector did not leave Transit in a broken state.
  await openPassengerRailCatalog(page);
  await expect(page.locator('button[data-catalog-kind="rail"][data-action="network:rail"]')).toBeVisible();
  await page.getByRole('button', { name: 'Close transit catalogue' }).click();

  await attachJson(testInfo, 'avenue-topology-matrix.json', {
    straightLaneTiles: avenueTileIds(afterStraight).length,
    extendedLaneTiles: avenueTileIds(afterExtension).length,
    bentLaneTiles: avenueTileIds(afterBend).length - avenueTileIds(afterExtension).length,
    tJunctionTiles: tJunctions,
    fourWayJunctionTiles: fourWayJunctions,
    sharedJunctionTiles,
    roadJoin: { x: 4, y: 5, connectionMask: Number(await joiningRoad.getAttribute('data-connection-mask')) },
    roadCrossingTiles: [4 * 48 + 8, 5 * 48 + 8],
    cleanJunctionRotations: [0, 1, 2, 3],
    canonicalReloadExact: true,
    passengerRailCategoryAvailable: true,
  });
  await maybeScreenshot(page, testInfo, 'avenue-bends-intersections-road-join.png');
});

test('uses Avenue as a road-service surface without adding Avenue congestion and charges per lane tile', async ({ page }, testInfo) => {
  const cityId = `market-avenue-service-${Date.now()}`;
  const state = createMarketCityState({
    cityId,
    cityName: 'Avenue Service Lab',
    mayorName: 'Browser Mayor',
    seed: 73,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  const zone = { x: 15, y: 17, tile: 17 * 48 + 15 } as const;
  state.map.zones[zone.tile] = 'R';
  state.economy.density[zone.tile] = 1;
  state.economy.wealth[zone.tile] = 10_000;
  // A turbine touching the station's south face. A station needs power as well
  // as a road now, and this one turns live only once the Avenue reaches it, so
  // the Avenue remains the single thing this test switches on.
  state.map.facilities.push({
    id: 'avenue-supply', kind: 'wind-turbine', anchor: 18 * 48 + 10, tiles: [18 * 48 + 10],
  });
  await seedV2City(page, state);
  await openCity(page, cityId);

  await selectFireStation(page);
  await previewAndClickMapCell(page, 10, 17, 'facility:fire-station', 1);
  await expect(page.locator('.tile[data-x="10"][data-y="17"]'))
    .toHaveAttribute('data-description', /fire station.*inactive/i);

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 10, y: 20 }, { x: 15, y: 20 }, {
    action: 'network:avenue', footprint: 12, valid: true,
  });
  const opening = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(opening.map.roads.every((road) => !road)).toBe(true);
  expect(avenueTileIds(opening)).toHaveLength(12);
  await expect(page.locator('.tile[data-x="10"][data-y="17"]'))
    .toHaveAttribute('data-description', /fire station.*operational.*road served.*power served.*water not required/i);

  const afterMonth = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(afterMonth.environment.roadAccess[zone.tile]).toBe(true);
  expect(afterMonth.environment.congestion.every((value) => value === 0)).toBe(true);
  expect(afterMonth.economy.lastOperatingExpense).toBe(120_000 + 12 * 1_293 + 25_860);
  await expect(page.locator('#metric-expenses')).toHaveText('$161,376');

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, zone.x, zone.y);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'building');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await clickMapCell(page, 10, 17);
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'surface-facility');
  await expect(page.locator('#route-query-title')).toHaveText('Fire Station');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');

  await attachJson(testInfo, 'avenue-service-and-economy.json', {
    avenueLaneTiles: 12,
    monthlyMaintenance: 12 * 1_293,
    fireStationMonthlyMaintenance: 120_000,
    totalOperatingExpense: afterMonth.economy.lastOperatingExpense,
    zoneRoadAccess: afterMonth.environment.roadAccess[zone.tile],
    avenueOnlyCongestion: Math.max(...afterMonth.environment.congestion),
  });
  await maybeScreenshot(page, testInfo, 'avenue-road-service-fire-zone.png');
});

test('undoes one full Avenue transaction, bulldozes one lane safely, and reloads exact state', async ({ page }, testInfo) => {
  await openCity(page, `market-avenue-edits-${Date.now()}`);
  const beforePlacement = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 10, y: 34 }, { x: 15, y: 34 }, {
    action: 'network:avenue', footprint: 12, valid: true,
  });
  expect(avenueTileIds(await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot()))).toHaveLength(12);
  await expect(page.locator('#simulation-undo')).toBeEnabled();
  await page.locator('#simulation-undo').click();
  await expect.poll(() => page.evaluate(() => (
    (window.marketCityDashboard as Dashboard).canonicalSnapshot()
  ))).toBe(beforePlacement);
  await expect(page.locator('.terrain-avenue-world')).toHaveCount(0);

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 10, y: 34 }, { x: 15, y: 34 }, {
    action: 'network:avenue', footprint: 12, valid: true,
  });
  const removedTile = 34 * 48 + 12;
  const pairedTile = 33 * 48 + 12;
  const beforeBulldoze = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(beforeBulldoze.map.avenuePairMasks[removedTile]).toBe(1);
  expect(beforeBulldoze.map.avenuePairMasks[pairedTile]).toBe(4);

  await selectBulldoze(page);
  await moveToMapCell(page, 12, 34);
  await expect(page.locator('#bulldoze-preview-outline .bulldoze-preview-outline.valid')).not.toHaveCount(0);
  await clickMapCell(page, 12, 34);
  const afterBulldoze = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(afterBulldoze.map.avenueLanes[removedTile]).toBe(false);
  expect(afterBulldoze.map.avenueTravelMasks[removedTile]).toBe(0);
  expect(afterBulldoze.map.avenuePairMasks[removedTile]).toBe(0);
  expect(afterBulldoze.map.avenueLanes[pairedTile]).toBe(true);
  expect(afterBulldoze.map.avenuePairMasks[pairedTile] ?? 0).toBe(0);
  for (const tile of avenueTileIds(afterBulldoze)) {
    for (const bit of [1, 2, 4, 8] as const) {
      if (((afterBulldoze.map.avenueTravelMasks[tile] ?? 0) & bit) === 0) continue;
      expect(neighborForMaskBit(tile, bit)).not.toBe(removedTile);
    }
  }
  await expect(page.locator('#terrain-construction-overlays .terrain-avenue-world[data-tile="12,34"]')).toHaveCount(0);
  await expect(page.locator('#terrain-construction-overlays .terrain-avenue-world[data-tile="12,33"]'))
    .toHaveAttribute('data-pair-mask', '0');

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);
  const reloaded = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(reloaded.map.avenueLanes[removedTile]).toBe(false);
  expect(reloaded.map.avenueLanes[pairedTile]).toBe(true);
  expect(reloaded.map.avenuePairMasks[pairedTile]).toBe(0);
  await expect(page.locator('.terrain-avenue-world')).toHaveCount(11);

  await attachJson(testInfo, 'avenue-undo-bulldoze-reload.json', {
    atomicPlacementUndo: true,
    removedTile,
    pairedTile,
    laneTilesAfterBulldoze: avenueTileIds(reloaded),
    canonicalReloadExact: true,
  });
  await maybeScreenshot(page, testInfo, 'avenue-bulldoze-reload.png');
});

test('offers truthful Rail and Train Station cards, previews, placement, and four rotations', async ({ page }, testInfo) => {
  await openCity(page, `market-rail-catalog-${Date.now()}`);

  await openPassengerRailCatalog(page);
  let railCard = page.locator('button[data-catalog-kind="rail"][data-action="network:rail"]');
  let stationCard = page.locator('button[data-catalog-kind="train-station"][data-action="facility:train-station"]');
  await expect(railCard).toHaveAccessibleName('Rail');
  await expect(railCard).toContainText('1 × 1 tiles');
  await expect(railCard).toContainText(/free construction|\$0.*month/i);
  const railCardWorld = railCard.locator(
    '[data-network-kind="rail"][data-world-recipe-id="network:rail:v5"]',
  );
  await expect(railCardWorld).toHaveAttribute('data-world-geometry-fingerprint', 'network-rail-geometry-v5');
  await expect(railCardWorld.locator('.terrain-rail-ballast')).toHaveCount(1);
  await expect(railCardWorld.locator('.terrain-rail-track')).toHaveCount(2);
  await expect(railCardWorld.locator('.terrain-rail-sleeper')).not.toHaveCount(0);
  await expect(railCardWorld.locator('.terrain-rail-track').first()).toHaveAttribute('stroke', '#15171a');
  await expect(railCardWorld.locator('.terrain-rail-sleeper').first()).toHaveAttribute('stroke', '#80502f');

  await expect(stationCard).toHaveAccessibleName('Train Station');
  await expect(stationCard).toContainText('2 × 2 tiles');
  await expect(stationCard).toContainText(/free construction|\$0.*month/i);
  const stationCardWorld = stationCard.locator(
    '.facility-train-station[data-world-recipe-id="facility:train-station:v2"]',
  );
  await expect(stationCardWorld).toHaveAttribute(
    'data-world-geometry-fingerprint',
    'facility-train-station-geometry-v2',
  );
  await expect(stationCardWorld.locator('.terrain-facility-platform')).not.toHaveCount(0);
  await expect(stationCardWorld.locator('.terrain-facility-station-hall')).not.toHaveCount(0);
  await expect(stationCardWorld.locator('.terrain-facility-station-canopy')).not.toHaveCount(0);

  await railCard.click();
  await focusRailEvidence(page);
  const start = await projectedPoint(page, 10, 10);
  const end = await projectedPoint(page, 15, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const preview = page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-route-role="selected"]',
  );
  await expect(preview).toHaveCount(6);
  await expect(page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-valid="true"]',
  )).toHaveCount(6);
  const previewWorld = page.locator(
    '#placement-preview-world-overlays [data-network-kind="rail"][data-world-recipe-id="network:rail:v5"]',
  ).first();
  await expect(previewWorld).toHaveAttribute('data-world-geometry-fingerprint', 'network-rail-geometry-v5');
  await expect(previewWorld.locator('.terrain-rail-ballast')).not.toHaveCount(0);
  await expect(previewWorld.locator('.terrain-rail-track')).not.toHaveCount(0);
  await expect(previewWorld.locator('.terrain-rail-sleeper')).not.toHaveCount(0);
  await expect(previewWorld.locator('.terrain-rail-ballast')).toHaveAttribute('stroke', '#cbc7bd');
  expect(await previewWorld.locator('.terrain-rail-ballast, .terrain-rail-track, .terrain-rail-track-highlight')
    .evaluateAll((parts) => parts.every((part) => part.getAttribute('stroke-linecap') === 'butt'))).toBe(true);
  const heldRailGeometry = await railGeometryFingerprint(page, '#placement-preview-world-overlays');
  await maybeScreenshot(page, testInfo, 'rail-seam-held.png');
  await page.mouse.up();
  const committedRailGeometry = await railGeometryFingerprint(page, '#terrain-construction-overlays');
  expect(committedRailGeometry).toEqual(heldRailGeometry);
  await maybeScreenshot(page, testInfo, 'rail-seam-released.png');

  await selectTrainStation(page);
  await moveToMapCell(page, 10, 11);
  await expect(page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="facility:train-station"][data-valid="true"]',
  )).toHaveCount(4);
  await clickMapCell(page, 10, 11);

  const rails = page.locator(
    '#terrain-construction-overlays .terrain-rail-world[data-tile][data-connection-mask][data-network-topology]',
  );
  const station = page.locator(
    '#terrain-construction-overlays .terrain-facility-world[data-facility-kind="train-station"]',
  );
  await expect(rails).toHaveCount(6);
  await expect(station).toHaveCount(1);
  await expect(station).toHaveAttribute('data-station-status', /.+/);
  await expect(station).toHaveAttribute('data-station-ridership', '0');
  await expect(station).toHaveAttribute('data-world-recipe-id', 'facility:train-station:v2');
  await expect(station).toHaveAttribute('data-world-geometry-fingerprint', 'facility-train-station-geometry-v2');

  for (let rotation = 0; rotation < 4; rotation += 1) {
    await expect(page.locator('.city-client')).toHaveAttribute('data-view-rotation', String(rotation));
    await openPassengerRailCatalog(page);
    railCard = page.locator('button[data-catalog-kind="rail"][data-action="network:rail"]');
    stationCard = page.locator('button[data-catalog-kind="train-station"][data-action="facility:train-station"]');
    await expect(railCard.locator('.utility-catalog-preview-svg')).toHaveAttribute('data-preview-rotation', String(rotation));
    await expect(stationCard.locator('.utility-catalog-preview-svg')).toHaveAttribute('data-preview-rotation', String(rotation));
    await expect(railCard.locator('.catalog-thumbnail-network-rail'))
      .toHaveAttribute('data-world-geometry-fingerprint', 'network-rail-geometry-v5');
    await expect(stationCard.locator('.facility-train-station'))
      .toHaveAttribute('data-world-geometry-fingerprint', 'facility-train-station-geometry-v2');
    await page.getByRole('button', { name: 'Close transit catalogue' }).click();
    await expect(rails).toHaveCount(6);
    await expect(rails.locator('.terrain-rail-ballast')).not.toHaveCount(0);
    await expect(rails.locator('.terrain-rail-track')).not.toHaveCount(0);
    await expect(rails.locator('.terrain-rail-sleeper')).not.toHaveCount(0);
    await maybeScreenshot(page, testInfo, `rail-card-preview-world-rotation-${rotation}.png`);
    await expect(station).toBeVisible();
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await attachJson(testInfo, 'rail-visible-card-preview-rotations.json', {
    railRecipe: 'network:rail:v5',
    stationRecipe: 'facility:train-station:v2',
    railTiles: 6,
    stationFootprint: [2, 2],
    rotations: [0, 1, 2, 3],
  });
  await maybeScreenshot(page, testInfo, 'rail-card-preview-world-four-rotations.png');
});

test('draws Rail bends, extensions, junctions, crossings, and atomic rejections through visible routes', async ({ page }, testInfo) => {
  await openCity(page, `market-rail-topology-${Date.now()}`);

  await selectRail(page);
  await dragMapRoute(page, { x: 5, y: 5 }, { x: 11, y: 5 }, {
    action: 'network:rail', footprint: 7, valid: true,
  });
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(railTileIds(state)).toHaveLength(7);
  assertReciprocalRailMasks(state);
  await maybeScreenshot(page, testInfo, 'rail-straight.png');

  await selectRail(page);
  await dragMapRoute(page, { x: 11, y: 5 }, { x: 16, y: 5 }, {
    action: 'network:rail', valid: true,
  });
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(railTileIds(state)).toHaveLength(12);
  expect(state.map.rails[5 * 48 + 16]).toBe(true);

  await selectRail(page);
  await dragMapRoute(page, { x: 24, y: 5 }, { x: 30, y: 11 }, {
    action: 'network:rail', footprint: 13, valid: true,
  });
  const corner = page.locator('.terrain-rail-world[data-network-topology="corner"]').first();
  await expect(corner).toHaveCount(1);
  await expect(corner.locator('.terrain-rail-curve')).toHaveCount(3);
  await expect(corner.locator('.terrain-network-node-rail')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'rail-gentle-bend.png');

  await selectRail(page);
  await dragMapRoute(page, { x: 10, y: 20 }, { x: 20, y: 20 }, {
    action: 'network:rail', footprint: 11, valid: true,
  });
  await selectRail(page);
  await dragMapRoute(page, { x: 15, y: 15 }, { x: 15, y: 20 }, {
    action: 'network:rail', valid: true,
  });
  const tee = page.locator('.terrain-rail-world[data-network-topology="tee"]').first();
  await expect(tee).toHaveCount(1);
  await expect(tee.locator('.terrain-rail-frog')).toHaveCount(1);
  await expect(tee.locator('.terrain-network-node-rail')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'rail-tee-turnout.png');
  await selectRail(page);
  await dragMapRoute(page, { x: 15, y: 20 }, { x: 15, y: 26 }, {
    action: 'network:rail', valid: true,
  });
  const cross = page.locator('.terrain-rail-world[data-network-topology="cross"]').first();
  await expect(cross).toHaveCount(1);
  await expect(cross.locator('.terrain-rail-frog')).toHaveCount(1);
  await expect(cross.locator('.terrain-network-node-rail')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'rail-crossing-core.png');

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 5, y: 30 }, { x: 11, y: 30 }, {
    action: 'network:avenue', footprint: 14, valid: true,
  });
  await selectRoad(page);
  await dragMapRoute(page, { x: 5, y: 30 }, { x: 11, y: 30 }, {
    action: 'road', footprint: 7, valid: true,
  });
  await selectRail(page);
  await dragMapRoute(page, { x: 8, y: 27 }, { x: 8, y: 34 }, {
    action: 'network:rail', footprint: 8, valid: true,
  });

  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const sharedCrossing = 30 * 48 + 8;
  const avenueCrossing = 29 * 48 + 8;
  expect(state.map.rails[sharedCrossing]).toBe(true);
  expect(state.map.roads[sharedCrossing]).toBe(true);
  expect(state.map.avenueLanes[sharedCrossing]).toBe(true);
  expect(state.map.rails[avenueCrossing]).toBe(true);
  expect(state.map.avenueLanes[avenueCrossing]).toBe(true);
  assertReciprocalRailMasks(state);
  await expect(page.locator(
    '.terrain-rail-world[data-tile="8,30"] .terrain-rail-grade-crossing[data-crossing-with="road,avenue"][data-crossing-mask]',
  )).toHaveCount(1);
  await expect(page.locator(
    '.terrain-rail-world[data-tile="8,29"] .terrain-rail-grade-crossing[data-crossing-with="avenue"][data-crossing-mask]',
  )).toHaveCount(1);
  await expect(page.locator('.terrain-rail-world[data-tile="8,30"] .terrain-rail-track')).toHaveCount(2);
  await expect(page.locator('.terrain-rail-world[data-tile="8,29"] .terrain-rail-track')).toHaveCount(2);
  await maybeScreenshot(page, testInfo, 'rail-road-and-avenue-grade-crossings.png');

  await selectPowerItem(page, 'power-line');
  await clickMapCell(page, 40, 40);
  await selectRail(page);
  const powerCrossingStart = await projectedPoint(page, 38, 40);
  const powerCrossingEnd = await projectedPoint(page, 42, 40);
  await page.mouse.move(powerCrossingStart.x, powerCrossingStart.y);
  await page.mouse.down();
  await page.mouse.move(powerCrossingEnd.x, powerCrossingEnd.y, { steps: 8 });
  const powerRailPreview = page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-route-role="selected"]',
  );
  await expect(powerRailPreview).toHaveCount(5);
  await expect(page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-valid="true"]',
  )).toHaveCount(5);
  await page.mouse.up();
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const powerRailCrossing = 40 * 48 + 40;
  expect(state.map.rails[powerRailCrossing]).toBe(true);
  expect(state.map.powerLines[powerRailCrossing]).toBe(true);
  await expect(page.locator('.tile[data-x="40"][data-y="40"]'))
    .toHaveAttribute('data-network-kinds', /rail,power-line|power-line,rail/);
  await maybeScreenshot(page, testInfo, 'rail-power-overpass.png');

  await selectTrainStation(page);
  await clickMapCell(page, 40, 38);
  const beforeRejectedRoute = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await selectRail(page);
  const rejectedStart = await projectedPoint(page, 38, 38);
  const rejectedEnd = await projectedPoint(page, 42, 38);
  await page.mouse.move(rejectedStart.x, rejectedStart.y);
  await page.mouse.down();
  await page.mouse.move(rejectedEnd.x, rejectedEnd.y, { steps: 8 });
  const rejected = page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-route-role="selected"]',
  );
  await expect(rejected).toHaveCount(5);
  await expect(page.locator(
    '#city-action-preview-overlays .city-action-preview[data-action="network:rail"][data-valid="false"]',
  )).toHaveCount(5);
  await expect(page.locator('#network-preview-label')).toContainText(/Illegal route|conflict|obstruct/i);
  await page.mouse.up();
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot()))
    .toBe(beforeRejectedRoute);

  await attachJson(testInfo, 'rail-topology-crossing-matrix.json', {
    railTiles: railTileIds(state),
    topologies: ['straight', 'corner', 'tee', 'cross'],
    railArt: {
      ballast: 'wide-muted-gravel',
      rails: 'two-near-black',
      ties: 'world-aligned-warm-brown',
      corner: 'paired-gentle-curves',
      junction: 'frog-no-generic-node',
    },
    crossings: [
      { tile: sharedCrossing, with: 'road,avenue' },
      { tile: avenueCrossing, with: 'avenue' },
      { tile: powerRailCrossing, with: 'power-line' },
    ],
    railPowerCrossingAccepted: true,
    facilityObstructionRejected: true,
  });
  await maybeScreenshot(page, testInfo, 'rail-bends-junctions-grade-crossings.png');
});

test('keeps a Train Station inactive until shared road, Rail, allocated power, and water all succeed', async ({ page }, testInfo) => {
  await openCity(page, `market-rail-station-gates-${Date.now()}`);
  await selectTrainStation(page);
  await previewAndClickMapCell(page, 20, 20, 'facility:train-station', 4);

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  const inspector = page.locator('#route-query-panel');
  await expect(inspector).toHaveAttribute('data-inspector-target-kind', 'surface-facility');
  await expect(page.locator('#route-query-title')).toHaveText('Train Station');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✕');

  await selectRail(page);
  await clickMapCell(page, 20, 22);
  await expect(page.locator('.terrain-rail-world[data-tile="20,22"][data-network-topology="isolated"]'))
    .toHaveCount(1);
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  await expect(inspector).toHaveAttribute('data-inspector-target-kind', 'surface-facility');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✕');

  await selectAvenue(page, 'right');
  await dragMapRoute(page, { x: 18, y: 18 }, { x: 23, y: 18 }, {
    action: 'network:avenue', footprint: 12, valid: true,
  });
  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const station = state.map.facilities.find(({ kind }) => kind === 'train-station');
  expect(station).toBeDefined();
  const stationPowerWarning = page.locator(`[data-warning-area="power:facility:${station!.id}"]`);
  const stationWaterWarning = page.locator(`[data-warning-area="water:facility:${station!.id}"]`);
  expect(state.map.roads.every((road) => !road)).toBe(true);
  expect(station!.tiles.every((tile) => state.environment.powered[tile] === false)).toBe(true);
  expect(station!.tiles.every((tile) => state.environment.watered[tile] === false)).toBe(true);
  expect(state.map.waterPipes.every((pipe) => !pipe)).toBe(true);
  const world = page.locator(
    '.terrain-facility-world[data-facility-kind="train-station"][data-station-status="inactive"]',
  );
  await expect(world).toHaveCount(1);
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  await expect(inspector).toHaveAttribute('data-inspector-target-kind', 'surface-facility');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="rail"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✕');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✕');
  await expect(inspector).toContainText('Station inactive');
  await expect(inspector).toContainText('No allocated power capacity.');
  await expect(inspector).toContainText('No allocated water service.');
  await expect(world).toHaveAttribute('data-station-power-access', 'offline');
  await expect(world).toHaveAttribute('data-station-water-access', 'offline');
  await expect(stationPowerWarning).toHaveCount(1);
  await expect(stationWaterWarning).toHaveCount(1);
  await expect(stationPowerWarning).toHaveAttribute('data-warning-count', '4');
  await expect(stationWaterWarning).toHaveAttribute('data-warning-count', '4');
  await maybeScreenshot(page, testInfo, 'train-station-inactive-no-power-or-water.png');

  // The wind is physically legal and road-served, but the station remains dry
  // until a source-fed Water component reaches its footprint.
  await selectRoad(page);
  await previewAndClickMapCell(page, 17, 20, 'road', 1);
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 18, 20, 'facility:wind-turbine', 1);
  await selectPowerItem(page, 'power-line');
  await clickMapCell(page, 19, 20);
  await expect(world).toHaveAttribute('data-station-power-access', 'served');
  await expect(world).toHaveAttribute('data-station-water-access', 'offline');
  await expect(stationPowerWarning).toHaveCount(0);
  await expect(stationWaterWarning).toHaveCount(1);
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="rail"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✕');
  await expect(inspector).toContainText('Station inactive');
  await expect(inspector).toContainText('No allocated water service.');
  await maybeScreenshot(page, testInfo, 'train-station-inactive-no-water.png');

  await selectWaterItem(page, 'network:water-pipe');
  await previewAndClickMapCell(page, 17, 20, 'network:water-pipe', 1);
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 15, 19, 'facility:water-tower', 4);
  const hydratedState = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const hydratedStation = hydratedState.map.facilities.find(({ kind }) => kind === 'train-station')!;
  const hydratedWater = deriveWaterService(hydratedState, derivePower(hydratedState));
  expect(hydratedState.map.roads[tile(17, 20)]).toBe(true);
  expect(hydratedState.map.waterPipes[tile(17, 20)]).toBe(true);
  expect(hydratedWater.facilities.find(({ kind }) => kind === 'water-tower')).toMatchObject({
    roadAccess: true, powerAccess: true, pipeAccess: true, operational: true,
  });
  expect(hydratedStation.tiles.every((tile) => hydratedState.environment.powered[tile])).toBe(true);
  expect(hydratedStation.tiles.every((tile) => hydratedState.environment.watered[tile])).toBe(true);
  const operationalWorld = page.locator(
    '.terrain-facility-world[data-facility-kind="train-station"][data-station-status="operational"]',
  );
  await expect(operationalWorld).toHaveCount(1);
  await expect(operationalWorld).toHaveAttribute('data-station-power-access', 'served');
  await expect(operationalWorld).toHaveAttribute('data-station-water-access', 'served');
  await expect(stationPowerWarning).toHaveCount(0);
  await expect(stationWaterWarning).toHaveCount(0);
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✓');
  await expect(inspector).toContainText('Station operational');
  await selectBulldoze(page);
  await clickMapCell(page, 15, 19);
  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 20, 20);
  await expect(inspector).toHaveAttribute('data-inspector-target-kind', 'surface-facility');
  await expect(page.locator('[data-inspector-connector="road"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="rail"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');
  await expect(page.locator('[data-inspector-connector="water"] .inspector-connector-status')).toHaveText('✕');
  await expect(inspector).toContainText('Station inactive');
  await expect(inspector).toContainText('No allocated water service.');
  await expect(stationWaterWarning).toHaveCount(1);
  await maybeScreenshot(page, testInfo, 'train-station-utility-loss.png');

  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 15, 19, 'facility:water-tower', 4);
  await expect(operationalWorld).toHaveCount(1);
  await page.reload({ waitUntil: 'networkidle' });
  await expect(operationalWorld).toHaveCount(1);

  for (let rotation = 0; rotation < 4; rotation += 1) {
    await expect(page.locator('.city-client')).toHaveAttribute('data-view-rotation', String(rotation));
    await expect(operationalWorld).toHaveAttribute('data-station-power-access', 'served');
    await expect(operationalWorld).toHaveAttribute('data-station-water-access', 'served');
    await maybeScreenshot(page, testInfo, `train-station-operational-rotation-${rotation}.png`);
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }

  await attachJson(testInfo, 'rail-station-service-gates.json', {
    singletonRailActivatesConnection: true,
    roadSurface: 'avenue',
    powerRequired: true,
    waterRequired: true,
    powerLoad: 20,
    waterDemand: 50,
    utilityLossStopsStation: true,
    restoredServiceAfterReload: true,
  });
  await maybeScreenshot(page, testInfo, 'train-station-operational-restored.png');
});

test('selects two deterministic three-station MST legs with exact radius-six ridership', async ({ page }, testInfo) => {
  const cityId = `market-rail-ridership-${Date.now()}`;
  const fixture = railServiceFixture(cityId, [7, 22, 36], true);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);
  await buildThreeStationRail(page, fixture.stations, 4, 42);

  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const facilities = Object.fromEntries(fixture.stations.map((site) => [
    site.name,
    state.map.facilities.find(({ kind, anchor }) => kind === 'train-station' && anchor === site.anchor)!,
  ])) as Record<'A' | 'B' | 'C', MarketCityStateV2['map']['facilities'][number]>;
  expect(Object.values(facilities).every(Boolean)).toBe(true);
  expect(state.services.rail.totalRidership).toBe(140);
  expect([...state.services.rail.stationUsage].sort((left, right) => left.stationId.localeCompare(right.stationId)))
    .toEqual([
      { stationId: facilities.A.id, ridership: 50 },
      { stationId: facilities.B.id, ridership: 140 },
      { stationId: facilities.C.id, ridership: 90 },
    ].sort((left, right) => left.stationId.localeCompare(right.stationId)));

  const animation = await railAnimationSnapshot(page);
  expect(animation.animationState).toBe('paused');
  expect(animation.shuttles).toHaveLength(2);
  const expectedRidership = new Map([
    [stationPair(facilities.A.id, facilities.B.id), 50],
    [stationPair(facilities.B.id, facilities.C.id), 90],
  ]);
  expect(animation.shuttles.map(({ stationAId, stationBId }) => stationPair(stationAId, stationBId)).sort())
    .toEqual([...expectedRidership.keys()].sort());
  for (const shuttle of animation.shuttles) {
    expect(shuttle.ridership).toBe(expectedRidership.get(stationPair(shuttle.stationAId, shuttle.stationBId)));
    expectRailPath(state, shuttle.pathTileIds);
  }

  const expectedTileUsage = Array<number>(48 * 48).fill(0);
  for (const shuttle of animation.shuttles) {
    for (const tile of shuttle.pathTileIds) {
      expectedTileUsage[tile] = (expectedTileUsage[tile] ?? 0) + shuttle.ridership;
    }
  }
  for (const tile of railTileIds(state)) expect(state.services.rail.tileUsage[tile]).toBe(expectedTileUsage[tile]);

  const shuttleDom = await page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]').evaluateAll((elements) => (
    elements.map((element) => ({
      legId: element.getAttribute('data-leg-id'),
      componentId: element.getAttribute('data-component-id'),
      stationAId: element.getAttribute('data-station-a-id'),
      stationBId: element.getAttribute('data-station-b-id'),
      pathTileIds: (element.getAttribute('data-path-tile-ids') ?? '').split(',').filter(Boolean).map(Number),
      pathIndex: Number(element.getAttribute('data-path-index')),
      progress: Number(element.getAttribute('data-progress')),
      direction: element.getAttribute('data-direction'),
      paused: element.getAttribute('data-paused') === 'true',
      ridership: Number(element.getAttribute('data-ridership')),
    }))
  ));
  expect(shuttleDom).toEqual(animation.shuttles);

  const canonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  expect(canonical).not.toContain('trainAnimation');
  expect(canonical).not.toContain('shuttleLegs');
  expect(canonical).not.toContain('pathIndex');
  expect(canonical).not.toContain('"progress"');
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const persisted = await readPersistedV2City(page, cityId);
  expect(persisted.services.rail).toEqual(state.services.rail);
  expect(JSON.stringify(persisted)).not.toContain('shuttleLegs');

  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(canonical);
  const rederived = await railAnimationSnapshot(page);
  expect(rederived.shuttles.map(({ legId, stationAId, stationBId, pathTileIds, ridership }) => ({
    legId, stationAId, stationBId, pathTileIds, ridership,
  }))).toEqual(animation.shuttles.map(({ legId, stationAId, stationBId, pathTileIds, ridership }) => ({
    legId, stationAId, stationBId, pathTileIds, ridership,
  })));

  await attachJson(testInfo, 'rail-mst-ridership-reload.json', {
    totalRidership: state.services.rail.totalRidership,
    stationUsage: state.services.rail.stationUsage,
    shuttleLegs: animation.shuttles,
    radiusSixIncluded: true,
    radiusSevenExcluded: true,
    canonicalAnimationAbsent: true,
    rederivedAfterReload: true,
  });
  await maybeScreenshot(page, testInfo, 'rail-three-station-mst-ridership.png');
});

test('moves, reverses, pauses, severs, and reconnects deterministic Rail shuttles', async ({ page }, testInfo) => {
  const cityId = `market-rail-animation-${Date.now()}`;
  const fixture = railServiceFixture(cityId, [8, 16, 24]);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);
  await buildThreeStationRail(page, fixture.stations, 6, 27);

  const openingState = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const opening = await railAnimationSnapshot(page);
  expect(opening).toMatchObject({ animationState: 'paused' });
  expect(opening.shuttles).toHaveLength(2);
  for (const shuttle of opening.shuttles) expectRailPath(openingState, shuttle.pathTileIds);
  const openingLegs = opening.shuttles.map(({ legId, stationAId, stationBId, pathTileIds }) => ({
    legId, pair: stationPair(stationAId, stationBId), pathTileIds,
  })).sort((left, right) => left.legId.localeCompare(right.legId));

  await page.locator('#simulation-speed').click();
  await expect(page.locator('#simulation-speed')).toHaveAttribute('data-speed', '1');
  await expect(page.locator('#rail-shuttle-overlays')).toHaveAttribute('data-animation-state', 'running');
  const runningOpening = await railAnimationSnapshot(page);
  expect(runningOpening.shuttles.every(({ paused }) => !paused)).toBe(true);
  await expect.poll(async () => {
    const current = await railAnimationSnapshot(page);
    return current.shuttles.some((shuttle, index) => (
      shuttle.pathIndex !== runningOpening.shuttles[index]?.pathIndex
      || Math.abs(shuttle.progress - (runningOpening.shuttles[index]?.progress ?? 0)) > 0.001
    ));
  }, { timeout: 10_000 }).toBe(true);

  const firstLeg = runningOpening.shuttles[0]!;
  await expect.poll(async () => (
    (await railAnimationSnapshot(page)).shuttles.find(({ legId }) => legId === firstLeg.legId)?.direction
  ), { timeout: 30_000 }).not.toBe(firstLeg.direction);

  await pauseSimulationVisibly(page);
  const paused = await railAnimationSnapshot(page);
  expect(paused.shuttles.every(({ paused: shuttlePaused }) => shuttlePaused)).toBe(true);
  await page.waitForTimeout(500);
  expect(await railAnimationSnapshot(page)).toEqual(paused);

  // Service eligibility is a live gate: removing the only source-fed Water
  // facility removes every shuttle without touching the Rail graph, and putting
  // it back restores the same deterministic legs.
  await selectBulldoze(page);
  await clickMapCell(page, 4, 12);
  await expect(page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]')).toHaveCount(0);
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 4, 12, 'facility:water-tower', 4);
  await expect(page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]')).toHaveCount(2);

  const removed = { x: 21, y: 19, tile: 19 * 48 + 21 } as const;
  await selectBulldoze(page);
  await moveToMapCell(page, removed.x, removed.y);
  await expect(page.locator('#bulldoze-preview-outline .bulldoze-preview-outline.valid')).not.toHaveCount(0);
  await clickMapCell(page, removed.x, removed.y);
  const severedState = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(severedState.map.rails[removed.tile]).toBe(false);
  await expect(page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]')).toHaveCount(1);
  const severed = await railAnimationSnapshot(page);
  expect(severed.shuttles).toHaveLength(1);

  await selectRail(page);
  // Reconnect as a visible three-cell extension with existing rail endpoints;
  // a singleton Rail gesture is intentionally an isolated tile, not an
  // implicit connection to every cardinal neighbor.
  await dragMapRoute(page, { x: removed.x - 1, y: removed.y }, { x: removed.x + 1, y: removed.y }, {
    action: 'network:rail', footprint: 3, valid: true,
  });
  await expect(page.locator('#rail-shuttle-overlays .market-train-shuttle[data-leg-id]')).toHaveCount(2);
  const reconnected = await railAnimationSnapshot(page);
  const reconnectedLegs = reconnected.shuttles.map(({ legId, stationAId, stationBId, pathTileIds }) => ({
    legId, pair: stationPair(stationAId, stationBId), pathTileIds,
  })).sort((left, right) => left.legId.localeCompare(right.legId));
  expect(reconnectedLegs).toEqual(openingLegs);
  const reconnectedState = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(reconnectedState.map.rails[removed.tile]).toBe(true);
  assertReciprocalRailMasks(reconnectedState);

  await attachJson(testInfo, 'rail-animation-sever-reconnect.json', {
    openingLegs,
    moved: true,
    reversed: true,
    pausedPoseStable: true,
    severedLegCount: severed.shuttles.length,
    reconnectedLegs,
  });
  await maybeScreenshot(page, testInfo, 'rail-shuttles-reconnected.png');
});

test('undoes one Rail route, bulldozes reciprocal topology, and reloads exact canonical state', async ({ page }, testInfo) => {
  await openCity(page, `market-rail-edits-${Date.now()}`);
  const beforePlacement = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());

  await selectRail(page);
  await dragMapRoute(page, { x: 10, y: 34 }, { x: 15, y: 34 }, {
    action: 'network:rail', footprint: 6, valid: true,
  });
  await expect(page.locator('.terrain-rail-world')).toHaveCount(6);
  await expect(page.locator('#simulation-undo')).toBeEnabled();
  await page.locator('#simulation-undo').click();
  await expect.poll(() => page.evaluate(() => (
    (window.marketCityDashboard as Dashboard).canonicalSnapshot()
  ))).toBe(beforePlacement);
  await expect(page.locator('.terrain-rail-world')).toHaveCount(0);

  await selectRail(page);
  await dragMapRoute(page, { x: 10, y: 34 }, { x: 15, y: 34 }, {
    action: 'network:rail', footprint: 6, valid: true,
  });
  const removed = 34 * 48 + 12;
  const west = removed - 1;
  const east = removed + 1;
  await selectBulldoze(page);
  await moveToMapCell(page, 12, 34);
  await expect(page.locator('#bulldoze-preview-outline .bulldoze-preview-outline.valid')).not.toHaveCount(0);
  await clickMapCell(page, 12, 34);
  const bulldozed = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(bulldozed.map.rails[removed]).toBe(false);
  expect(bulldozed.map.railConnectionMasks[removed]).toBe(0);
  expect((bulldozed.map.railConnectionMasks[west] ?? 0) & 2).toBe(0);
  expect((bulldozed.map.railConnectionMasks[east] ?? 0) & 8).toBe(0);
  assertReciprocalRailMasks(bulldozed);
  await expect(page.locator('.terrain-rail-world[data-tile="12,34"]')).toHaveCount(0);
  await expect(page.locator('.terrain-rail-world[data-tile="11,34"][data-network-topology="end"]')).toHaveCount(1);
  await expect(page.locator('.terrain-rail-world[data-tile="13,34"][data-network-topology="end"]')).toHaveCount(1);

  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);
  const reloaded = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(reloaded.map.rails[removed]).toBe(false);
  expect(railTileIds(reloaded)).toHaveLength(5);
  assertReciprocalRailMasks(reloaded);

  await attachJson(testInfo, 'rail-undo-bulldoze-reload.json', {
    fullRouteUndo: true,
    removedTile: removed,
    laneTilesAfterBulldoze: railTileIds(reloaded),
    canonicalReloadExact: true,
  });
  await maybeScreenshot(page, testInfo, 'rail-bulldoze-reload.png');
});

test('places every generator and RCI sector through visible controls with truthful power cards and previews', async ({ page }, testInfo) => {
  await openCity(page, `market-power-catalog-${Date.now()}`);
  const generators = [
    { id: 'coal-power-plant', label: 'Coal Power Plant', x: 5, width: 2, height: 3, capacity: '1,200', expense: '$431,000' },
    { id: 'gas-power-plant', label: 'Natural Gas Plant', x: 10, width: 2, height: 3, capacity: '900', expense: '$603,400' },
    { id: 'nuclear-power-plant', label: 'Nuclear Power Plant', x: 15, width: 3, height: 3, capacity: '4,800', expense: '$1,724,000' },
    { id: 'wind-turbine', label: 'Wind Turbine', x: 21, width: 1, height: 1, capacity: '60', expense: '$25,860' },
    { id: 'solar-plant', label: 'Solar Plant', x: 25, width: 4, height: 2, capacity: '90', expense: '$25,860' },
  ] as const;

  for (const generator of generators) {
    await page.getByRole('button', { name: 'Utilities', exact: true }).click();
    await page.locator('.utilities-tray').getByRole('button', { name: 'Power', exact: true }).click();
    const card = page.locator(`#utility-catalog-grid [data-action="facility:${generator.id}"]`);
    await expect(card).toBeVisible();
    await expect(card).toHaveAccessibleName(generator.label);
    await expect(card).toContainText(`${generator.width} × ${generator.height} tiles`);
    await expect(card).toContainText(`capacity ${generator.capacity}`);
    await expect(card).toContainText(`${generator.expense} each month`);
    await card.click();
    await previewAndClickMapCell(
      page,
      generator.x,
      5,
      `facility:${generator.id}`,
      generator.width * generator.height,
    );

    const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
    const placed = state.map.facilities.find(({ kind }) => kind === generator.id);
    expect(placed?.anchor).toBe(5 * 48 + generator.x);
    expect(placed?.tiles).toHaveLength(generator.width * generator.height);
    if (generator.id === 'solar-plant') {
      expect(placed?.tiles).toEqual([
        tile(25, 5), tile(26, 5), tile(27, 5), tile(28, 5),
        tile(25, 6), tile(26, 6), tile(27, 6), tile(28, 6),
      ]);
      await moveToMapCell(page, generator.x, 5);
      const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="facility:solar-plant"]');
      await expect(preview).toHaveCount(8);
      await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="facility:solar-plant"].invalid')).toHaveCount(8);
      expect(await preview.evaluateAll((elements) => elements.every((element) => (
        getComputedStyle(element).fill.includes('215, 69, 69')
      )))).toBe(true);
    }
    await expect(page.locator(`.terrain-facility-world.facility-${generator.id}, [data-facility-art="${generator.id}"]`).first())
      .toBeVisible();
  }

  const zonePlacements = [
    { kind: 'residential', code: 'R', x: 5 },
    { kind: 'commercial', code: 'C', x: 6 },
    { kind: 'industrial', code: 'I', x: 7 },
  ] as const;
  for (const zone of zonePlacements) {
    await selectZone(page, zone.kind);
    await previewAndClickMapCell(page, zone.x, 11, `zone-${zone.kind}`, 1);
  }

  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(zonePlacements.map(({ x }) => state.map.zones[11 * 48 + x])).toEqual(['R', 'C', 'I']);
  for (const zone of zonePlacements) {
    await expect(page.locator(`.tile[data-x="${zone.x}"][data-y="11"]`)).toHaveAttribute('data-zone-kind', zone.kind);
  }
  await expect(page.locator('.terrain-zone-world')).not.toHaveCount(0);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);

  await attachJson(testInfo, 'visible-power-rci-catalog-proof.json', {
    generatorIds: generators.map(({ id }) => id),
    zones: zonePlacements.map(({ code }) => code),
    facilityKinds: state.map.facilities.map(({ kind }) => kind),
    durableReload: true,
  });
  await maybeScreenshot(page, testInfo, 'visible-power-rci-catalog.png');
});

test('groups each missing RCI service into one warning per contiguous road-served area and visibly recovers it', async ({ page }, testInfo) => {
  const cityId = `market-contiguous-service-warnings-${Date.now()}`;
  const fixture = contiguousServiceWarningFixture(cityId);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  const expectedAreas = [
    { tileIds: fixture.northTiles, anchor: fixture.northTiles[0]! },
    { tileIds: fixture.southTiles, anchor: fixture.southTiles[0]! },
  ];
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(0);
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(2);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(2);
  for (const { tileIds, anchor } of expectedAreas) {
    const component = tileIds.join('.');
    for (const kind of ['power', 'water'] as const) {
      const warning = page.locator(`[data-warning-area="${kind}:${component}"]`);
      await expect(warning).toHaveAttribute('data-tile', String(anchor));
      await expect(warning).toHaveAttribute('data-warning-count', '4');
      await expect(warning).toHaveAttribute('data-warning-tiles', tileIds.join(','));
      await expect(warning.locator('title')).toContainText('4 contiguous zoned tiles');
    }
  }
  await maybeScreenshot(page, testInfo, 'contiguous-service-warnings-before.png');

  // The road-served Wind Turbine joins the mixed R/C/I component across the
  // single road-cell bridge. This visibly clears power only; Water stays dry.
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 19, 17, 'facility:wind-turbine', 1);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(0);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(2);

  // Water Pipe selection enters Underground View, where warning icons remain
  // hidden. Return through the visible data-view control, then build an
  // adjacent powered Water Tower to recover Water without changing Power.
  await selectWaterItem(page, 'network:water-pipe');
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'underground');
  await expect(page.locator('.synthcity-building-warning')).toHaveCount(0);
  await previewAndClickMapCell(page, 21, 19, 'network:water-pipe', 1);
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 21, 17, 'facility:water-tower', 4);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(0);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'contiguous-service-warnings-recovered.png');
});

test('keeps road warnings tile-granular while power and water ignore road access', async ({ page }, testInfo) => {
  const cityId = `market-per-tile-road-warnings-${Date.now()}`;
  const fixture = perTileRoadWarningFixture(cityId);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  await expect(page.locator('.synthcity-road-warning')).toHaveCount(3);
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(1);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(1);
  for (const tileId of fixture.roadlessTiles) {
    const warning = page.locator(`[data-warning-area="road:${tileId}"]`);
    await expect(warning).toHaveAttribute('data-tile', String(tileId));
    await expect(warning).toHaveAttribute('data-warning-count', '1');
  }
  const groupedTiles = [...fixture.allZoneTiles].sort((left, right) => left - right);
  for (const kind of ['power', 'water'] as const) {
    const warning = page.locator(`[data-warning-area="${kind}:${groupedTiles.join('.')}"]`);
    await expect(warning).toHaveAttribute('data-warning-count', '4');
    await expect(warning).toHaveAttribute('data-warning-tiles', groupedTiles.join(','));
    await expect(warning.locator('title')).toContainText('4 contiguous zoned tiles');
  }
  await maybeScreenshot(page, testInfo, 'per-tile-road-warnings-before.png');

  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 20, 18, 'facility:wind-turbine', 1);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(3);
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(0);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(1);

  await selectWaterItem(page, 'network:water-pipe');
  await previewAndClickMapCell(page, 21, 19, 'network:water-pipe', 1);
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 21, 17, 'facility:water-tower', 4);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(3);
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(0);
  await expect(page.locator('.synthcity-water-warning')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'per-tile-road-warnings-recovered.png');
});

test('keeps a mixed RCI zoning brush visible and commits only bare eligible tiles', async ({ page }, testInfo) => {
  const cityId = `market-zone-overlay-brush-${Date.now()}`;
  await openCity(page, cityId);
  await selectRoad(page);
  await previewAndClickMapCell(page, 10, 10, 'road', 1);
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 12, 10, 'facility:wind-turbine', 1);
  await selectZone(page, 'residential');
  await previewAndClickMapCell(page, 13, 10, 'zone-residential', 1);
  await selectZone(page, 'commercial');
  await previewAndClickMapCell(page, 15, 10, 'zone-commercial', 1);
  await paintSurfaceWater(page, 14, 10);

  const planOutcomes = await page.evaluate(() => (window.marketCityDashboard as Dashboard).preview({
    type: 'zone', kind: 'residential', level: 1,
    cells: [10, 11, 12, 13, 14, 15].map((x) => ({ x, y: 10 })),
  }).tileOutcomes);
  expect(planOutcomes).toEqual([
    { tileId: tile(10, 10), disposition: 'blocked-occupied' },
    { tileId: tile(11, 10), disposition: 'place' },
    { tileId: tile(12, 10), disposition: 'blocked-occupied' },
    { tileId: tile(13, 10), disposition: 'same-zone' },
    { tileId: tile(14, 10), disposition: 'blocked-water' },
    { tileId: tile(15, 10), disposition: 'blocked-zone' },
  ]);

  await selectZone(page, 'residential');
  const start = await projectedPoint(page, 10, 10);
  const end = await projectedPoint(page, 15, 10);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"]');
  await expect(preview).toHaveCount(6);
  expect(await preview.evaluateAll((elements) => elements.map((element) => ({
    tile: `${element.getAttribute('data-x')},${element.getAttribute('data-y')}`,
    disposition: element.getAttribute('data-preview-disposition'),
  })))).toEqual([
    { tile: '10,10', disposition: 'blocked-occupied' },
    { tile: '11,10', disposition: 'place' },
    { tile: '12,10', disposition: 'blocked-occupied' },
    { tile: '13,10', disposition: 'same-zone' },
    { tile: '14,10', disposition: 'blocked-water' },
    { tile: '15,10', disposition: 'blocked-zone' },
  ]);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"][data-preview-disposition="place"]')).toHaveCount(1);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"][data-preview-disposition="same-zone"]')).toHaveCount(1);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"][data-preview-disposition="blocked-zone"]')).toHaveCount(1);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"][data-preview-disposition="blocked-water"]')).toHaveCount(1);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"][data-preview-disposition="blocked-occupied"]')).toHaveCount(2);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"].valid')).toHaveCount(1);
  await expect(page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"].unchanged')).toHaveCount(1);
  const invalidPreview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"].invalid');
  await expect(invalidPreview).toHaveCount(4);
  expect(await invalidPreview.evaluateAll((elements) => elements.every((element) => (
    getComputedStyle(element).fill.includes('city-action-preview-invalid-hatch')
  )))).toBe(true);
  await maybeScreenshot(page, testInfo, 'mixed-zone-overlay-preview.png');
  await page.mouse.up();

  const state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect([10, 11, 12, 13, 14, 15].map((x) => state.map.zones[tile(x, 10)])).toEqual([null, 'R', null, 'R', null, 'C']);
  expect(state.map.roads[tile(10, 10)]).toBe(true);
  expect(state.map.facilities.some((facility) => (
    facility.kind === 'wind-turbine' && facility.tiles.includes(tile(12, 10))
  ))).toBe(true);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  const beforeReload = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeReload);
  await maybeScreenshot(page, testInfo, 'mixed-zone-overlay-committed.png');
});

test('blocks zoning on surface occupants while city warning icons obey world depth', async ({ page }, testInfo) => {
  const cityId = `market-zone-visuals-warning-depth-${Date.now()}`;
  await openCity(page, cityId);

  await selectRoad(page);
  await previewAndClickMapCell(page, 10, 10, 'road', 1);
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 12, 10, 'facility:wind-turbine', 1);
  await selectZone(page, 'residential');
  for (const x of [10, 12]) {
    const point = await moveToMapCell(page, x, 10);
    const preview = page.locator('#city-action-preview-overlays .city-action-preview[data-action="zone-residential"]');
    await expect(preview).toHaveCount(1);
    await expect(preview).toHaveAttribute('data-valid', 'false');
    await expect(preview).toHaveAttribute('data-preview-disposition', 'blocked-occupied');
    await page.mouse.click(point.x, point.y);
  }
  await previewAndClickMapCell(page, 13, 10, 'zone-residential', 1);

  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect([10, 12, 13].map((x) => state.map.zones[tile(x, 10)])).toEqual([null, null, 'R']);
  expect(state.map.roads[tile(10, 10)]).toBe(true);
  expect(state.map.facilities.some((facility) => (
    facility.kind === 'wind-turbine' && facility.tiles.includes(tile(12, 10))
  ))).toBe(true);
  await expect(page.locator('.terrain-zone-world[data-zone-tiles="' + tile(13, 10) + '"]')).toHaveCount(1);
  await expect(page.locator('.terrain-zone-world[data-zone-tiles*="' + tile(10, 10) + '"]')).toHaveCount(0);
  await expect(page.locator('.terrain-zone-world[data-zone-tiles*="' + tile(12, 10) + '"]')).toHaveCount(0);

  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'Zones', exact: true }).click();
  await expect(page.locator(`.synthcity-data-zones[data-tile="${tile(10, 10)}"]`)).toHaveCount(0);
  await expect(page.locator(`.synthcity-data-zones[data-tile="${tile(12, 10)}"]`)).toHaveCount(0);
  await expect(page.locator(`.synthcity-data-zones[data-tile="${tile(13, 10)}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Data views', exact: true }).click();
  await page.getByRole('button', { name: 'City View', exact: true }).click();
  await expect(page.locator('#synthcity-status-overlays .synthcity-building-warning')).toHaveCount(0);

  // This is the same rear-warning / front-water-tower relationship from the
  // reported screenshot. The sign is now part of terrain-construction-
  // overlays and receives a lower painter rank than the foreground tower.
  await selectZone(page, 'residential');
  await previewAndClickMapCell(page, 20, 20, 'zone-residential', 1);
  await selectWaterItem(page, 'facility:water-tower');
  await previewAndClickMapCell(page, 20, 23, 'facility:water-tower', 4);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const tower = state.map.facilities.find((facility) => (
    facility.kind === 'water-tower' && facility.tiles.includes(tile(20, 23))
  ));
  expect(tower).toBeDefined();
  const depthProof = await page.locator('#terrain-construction-overlays').evaluate((scene, input) => {
    const warning = scene.querySelector<SVGGElement>(
      `[data-render-item-id="warning:road:${input.warningTile}"]`,
    );
    const tower = scene.querySelector<SVGGElement>(`[data-render-item-id="facility:${input.towerId}"]`);
    if (!warning || !tower) return null;
    return {
      warningRank: Number(warning.dataset.occlusionRank),
      towerRank: Number(tower.dataset.occlusionRank),
      warningInWorldScene: warning.classList.contains('synthcity-building-warning'),
      statusWarnings: document.querySelectorAll('#synthcity-status-overlays .synthcity-building-warning').length,
    };
  }, { warningTile: tile(20, 20), towerId: tower!.id });
  expect(depthProof).toEqual({
    warningRank: expect.any(Number),
    towerRank: expect.any(Number),
    warningInWorldScene: true,
    statusWarnings: 0,
  });
  expect(depthProof!.warningRank).toBeLessThan(depthProof!.towerRank);

  // Each camera turn regenerates the shared painter list. The DOM order and
  // declared occlusion ranks must stay strictly monotonic in every direction.
  for (let rotation = 0; rotation < 4; rotation += 1) {
    const ordered = await page.locator('#terrain-construction-overlays > [data-render-item-id]').evaluateAll((groups) => (
      groups.map((group) => ({
        rank: Number(group.getAttribute('data-occlusion-rank')),
        depth: Number(group.getAttribute('data-render-depth')),
        sublayer: Number(group.getAttribute('data-render-sublayer')),
        id: group.getAttribute('data-render-item-id') || '',
      }))
    ));
    expect(ordered.map(({ rank }) => rank)).toEqual(ordered.map((_, index) => index));
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1]!;
      const current = ordered[index]!;
      expect(
        previous.depth < current.depth
        || (previous.depth === current.depth && (
          previous.sublayer < current.sublayer
          || (previous.sublayer === current.sublayer && previous.id.localeCompare(current.id) <= 0)
        )),
      ).toBe(true);
    }
    if (rotation < 3) await page.getByRole('button', { name: 'Rotate view right' }).click();
  }
  await maybeScreenshot(page, testInfo, 'zone-visuals-warning-depth.png');
});

test('draws a foreground wind turbine over a rear RCI tile even when another same-sector tile is nearer', async ({ page }, testInfo) => {
  const cityId = `market-wind-turbine-depth-${Date.now()}`;
  const fixture = windTurbineForegroundFixture(cityId);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  const depthProof = await page.locator('#terrain-construction-overlays').evaluate((scene, input) => {
    const turbine = scene.querySelector<SVGGElement>('[data-render-item-id="facility:wind-depth-lab"]');
    const rearZone = scene.querySelector<SVGGElement>(`[data-zone-tiles="${input.rearZone}"]`);
    const frontZone = scene.querySelector<SVGGElement>(`[data-zone-tiles="${input.frontZone}"]`);
    if (!turbine || !rearZone || !frontZone) return null;
    return {
      turbineRank: Number(turbine.dataset.occlusionRank),
      rearZoneRank: Number(rearZone.dataset.occlusionRank),
      frontZoneRank: Number(frontZone.dataset.occlusionRank),
      turbineDepth: Number(turbine.dataset.renderDepth),
      rearZoneDepth: Number(rearZone.dataset.renderDepth),
      frontZoneDepth: Number(frontZone.dataset.renderDepth),
    };
  }, fixture);
  expect(depthProof).not.toBeNull();
  expect(depthProof!.rearZoneRank).toBeLessThan(depthProof!.turbineRank);
  expect(depthProof!.frontZoneRank).toBeGreaterThan(depthProof!.turbineRank);
  await maybeScreenshot(page, testInfo, 'wind-turbine-foreground-depth.png');
});

test('keeps selected source art visible while bulldozing and leaves the RCI zoning permission behind', async ({ page }, testInfo) => {
  const cityId = `market-bulldoze-source-preview-${Date.now()}`;
  const fixture = dezoneOverlayFixture(cityId);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  const beforeHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  const beforePrimitives = await rciPrimitiveSignature(page);
  expect(beforePrimitives).not.toEqual([]);
  await selectBulldoze(page);
  await moveToMapCell(page, 10, 10);
  await expect(page.locator('#bulldoze-preview-footprint .bulldoze-preview-footprint')).not.toHaveCount(0);
  await expect(page.locator('#bulldoze-preview-outline .bulldoze-preview-outline.valid')).not.toHaveCount(0);
  await expect(page.locator('#terrain-construction-overlays .placement-preview-suppressed')).toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash())).toBe(beforeHash);
  expect(await rciPrimitiveSignature(page)).toEqual(beforePrimitives);
  await maybeScreenshot(page, testInfo, 'market-bulldoze-source-visible-held.png');

  await clickMapCell(page, 10, 10);
  const demolished = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(demolished.map.zones[fixture.developed]).toBe('R');
  expect(demolished.economy.density[fixture.developed]).toBe(0);
  expect(demolished.economy.wealth[fixture.developed]).toBe(0);
  expect(await rciPrimitiveSignature(page)).toEqual([]);
  await maybeScreenshot(page, testInfo, 'market-bulldoze-zoned-lot-released.png');
});

test('dezones developed RCI while preserving non-RCI physical infrastructure beneath an overlay', async ({ page }, testInfo) => {
  const cityId = `market-dezone-overlay-${Date.now()}`;
  const fixture = dezoneOverlayFixture(cityId);
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  const beforeHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  await selectDezone(page);
  await moveToMapCell(page, 10, 10);
  await expect(page.locator('#terrain-construction-overlays .placement-preview-suppressed')).toHaveCount(0);
  await expect(page.locator('#placement-preview-world-overlays [data-preview-root="true"]')).toHaveCount(0);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash())).toBe(beforeHash);
  await maybeScreenshot(page, testInfo, 'market-dezone-developed-held.png');
  await clickMapCell(page, 10, 10);
  let state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.zones[fixture.developed]).toBeNull();
  expect(state.economy.density[fixture.developed]).toBe(0);
  expect(state.economy.wealth[fixture.developed]).toBe(0);

  await selectDezone(page);
  await clickMapCell(page, 11, 10);
  await selectDezone(page);
  await clickMapCell(page, 12, 10);
  state = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(state.map.zones[fixture.developed]).toBeNull();
  expect(state.map.zones[fixture.empty]).toBeNull();
  expect(state.map.zones[fixture.roadOverlay]).toBeNull();
  expect(state.map.roads[fixture.roadOverlay]).toBe(true);
});

test('sheds a constrained conductive component within its local density cap and visibly restores capacity', async ({ page }, testInfo) => {
  const cityId = `market-power-shedding-${Date.now()}`;
  const fixture = powerOverloadFixture(cityId);
  const unservedConsumer = fixture.consumerTiles.at(-1)!;
  await seedV2City(page, fixture.state);
  await openCity(page, cityId);

  // Representative generation uses the same cards and terrain picker as a
  // player. The bridge is reserved for one bounded setup step after placement.
  await selectPowerItem(page, 'facility:wind-turbine');
  await previewAndClickMapCell(page, 10, 12, 'facility:wind-turbine', 1);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));

  const overloaded = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const poweredConsumers = fixture.consumerTiles.filter((tile) => overloaded.environment.powered[tile]);
  expect(poweredConsumers).toEqual(fixture.expectedWindServed);
  expect(overloaded.economy.density[fixture.expectedWindServed[0]!]).toBeCloseTo(0.15, 8);
  expect(overloaded.economy.density[unservedConsumer]).toBeCloseTo(0.15, 8);
  await expect(page.locator('#metric-powered')).toHaveText('95%');
  await expect(page.locator(`.synthcity-power-warning[data-tile="${unservedConsumer}"]`)).toBeVisible();

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, unservedConsumer % 48, Math.floor(unservedConsumer / 48));
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'building');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✕');

  // Nuclear placement uses a separate road-access point but touches the same
  // conductive component through its footprint and the vertical line at x=11.
  await selectPowerItem(page, 'facility:nuclear-power-plant');
  await previewAndClickMapCell(page, 8, 15, 'facility:nuclear-power-plant', 9);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));

  const restored = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(fixture.consumerTiles.every((tile) => restored.environment.powered[tile])).toBe(true);
  // The RCI market can still move this tile after service is restored. Its
  // allocation, metric, warning, and inspector status are the recovery proof;
  // this browser contract does not conflate that with sector demand.
  expect(restored.economy.density[unservedConsumer]).toBeGreaterThan(0);
  await expect(page.locator('#metric-powered')).toHaveText('100%');
  await expect(page.locator('.synthcity-power-warning')).toHaveCount(0);

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, unservedConsumer % 48, Math.floor(unservedConsumer / 48));
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', 'building');
  await expect(page.locator('[data-inspector-connector="power"] .inspector-connector-status')).toHaveText('✓');

  await attachJson(testInfo, 'power-shedding-recovery.json', {
    consumerTiles: fixture.consumerTiles,
    expectedWindServed: fixture.expectedWindServed,
    windPoweredConsumers: poweredConsumers,
    overloadedDensity: fixture.consumerTiles.map((tile) => overloaded.economy.density[tile]),
    restoredDensity: fixture.consumerTiles.map((tile) => restored.economy.density[tile]),
  });
  await maybeScreenshot(page, testInfo, 'power-component-restored.png');
});

test('persists City Settings Vertical Development Level and exposes Height Caps to every city', async ({ page }, testInfo) => {
  const cityId = `market-vertical-level-${Date.now()}`;
  await openCity(page, cityId);
  await expect(page.locator('#city-height-level')).toHaveText('L1');
  await page.getByRole('button', { name: 'Open city settings' }).click();
  const level = page.getByRole('spinbutton', { name: 'Vertical Development Level' });
  await expect(level).toHaveValue('1');
  await level.fill('2');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#city-height-level')).toHaveText('L2');
  await page.getByRole('button', { name: 'Open city settings' }).click();
  await level.fill('1.5');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.locator('#city-settings-dialog')).toBeVisible();
  await expect(page.locator('#city-height-level')).toHaveText('L2');
  await page.getByRole('button', { name: 'Close city settings' }).click();
  await page.getByRole('button', { name: 'Data views' }).click();
  await expect(page.locator('[data-city-view-option="height-caps"]')).toBeVisible();
  await page.locator('[data-city-view-option="height-caps"]').click();
  await expect(page.locator('.city-client')).toHaveAttribute('data-city-view', 'height-caps');
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).whenDurable());
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect((await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot()))
    .market.verticalDevelopmentLevel).toBe(2);
  await expect(page.locator('#city-height-level')).toHaveText('L2');
  await attachJson(testInfo, 'vertical-development-level.json', { cityId, level: 2 });
});

test('builds, burns, grows, inspects, rotates, and reloads one deterministic city', async ({ page }, testInfo) => {
  await openCity(page, `market-cutover-${Date.now()}`);
  await page.evaluate(() => (window.marketCityDashboard as Dashboard).setVerticalDevelopmentLevel(10));

  await expect(page.locator('[data-action^="zone-"]')).toHaveCount(3);
  await expect(page.locator('[data-action="tax"]')).toHaveCount(0);
  await expect(page.locator('[data-action*="loan"], [data-action*="police"]')).toHaveCount(0);
  await expect(page.locator('.action-dock')).toContainText('Fixed tax 2.5%');
  await expect(page.locator('.action-dock')).toContainText('Monthly operating cost');

  // Representative construction is driven through the same visible controls
  // and terrain picker a player uses. Bulk rectangles then use the public
  // command seam so the deterministic long-run proof stays concise.
  await selectRoad(page);
  await clickMapCell(page, 6, 20);
  await selectPowerItem(page, 'facility:coal-power-plant');
  await clickMapCell(page, 10, 16);
  await selectPowerItem(page, 'power-line');
  await clickMapCell(page, 9, 16);
  await selectZone(page, 'residential');
  await clickMapCell(page, 12, 17);

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

  const bootstrap = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(bootstrap.map.size).toBe(48);
  expect(bootstrap.map.facilities.map(({ kind }) => kind)).toContain('coal-power-plant');
  expect(bootstrap.map.roads.filter(Boolean)).toHaveLength(35);
  expect(bootstrap.map.powerLines.filter(Boolean)).toHaveLength(2);
  expect(bootstrap.economy.treasury).toBe(5_000);

  const ignited = await page.evaluate(() => {
    const active = window.marketCityDashboard as Dashboard;
    active.setFireDifficulty('hard');
    for (let month = 0; month < 240; month += 1) {
      active.step(1);
      if (active.snapshot().fire.incidents.some((incident) => incident.status === 'burning')) return true;
    }
    return false;
  });
  expect(ignited).toBe(true);
  const fireState = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(fireState.fire.incidents.some((incident) => incident.status === 'burning')).toBe(true);
  await expect(page.locator('[data-render-contract="market-rci-svg-v1"]')).not.toHaveCount(0);
  await expect(page.locator('[data-render-contract="market-rci-svg-v1"][data-fire-intensity]:not([data-fire-intensity="0"])')).not.toHaveCount(0);

  const fireTile = fireState.fire.incidents.find((incident) => incident.status === 'burning')!.tileIds[0]!;
  const fireX = fireTile % 48;
  const fireY = Math.floor(fireTile / 48);
  const station = await page.evaluate(({ fireX, fireY }) => {
    const state = (window.marketCityDashboard as Dashboard).snapshot();
    for (let radius = 1; radius <= 10; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        const dx = radius - Math.abs(dy);
        for (const sign of [-1, 1]) {
          const x = fireX + dx * sign;
          const y = fireY + dy;
          if (x < 0 || y < 0 || x >= 48 || y >= 48) continue;
          const tile = y * 48 + x;
          const occupied = state.map.zones[tile] !== null || state.map.roads[tile] || state.map.powerLines[tile]
            || state.map.facilities.some((facility) => facility.tiles.includes(tile));
          if (!occupied && !state.map.terrain.water[tile]) return { x, y };
        }
      }
    }
    throw new Error('No free station site was found inside the fire-protection diamond.');
  }, { fireX, fireY });
  await selectFireStation(page);
  await clickMapCell(page, station.x, station.y);
  await expect(page.locator('.terrain-facility-world.facility-fire-station:not([data-preview="catalog"])')).toBeVisible();

  await page.evaluate(() => {
    const active = window.marketCityDashboard as Dashboard;
    active.setFireDifficulty('easy');
    active.step(124);
  });
  const mature = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  const stocks = { R: 0, C: 0, I: 0 };
  mature.map.zones.forEach((zone, tile) => { if (zone) stocks[zone] += mature.economy.density[tile] ?? 0; });
  expect(mature.clock.month).toBe(fireState.clock.month + 124);
  expect(stocks.R).toBeGreaterThan(5);
  expect(stocks.C).toBeGreaterThan(5);
  expect(stocks.I).toBeGreaterThan(5);
  // This deterministic city used to mature in debt because uncollected waste
  // pinned pollution near the top of the scale, which suppressed desirability
  // and so the tax base. With the waste term settling at its documented cap
  // instead of at cap / approach, the same run matures profitable. Pinning the
  // sign catches a regression back to the old runaway.
  expect(mature.economy.treasury).toBeGreaterThan(0);
  expect(mature.economy.lastOperatingExpense).toBeGreaterThan(550_000);
  expect(mature.economy.lastRevenue).toBeGreaterThan(mature.economy.lastOperatingExpense);
  await expect.poll(() => page.locator('[data-render-contract="market-rci-svg-v1"]').count()).toBeGreaterThan(20);
  // Serve the full industrial strip before visual proof without changing the
  // deterministic growth run or its Month-151 economic receipts.
  await dispatch(page, { type: 'place-network', network: 'road', cells: cells(12, 25, 37, 25) });
  await expect(page.locator('.market-building-lot-slab')).toHaveCount(0);
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'market-city-month-151-baseline.png');

  // The renderer must survive a real building demolition/undo cycle before
  // persistence proof: every visual primitive and its painter rank returns
  // exactly, rather than merely redrawing a similarly shaped lot.
  const beforeBuildingUndo = await rciPrimitiveSignature(page);
  const demolitionCell = await page.locator('[data-render-contract="market-rci-svg-v1"][data-world-part-kind="lot"]').first()
    .evaluate((part) => ({ x: Number(part.getAttribute('data-bulldoze-x')), y: Number(part.getAttribute('data-bulldoze-y')) }));
  await selectBulldoze(page);
  await moveToMapCell(page, demolitionCell.x, demolitionCell.y);
  await expect(page.locator('#bulldoze-preview-outline .bulldoze-preview-outline.valid')).not.toHaveCount(0);
  await clickMapCell(page, demolitionCell.x, demolitionCell.y);
  expect(await rciPrimitiveSignature(page)).not.toEqual(beforeBuildingUndo);
  await expect(page.locator('#simulation-undo')).toBeEnabled();
  await page.locator('#simulation-undo').click();
  await expect.poll(() => rciPrimitiveSignature(page)).toEqual(beforeBuildingUndo);

  // A zero-density permission outside road reach is an inert planning overlay.
  // Adding or removing it must not re-rank, resize, or re-merge built lots.
  const inaccessibleEmptyCommercial = await page.evaluate(() => {
    const state = (window.marketCityDashboard as Dashboard).snapshot();
    const candidates: Array<{ x: number; y: number; tile: number; centerDistance: number }> = [];
    for (let tile = 0; tile < state.map.zones.length; tile += 1) {
      const x = tile % 48;
      const y = Math.floor(tile / 48);
      const occupied = state.map.zones[tile] !== null
        || state.map.roads[tile]
        || state.map.powerLines[tile]
        || state.map.facilities.some((facility) => facility.tiles.includes(tile));
      if (!occupied && !state.map.terrain.water[tile] && !state.environment.roadAccess[tile]) {
        candidates.push({ x, y, tile, centerDistance: Math.abs(x - 24) + Math.abs(y - 24) });
      }
    }
    candidates.sort((left, right) => left.centerDistance - right.centerDistance || left.tile - right.tile);
    const candidate = candidates[0];
    if (!candidate) throw new Error('No dry, empty tile outside road reach was available.');
    return candidate;
  });
  const beforeEmptyZoning = await appearanceSignature(page);
  await selectZone(page, 'commercial');
  await clickMapCell(page, inaccessibleEmptyCommercial.x, inaccessibleEmptyCommercial.y);
  await expect.poll(() => page.evaluate((tile) => {
    const state = (window.marketCityDashboard as Dashboard).snapshot();
    return {
      zone: state.map.zones[tile],
      density: state.economy.density[tile],
      roadAccess: state.environment.roadAccess[tile],
    };
  }, inaccessibleEmptyCommercial.tile)).toEqual({ zone: 'C', density: 0, roadAccess: false });
  expect(await appearanceSignature(page)).toEqual(beforeEmptyZoning);
  await selectDezone(page);
  await clickMapCell(page, inaccessibleEmptyCommercial.x, inaccessibleEmptyCommercial.y);
  await expect.poll(() => page.evaluate((tile) => (
    (window.marketCityDashboard as Dashboard).snapshot().map.zones[tile]
  ), inaccessibleEmptyCommercial.tile)).toBeNull();
  expect(await appearanceSignature(page)).toEqual(beforeEmptyZoning);
  await testInfo.attach('empty-dezone-skyline-proof.json', {
    body: Buffer.from(`${JSON.stringify({
      tile: inaccessibleEmptyCommercial,
      visibleLots: beforeEmptyZoning.length,
      skylineUnchangedAfterZone: true,
      skylineUnchangedAfterDezone: true,
    }, null, 2)}\n`),
    contentType: 'application/json',
  });

  for (let rotation = 0; rotation < 4; rotation += 1) {
    await expect(page.locator('.market-building-lot-slab')).toHaveCount(0);
    await expect(page.locator('.synthcity-road-warning')).toHaveCount(0);
    const depthProof = await marketLotDepthProof(page);
    expect(depthProof.multiTileLots).toBeGreaterThan(0);
    expect(depthProof.mismatches).toEqual([]);
    const overlapProof = await rciProjectedOverlapProof(page);
    expect(overlapProof.overlaps).toBeGreaterThan(0);
    expect(overlapProof.orderingViolations).toEqual([]);
    if (rotation === 1) await maybeScreenshot(page, testInfo, 'market-city-month-151-rotated.png');
    await page.getByRole('button', { name: 'Rotate view right' }).click();
  }
  await expect(page.locator('.market-building-lot-slab')).toHaveCount(0);
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'market-city-month-151.png');

  const stepDurations = await page.evaluate(() => {
    const active = window.marketCityDashboard as Dashboard;
    return Array.from({ length: 24 }, () => {
      const started = performance.now();
      active.step(1);
      return performance.now() - started;
    });
  });
  const sortedStepDurations = [...stepDurations].sort((left, right) => left - right);
  const stepP95 = sortedStepDurations[Math.ceil(sortedStepDurations.length * 0.95) - 1]!;
  const maximumStep = sortedStepDurations.at(-1)!;
  await testInfo.attach('market-step-performance.json', {
    body: Buffer.from(`${JSON.stringify({ stepDurations, stepP95, maximumStep }, null, 2)}\n`),
    contentType: 'application/json',
  });
  console.info(`MarketCity browser step performance: p95=${stepP95.toFixed(2)}ms max=${maximumStep.toFixed(2)}ms`);
  expect(stepP95).toBeLessThan(16);
  expect(maximumStep).toBeLessThan(100);

  await page.getByRole('button', { name: 'Open live RCI demand equations' }).click();
  const demand = page.getByRole('dialog', { name: 'RCI Demand' });
  await expect(demand.locator('.rci-cell')).toHaveCount(3);
  await expect(demand).toContainText('Have');
  await expect(demand).toContainText('Want');
  await expect(demand).toContainText('Gap');
  await page.getByRole('button', { name: 'Close RCI demand' }).click();

  await page.getByRole('button', { name: 'Zone', exact: true }).click();
  await page.locator('.zones-tray [data-action="inspect"]').click();
  await clickMapCell(page, 26, 18);
  await expect(page.locator('#route-query-panel')).toBeVisible();
  await expect(page.locator('#route-query-panel')).toHaveAttribute('data-inspector-target-kind', /building|zoned-tile/);
  await expect(page.locator('.inspector-connector')).toHaveCount(3);

  const beforeHash = await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash());
  const beforeCanonical = await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot());
  const beforeAppearance = await appearanceSignature(page);
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  await page.getByRole('button', { name: 'Rotate view right' }).click();
  expect(await appearanceSignature(page)).toEqual(beforeAppearance);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash())).toBe(beforeHash);

  await page.evaluate(async () => {
    const active = window.marketCityDashboard as Dashboard;
    await active.save();
    await active.whenDurable();
  });
  await page.reload({ waitUntil: 'networkidle' });
  await expect.poll(() => page.evaluate(() => Boolean(window.marketCityDashboard))).toBe(true);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).hash())).toBe(beforeHash);
  expect(await page.evaluate(() => (window.marketCityDashboard as Dashboard).canonicalSnapshot())).toBe(beforeCanonical);
  expect(await appearanceSignature(page)).toEqual(beforeAppearance);
  await expect(page.locator('.market-building-lot-slab')).toHaveCount(0);
  await expect(page.locator('.synthcity-road-warning')).toHaveCount(0);
  await maybeScreenshot(page, testInfo, 'market-city-reloaded.png');
});

test('arms the police force budget only once a station is running, and prices it', async ({ page }, testInfo) => {
  const cityId = `market-force-budget-${Date.now()}`;
  const state = createMarketCityState({
    cityId,
    cityName: 'Force Budget Lab',
    mayorName: 'Browser Mayor',
    seed: 44,
    createdAt: '2026-08-16T00:00:00.000Z',
  });
  // A road-served turbine the station can draw on, so one placement arms it.
  for (let y = 18; y <= 21; y += 1) state.map.roads[tile(20, y)] = true;
  const plant = tile(19, 21);
  state.map.facilities.push({ id: 'budget-supply', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
  await seedV2City(page, state);
  await openCity(page, cityId);

  // With no force, the dial is present but refuses to arm and explains why.
  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Police', exact: true }).click();
  await expect(page.locator('#police-budget')).toBeVisible();
  await expect(page.locator('#police-funding')).toBeDisabled();
  await expect(page.locator('#police-budget-note')).toContainText('police station first');
  await expect(page.locator('#police-budget-cost')).toHaveText('$0');
  await page.locator('#public-service-catalog-dialog .dialog-close').click();

  await selectPoliceStation(page);
  await previewAndClickMapCell(page, 19, 20, 'facility:police-station', 1);

  await page.getByRole('button', { name: 'Public Services', exact: true }).click();
  await page.locator('.public-services-tray').getByRole('button', { name: 'Police', exact: true }).click();
  await expect(page.locator('#police-funding')).toBeEnabled();
  await expect(page.locator('#police-budget-note')).toContainText('1 operational station');

  await page.locator('#police-funding').fill('4');
  await page.locator('#police-funding').dispatchEvent('change');
  await expect(page.locator('#police-funding-value')).toHaveText('4');
  await expect(page.locator('#police-budget-cost')).toHaveText('$720,000');

  const funded = await page.evaluate(() => (window.marketCityDashboard as Dashboard).snapshot());
  expect(funded.crime.funding).toBe(4);

  // The budget bills every month it runs, on top of the station itself.
  const afterMonth = await page.evaluate(() => (window.marketCityDashboard as Dashboard).step(1));
  expect(afterMonth.economy.lastOperatingExpense).toBe(
    90_000            // the station
    + 4 * 180_000     // four funding steps
    + 25_860          // the turbine powering it
    + 4 * 1_293,      // the road serving it
  );
  await maybeScreenshot(page, testInfo, 'police-force-budget.png');
});
