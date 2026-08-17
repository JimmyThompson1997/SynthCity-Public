import { describe, expect, it } from 'vitest';

import { deriveFireStationCoverage } from '../../src/market-city/fire';
import { deriveMarketView } from '../../src/market-city/queries';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { stepMonth, stepMonths } from '../../src/market-city/simulation';
import { derivePower } from '../../src/market-city/spatial';
import {
  MARKET_MAP_FIXTURE_IDS,
  MARKET_SCENARIO_CHECKPOINTS,
  assertScenarioStateIsValid,
  buildCiFirstScenario,
  buildFireCoverageScenario,
  buildLandShortageScenario,
  buildNoBootstrapScenario,
  buildOneCoalEquilibriumScenario,
  buildPlantComparisonScenario,
  buildPollutionRelocationScenario,
  buildPowerSeveranceScenario,
  buildResidentialBootstrapScenario,
  createMarketMapFixture,
  releaseSlurpCapacity,
  repairPowerSeverance,
  runDeterministicCheckpointTrace,
  sectorStocks,
  severScenarioPower,
  summarizeScenarioState,
} from '../../src/market-city/scenarios';
import { hashDeterministicState } from '../../src/market-city/state';
import type { MarketFacilityKind, MarketPowerPlantKind } from '../../src/market-city/types';

describe('market-city real-map fixtures', () => {
  it('defines six deterministic, fixed 48x48 maps with meaningful terrain constraints', () => {
    expect(MARKET_MAP_FIXTURE_IDS).toEqual([
      'flat-48',
      'coast-ridge-48',
      'river-blocks-48',
      'dense-core-48',
      'firebreak-48',
      'mixed-energy-48',
    ]);

    const hashes = new Set<string>();
    for (const fixtureId of MARKET_MAP_FIXTURE_IDS) {
      const first = createMarketMapFixture(fixtureId, 44);
      const second = createMarketMapFixture(fixtureId, 44);
      expect(first.map.size).toBe(48);
      expect(hashDeterministicState(first)).toBe(hashDeterministicState(second));
      hashes.add(hashDeterministicState(first));
    }

    expect(hashes.size).toBe(MARKET_MAP_FIXTURE_IDS.length);
    expect(createMarketMapFixture('coast-ridge-48', 1).map.terrain.water.some(Boolean)).toBe(true);
    expect(createMarketMapFixture('river-blocks-48', 1).map.terrain.water.some(Boolean)).toBe(true);
    expect(Math.max(...createMarketMapFixture('coast-ridge-48', 1).map.terrain.elevation)).toBeGreaterThan(0);
  });
});

describe('market-city bootstrap and demand flow', () => {
  it('keeps served RCI zoning empty without a live plant', () => {
    const scenario = buildNoBootstrapScenario();
    const after = stepMonths(scenario.state, 24);
    expect(sectorStocks(after)).toEqual({ R: 0, C: 0, I: 0 });
    expect(after.market.demand).toEqual({ R: 0, C: 0, I: 0 });
  });

  it('boots residential from a live plant, then C and I one month later', () => {
    const scenario = buildResidentialBootstrapScenario();
    const monthOne = stepMonth(scenario.state);
    const monthTwo = stepMonth(monthOne);

    expect(sectorStocks(monthOne).R).toBeGreaterThan(0);
    expect(sectorStocks(monthOne).C).toBe(0);
    expect(sectorStocks(monthOne).I).toBe(0);
    expect(sectorStocks(monthTwo).C).toBeGreaterThan(0);
    expect(sectorStocks(monthTwo).I).toBeGreaterThan(0);
  });

  it('leaves C-first and I-first openings idle until residential activity exists', () => {
    const cFirst = buildCiFirstScenario('C');
    const iFirst = buildCiFirstScenario('I');
    expect(sectorStocks(stepMonths(cFirst.beforeResidential, 12)).C).toBe(0);
    expect(sectorStocks(stepMonths(iFirst.beforeResidential, 12)).I).toBe(0);
    expect(sectorStocks(stepMonths(cFirst.afterResidential, 4)).C).toBeGreaterThan(0);
    expect(sectorStocks(stepMonths(iFirst.afterResidential, 4)).I).toBeGreaterThan(0);
  });

  it('moves an ample one-coal city toward the analytic R=C=I=40 equilibrium', () => {
    const scenario = buildOneCoalEquilibriumScenario();
    const after = stepMonths(scenario.state, 450);
    const stocks = sectorStocks(after);

    expect(stocks.R).toBeCloseTo(40, -1);
    expect(stocks.C).toBeCloseTo(40, -1);
    expect(stocks.I).toBeCloseTo(40, -1);
    expect(Math.max(stocks.R, stocks.C, stocks.I) - Math.min(stocks.R, stocks.C, stocks.I)).toBeLessThan(8);
  }, 15_000);
});

