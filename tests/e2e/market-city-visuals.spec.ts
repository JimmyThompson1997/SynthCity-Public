import { expect, test } from '@playwright/test';
import {
  INACTIVE_FACILITY_VISUAL_FOOTPRINTS,
  MARKET_FACILITY_CATALOG,
} from '../../src/market-city/catalog';

const allFacilityKinds = [
  ...Object.keys(MARKET_FACILITY_CATALOG),
  ...Object.keys(INACTIVE_FACILITY_VISUAL_FOOTPRINTS),
].sort();

test('preserves terrain, network, transit, and facility art without legacy RCI geometry', async ({ page }, testInfo) => {
  const problems: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') problems.push(`console: ${message.text()}`); });
  page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
  page.on('requestfailed', (request) => problems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`));
  page.on('response', (response) => { if (response.status() >= 400) problems.push(`http ${response.status()}: ${response.url()}`); });

  await page.goto('/design-review/square-grid-mayor.html?fixture=renderer-regression-fixture&size=60', { waitUntil: 'networkidle' });
  await expect(page.locator('.city-client')).toHaveAttribute('data-simulation', 'visual-fixture');
  await expect(page.locator('.city-client')).toHaveAttribute('data-renderer-regression-fixture', 'true');
  await expect(page.locator('.tile')).toHaveCount(2_304);
  await expect(page.locator('.terrain-developed-zone')).toHaveCount(0);
  await expect(page.locator('[data-render-contract="market-rci-svg-v1"]')).toHaveCount(0);

  const renderedFacilityKinds = await page.locator('.terrain-facility-world').evaluateAll((elements) => elements
    .map((element) => element.getAttribute('data-facility-kind'))
    .filter((kind): kind is string => Boolean(kind))
    .sort());
  expect([...renderedFacilityKinds, 'coal-power-plant'].sort()).toEqual(allFacilityKinds);
  await expect(page.locator('[data-facility-art="coal-power-plant"]')).toHaveCount(6);

  await expect(page.locator('.terrain-road-svg-details')).not.toHaveCount(0);
  const avenueLanes = page.locator('.terrain-avenue-world[data-network-kind="avenue"]');
  await expect(avenueLanes).toHaveCount(12);
  expect(await avenueLanes.evaluateAll((elements) => elements.every((element) => (
    element.getAttribute('data-world-recipe-id') === 'network:avenue:v1'
    && element.getAttribute('data-world-geometry-fingerprint') === 'network-avenue-geometry-v1'
    && element.getAttribute('data-atomic-footprint') === 'paired-lanes'
    && element.getAttribute('data-driving-side') === 'right'
    && /^(?:0|[1-9]|1[0-5])$/.test(element.getAttribute('data-travel-mask') ?? '')
    && /^(?:0|[1-9]|1[0-5])$/.test(element.getAttribute('data-pair-mask') ?? '')
  )))).toBe(true);
  await expect(avenueLanes.locator('.terrain-avenue-median-edge')).not.toHaveCount(0);
  await expect(avenueLanes.locator('.terrain-avenue-outer-edge')).not.toHaveCount(0);
  const avenueDirections = await avenueLanes.locator('.terrain-avenue-direction-marking')
    .evaluateAll((elements) => elements.map((element) => element.getAttribute('data-direction')).sort());
  expect(avenueDirections).toContain('east');
  expect(avenueDirections).toContain('west');
  const railWorld = page.locator(
    '.terrain-rail-world[data-tile][data-connection-mask][data-network-topology]',
  );
  await expect(railWorld).not.toHaveCount(0);
  expect(await railWorld.evaluateAll((elements) => elements.every((element) => (
    element.getAttribute('data-world-recipe-id') === 'network:rail:v5'
    && element.getAttribute('data-world-geometry-fingerprint') === 'network-rail-geometry-v5'
    && /^(?:0|[1-9]|1[0-5])$/.test(element.getAttribute('data-connection-mask') ?? '')
    && /^(?:isolated|end|straight|corner|tee|cross)$/.test(element.getAttribute('data-network-topology') ?? '')
  )))).toBe(true);
  await expect(railWorld.locator('.terrain-rail-track')).not.toHaveCount(0);
  await expect(page.locator('.terrain-power-pole-world')).not.toHaveCount(0);

  const retainedSilhouettes = await page.evaluate(() => ({
    gasStacks: document.querySelectorAll('.facility-gas-power-plant .terrain-facility-gas-stack').length,
    nuclearCooling: document.querySelectorAll('.facility-nuclear-power-plant .terrain-facility-nuclear-cooling-block').length,
    windBlades: new Set([...document.querySelectorAll<SVGElement>('.facility-wind-turbine .terrain-facility-wind-blade-block[data-blade-index]')]
      .map((element) => element.dataset.bladeIndex)).size,
    solarRows: new Set([...document.querySelectorAll<SVGElement>('.facility-solar-plant .terrain-facility-solar-panel-row[data-row]')]
      .map((element) => element.dataset.row)).size,
  }));
  expect(retainedSilhouettes.gasStacks).toBe(2);
  expect(retainedSilhouettes.nuclearCooling).toBe(2);
  expect(retainedSilhouettes.windBlades).toBe(3);
  expect(retainedSilhouettes.solarRows).toBe(4);

  const fireStation = page.locator('.terrain-facility-world.facility-fire-station');
  await expect(fireStation).toHaveCount(1);
  await expect(fireStation).toHaveAttribute('data-world-recipe-id', 'facility:fire-station:v2');
  await expect(fireStation).toHaveAttribute('data-world-geometry-fingerprint', 'facility-fire-station-geometry-v2');
  await expect(fireStation).toHaveAttribute('data-art-family', 'civic-fire');
  await expect(fireStation).toHaveAttribute('data-art-accessory', 'apparatus-bays');
  await expect(fireStation).toHaveAttribute('data-footprint-width', '1');
  await expect(fireStation).toHaveAttribute('data-footprint-depth', '1');
  await expect(fireStation.locator('.terrain-facility-fire-bay')).toHaveCount(2);
  await expect(fireStation.locator('.terrain-facility-fire-tower')).toHaveCount(0);

  const trainStation = page.locator('.terrain-facility-world[data-facility-kind="train-station"]');
  await expect(trainStation).toHaveCount(1);
  await expect(trainStation).toHaveAttribute('data-world-recipe-id', 'facility:train-station:v2');
  await expect(trainStation).toHaveAttribute(
    'data-world-geometry-fingerprint',
    'facility-train-station-geometry-v2',
  );
  await expect(trainStation.locator('.terrain-facility-platform')).not.toHaveCount(0);
  await expect(trainStation.locator('.terrain-facility-station-hall')).not.toHaveCount(0);
  await expect(trainStation.locator('.terrain-facility-station-canopy')).not.toHaveCount(0);

  for (const rotation of [1, 2, 3, 0]) {
    await page.evaluate((nextRotation) => {
      const bridge = (window as unknown as {
        squareGridMayor: {
          viewSnapshot(): { rotation: number; panX: number; panY: number; zoom: number; dataView: string };
          restoreViewState(view: { rotation: number; panX: number; panY: number; zoom: number; dataView: string }): void;
        };
      }).squareGridMayor;
      bridge.restoreViewState({ ...bridge.viewSnapshot(), rotation: nextRotation });
    }, rotation);
    await expect(page.locator('.terrain-facility-world.facility-wind-turbine')).toBeVisible();
    await expect(page.locator('.terrain-facility-world.facility-nuclear-power-plant')).toBeVisible();
    await expect(avenueLanes).toHaveCount(12);
    await expect(avenueLanes.locator('.terrain-avenue-direction-marking')).toHaveCount(12);
    expect(await avenueLanes.evaluateAll((elements) => elements.every((element) => (
      element.getAttribute('data-world-recipe-id') === 'network:avenue:v1'
      && element.getAttribute('data-world-geometry-fingerprint') === 'network-avenue-geometry-v1'
    )))).toBe(true);
    await expect(railWorld).not.toHaveCount(0);
    await expect(railWorld.locator('.terrain-rail-track')).not.toHaveCount(0);
    await expect(trainStation).toBeVisible();
    await expect(trainStation).toHaveAttribute('data-world-recipe-id', 'facility:train-station:v2');
    await expect(trainStation).toHaveAttribute(
      'data-world-geometry-fingerprint',
      'facility-train-station-geometry-v2',
    );
    await expect(fireStation).toBeVisible();
    await expect(fireStation).toHaveAttribute('data-world-recipe-id', 'facility:fire-station:v2');
    await expect(fireStation).toHaveAttribute('data-world-geometry-fingerprint', 'facility-fire-station-geometry-v2');
    await expect(fireStation.locator('.terrain-facility-fire-bay')).toHaveCount(2);
    await expect(fireStation.locator('.terrain-facility-fire-tower')).toHaveCount(0);
  }

  await page.evaluate(() => {
    (window as unknown as { squareGridMayor: { selectDataView(view: string): void } })
      .squareGridMayor.selectDataView('underground');
  });
  await expect(page.locator('.underground-subway')).not.toHaveCount(0);
  await expect(page.locator('.underground-water-pipe')).not.toHaveCount(0);
  await page.evaluate(() => {
    (window as unknown as { squareGridMayor: { selectDataView(view: string): void } })
      .squareGridMayor.selectDataView('city');
  });

  if (process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1') {
    const screenshotPath = testInfo.outputPath('renderer-regression-fixture.png');
    await page.screenshot({ path: screenshotPath });
    await testInfo.attach('renderer-regression-fixture.png', {
      path: screenshotPath,
      contentType: 'image/png',
    });
  }
  await testInfo.attach('avenue-renderer-regression-fixture.json', {
    body: Buffer.from(`${JSON.stringify({
      laneCount: 12,
      directions: avenueDirections,
      rotations: [0, 1, 2, 3],
      worldRecipeId: 'network:avenue:v1',
      worldGeometryFingerprint: 'network-avenue-geometry-v1',
      railRecipeId: 'network:rail:v5',
      railGeometryFingerprint: 'network-rail-geometry-v5',
      trainStationRecipeId: 'facility:train-station:v2',
      trainStationGeometryFingerprint: 'facility-train-station-geometry-v2',
    }, null, 2)}\n`),
    contentType: 'application/json',
  });
  expect(problems).toEqual([]);
});