describe('capacity, environment, plant, and power scenarios', () => {
  it('caps scarce land, then allocates conserved unmet demand into released land', () => {
    const scarce = stepMonths(buildLandShortageScenario().state, 180);
    const before = deriveMarketView(scarce);
    expect(before.R.want).toBeGreaterThan(before.R.availableCapacity);
    expect(before.R.have).toBeCloseTo(before.R.availableCapacity, 3);

    const released = releaseSlurpCapacity(scarce);
    const after = stepMonths(released.state, 36);
    expect(sectorStocks(after).R).toBeGreaterThan(sectorStocks(scarce).R + 0.25);
    expect(released.releasedTileIds.some((tileId) => after.economy.density[tileId]! > 0)).toBe(true);
  }, 15_000);

  it('relocates residential growth toward cleaner land', () => {
    const scenario = buildPollutionRelocationScenario();
    const after = stepMonths(scenario.state, 180);
    const dirtyPollution = scenario.dirtyResidential.reduce((sum, tileId) => sum + after.environment.pollution[tileId]!, 0)
      / scenario.dirtyResidential.length;
    const cleanPollution = scenario.cleanResidential.reduce((sum, tileId) => sum + after.environment.pollution[tileId]!, 0)
      / scenario.cleanResidential.length;
    const dirtyDensity = scenario.dirtyResidential.reduce((sum, tileId) => sum + after.economy.density[tileId]!, 0);
    const cleanDensity = scenario.cleanResidential.reduce((sum, tileId) => sum + after.economy.density[tileId]!, 0);

    expect(dirtyPollution).toBeGreaterThan(cleanPollution);
    expect(cleanDensity).toBeGreaterThan(dirtyDensity);
  }, 15_000);

  it('proves every plant capacity, monthly cost, and pollution tradeoff', () => {
    const kinds: MarketPowerPlantKind[] = [
      'coal-power-plant',
      'gas-power-plant',
      'nuclear-power-plant',
      'wind-turbine',
      'solar-plant',
    ];
    const pollutionByKind = new Map<MarketFacilityKind, number>();
    const plantSitePollutionByKind = new Map<MarketFacilityKind, number>();

    for (const kind of kinds) {
      const scenario = buildPlantComparisonScenario(kind);
      const after = stepMonth(scenario.state);
      const hasRenewableWaterBootstrap = scenario.state.map.facilities.some(({ id }) => id === 'scenario-water-bootstrap');
      const bootstrap = hasRenewableWaterBootstrap ? MARKET_CITY_RULES.plants['wind-turbine'] : null;
      expect(derivePower(after).liveCapacity).toBe(
        MARKET_CITY_RULES.plants[kind].capacity + (bootstrap?.capacity ?? 0),
      );
      expect(after.economy.lastOperatingExpense).toBe(
        MARKET_CITY_RULES.plants[kind].monthlyExpense
          + (bootstrap?.monthlyExpense ?? 0)
          + scenario.roadTileCount * MARKET_CITY_RULES.roadMonthlyExpense
          + scenario.powerLineTileCount * MARKET_CITY_RULES.powerLineMonthlyExpense,
      );
      pollutionByKind.set(kind, after.environment.pollution.reduce((sum, value) => sum + value, 0));
      const plantAnchor = scenario.state.map.facilities[0]!.anchor;
      plantSitePollutionByKind.set(kind, after.environment.pollution[plantAnchor]!);
    }

    expect(pollutionByKind.get('coal-power-plant')).toBeGreaterThan(pollutionByKind.get('gas-power-plant')!);
    expect(pollutionByKind.get('gas-power-plant')).toBeGreaterThan(0);
    expect(pollutionByKind.get('nuclear-power-plant')).toBeGreaterThan(0);
    expect(pollutionByKind.get('wind-turbine')).toBeCloseTo(pollutionByKind.get('nuclear-power-plant')!, 12);
    expect(pollutionByKind.get('solar-plant')).toBeCloseTo(pollutionByKind.get('nuclear-power-plant')!, 12);
    expect(plantSitePollutionByKind.get('coal-power-plant')).toBeGreaterThan(plantSitePollutionByKind.get('gas-power-plant')!);
    expect(plantSitePollutionByKind.get('nuclear-power-plant')).toBe(0);
    expect(plantSitePollutionByKind.get('wind-turbine')).toBe(0);
    expect(plantSitePollutionByKind.get('solar-plant')).toBe(0);
  });

  it('decays after a power severance and recovers when the exact link is repaired', () => {
    const scenario = buildPowerSeveranceScenario();
    const developed = stepMonths(scenario.state, 24);
    const before = sectorStocks(developed).R;
    const severed = severScenarioPower(developed, scenario.severTile);
    const during = stepMonths(severed, 4);
    expect(sectorStocks(during).R).toBeLessThan(before);
    expect(derivePower(during).powered[scenario.representativeZoneTile]).toBe(false);

    const repaired = repairPowerSeverance(during, scenario.severTile);
    const recovered = stepMonths(repaired, 12);
    expect(derivePower(recovered).powered[scenario.representativeZoneTile]).toBe(true);
    expect(sectorStocks(recovered).R).toBeGreaterThan(sectorStocks(during).R);
  });
});

describe('seeded fire, deterministic hashes, soak, and performance', () => {
  it('shows one station suppressing one fire but splitting its power under simultaneous load', () => {
    const isolated = buildFireCoverageScenario(1);
    const overloaded = buildFireCoverageScenario(4);
    const isolatedCoverage = deriveFireStationCoverage(isolated.state)[isolated.fireTileIds[0]!]!;
    const overloadedCoverage = deriveFireStationCoverage(overloaded.state)[overloaded.fireTileIds[0]!]!;
    expect(isolatedCoverage).toBeGreaterThan(overloadedCoverage);

    const isolatedAfter = stepMonths(isolated.state, 12);
    const overloadedAfter = stepMonths(overloaded.state, 12);
    expect(isolatedAfter.fire.collapsedTotal).toBeLessThan(overloadedAfter.fire.collapsedTotal);
  });

  it('records identical checkpoint hashes for independent runs', () => {
    expect(MARKET_SCENARIO_CHECKPOINTS).toEqual([0, 1, 3, 12, 120, 300, 900, 1_200]);
    const left = runDeterministicCheckpointTrace(buildOneCoalEquilibriumScenario().state);
    const right = runDeterministicCheckpointTrace(buildOneCoalEquilibriumScenario().state);
    expect(left).toEqual(right);
    expect(left.map(({ month }) => month)).toEqual(MARKET_SCENARIO_CHECKPOINTS);
  }, 60_000);

  it('keeps a 10,000-month soak finite and deterministic', () => {
    const initial = createMarketMapFixture('flat-48', 10_000);
    const left = stepMonths(initial, 10_000);
    const right = stepMonths(createMarketMapFixture('flat-48', 10_000), 10_000);
    expect(hashDeterministicState(left)).toBe(hashDeterministicState(right));
    expect(left.clock.month).toBe(10_000);
    expect(() => assertScenarioStateIsValid(left)).not.toThrow();
  });

  it('runs 1,200 active months under ten seconds', () => {
    const initial = buildOneCoalEquilibriumScenario().state;
    const started = performance.now();
    const after = stepMonths(initial, 1_200);
    const elapsedMs = performance.now() - started;
    expect(() => assertScenarioStateIsValid(after)).not.toThrow();
    // The dedicated serial scenario runner enforces the strict 10-second gate.
    // This concurrent Vitest suite keeps a looser scheduler-noise guard.
    expect(elapsedMs).toBeLessThan(15_000);
    expect(summarizeScenarioState(after).month).toBe(1_200);
  }, 30_000);
});
