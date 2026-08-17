import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { deriveMarketView, deriveTileInspection } from '../../src/market-city/queries';
import {
  deriveMarketDesirability,
  stepMonth,
  stepMonths,
} from '../../src/market-city/simulation';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { derivePower, deriveRoadAccess } from '../../src/market-city/spatial';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketCityStateV2,
} from '../../src/market-city/types';

function emptyState(): MarketCityStateV2 {
  const result = createMarketCityState({
      cityId: 'monthly-loop-test',
      cityName: 'Monthly Loop Test',
      mayorName: 'Test Mayor',
      seed: 42,
      createdAt: '2026-08-11T00:00:00.000Z',
  });
  result.clock.paused = false;
  return result;
}

function tile(x: number, y: number): number {
  return y * MARKET_CITY_MAP_SIZE + x;
}

function addCoalBootstrap(state: MarketCityStateV2, zone: 'R' | 'C' | 'I' = 'R'): number {
  state.map.facilities.push({
    id: 'solar-bootstrap', kind: 'solar-plant', anchor: tile(1, 5),
    tiles: [tile(1, 5), tile(2, 5), tile(3, 5), tile(4, 5), tile(1, 6), tile(2, 6), tile(3, 6), tile(4, 6)],
  });
  const plantTiles = [tile(5, 5), tile(6, 5), tile(5, 6), tile(6, 6), tile(5, 7), tile(6, 7)];
  state.map.facilities.push({
    id: 'coal-1',
    kind: 'coal-power-plant',
    anchor: plantTiles[0]!,
    tiles: plantTiles,
  });
  state.map.roads[tile(5, 8)] = true;
  state.map.facilities.push({
    id: 'tower-1', kind: 'water-tower', anchor: tile(7, 6),
    tiles: [tile(7, 6), tile(8, 6), tile(7, 7), tile(8, 7)],
  });
  state.map.waterPipes[tile(7, 7)] = true;
  const zonedTile = tile(5, 9);
  state.map.zones[zonedTile] = zone;
  return zonedTile;
}

describe('monthly deterministic market loop', () => {
  it('preserves desirability when the opening road and power fields are supplied', () => {
    const state = emptyState();
    addCoalBootstrap(state);

    expect(deriveMarketDesirability(
      state,
      deriveRoadAccess(state),
      derivePower(state).powered,
    )).toEqual(deriveMarketDesirability(state));
  });

  it('does not bootstrap RCI demand without a live plant', () => {
    const state = emptyState();
    state.map.zones[100] = 'R';
    state.map.zones[101] = 'C';
    state.map.zones[102] = 'I';

    const next = stepMonth(state);

    expect(next.clock.month).toBe(1);
    expect(next.economy.density[100]).toBe(0);
    expect(next.economy.density[101]).toBe(0);
    expect(next.economy.density[102]).toBe(0);
    expect(deriveMarketView(next).R.want).toBe(0);
  });

  it('bootstraps residential stock from live plant capacity', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);

    const next = stepMonth(state);

    expect(next.market.demand).toEqual({ R: 2.15, C: 0, I: 0 });
    expect(next.economy.density[residential]).toBeCloseTo(0.025, 12);
    expect(next.economy.wealth[residential]).toBeGreaterThan(0);
    expect(next.economy.lastRevenue).toBeCloseTo(
      next.economy.density[residential]!
        * 100
        * next.economy.wealth[residential]!
        * 0.025,
      10,
    );
    expect(deriveMarketView(next).R.bar).toBeGreaterThan(0);
  });

  it('redevelops an RCI zone after bulldozing its physical building', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);
    const developed = stepMonth(state);
    expect(developed.economy.density[residential]).toBeGreaterThan(0);

    const demolished = applyWorldCommand(developed, { type: 'demolish', tileIds: [residential] });
    expect(demolished.ok).toBe(true);
    expect(demolished.state.map.zones[residential]).toBe('R');
    expect(demolished.state.economy.density[residential]).toBe(0);

    const redeveloped = stepMonth(demolished.state);
    expect(redeveloped.map.zones[residential]).toBe('R');
    expect(redeveloped.economy.density[residential]).toBeGreaterThan(0);
  });

  it.each(['C', 'I'] as const)('%s-first zoning remains idle until residents exist', (zone) => {
    const state = emptyState();
    const zonedTile = addCoalBootstrap(state, zone);

    const next = stepMonth(state);

    expect(next.market.demand[zone]).toBe(0);
    expect(next.economy.density[zonedTile]).toBe(0);
  });

  it('uses opening RCI stock and live capacity in the exact demand equations', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);
    const commercial = tile(6, 9);
    const industrial = tile(7, 9);
    state.map.zones[commercial] = 'C';
    state.map.zones[industrial] = 'I';
    state.economy.density[residential] = 0.8;
    state.economy.density[commercial] = 0.4;
    state.economy.density[industrial] = 0.5;

    const next = stepMonth(state);

    expect(next.market.demand.R).toBeCloseTo(0.35 * 0.4 + 0.60 * 0.5 + 2.15, 12);
    expect(next.market.demand.C).toBeCloseTo(0.8, 12);
    expect(next.market.demand.I).toBeCloseTo(0.8, 12);
  });

  it('decays unserved occupancy by an absolute 0.05 and zeroes wealth at vacancy', () => {
    const state = emptyState();
    const occupied = tile(20, 20);
    state.map.zones[occupied] = 'R';
    state.economy.density[occupied] = 0.04;
    state.economy.wealth[occupied] = 10_000;

    const next = stepMonth(state);

    expect(next.economy.density[occupied]).toBe(0);
    expect(next.economy.wealth[occupied]).toBe(0);
  });

  it('clamps unserved density when rezoning lowers its local density cap', () => {
    const state = emptyState();
    const occupied = tile(20, 20);
    const residentialTiles = [occupied];
    for (let y = 17; y <= 23 && residentialTiles.length < 19; y += 1) {
      for (let x = 17; x <= 23 && residentialTiles.length < 19; x += 1) {
        const candidate = tile(x, y);
        if (candidate !== occupied) residentialTiles.push(candidate);
      }
    }
    for (const residential of residentialTiles) state.map.zones[residential] = 'R';
    state.economy.density[occupied] = 0.2;
    state.economy.wealth[occupied] = 10_000;

    const rezoned = applyWorldCommand(state, {
      type: 'dezone',
      tileIds: [residentialTiles.at(-1)!],
    });
    expect(rezoned.ok).toBe(true);

    const next = stepMonth(rezoned.state);

    expect(next.economy.density[occupied]).toBe(0.1);
    expect(deriveTileInspection(next, occupied).densityCap).toBe(0.1);
  });

  it('relaxes served growth at exactly 0.25 and served decline at exactly 0.08', () => {
    const growing = emptyState();
    const growingTile = addCoalBootstrap(growing);
    const grown = stepMonth(growing);
    const growthTarget = deriveTileInspection(grown, growingTile).targetDensity;
    expect(grown.economy.density[growingTile]).toBeCloseTo(0.25 * growthTarget, 12);

    const declining = emptyState();
    const decliningTile = addCoalBootstrap(declining, 'C');
    declining.economy.density[decliningTile] = 0.1;
    // C has no target stock without R, while the coal plant keeps it served;
    // this exercises the 0.08 market relaxation rather than unserved -.05.
    const declined = stepMonth(declining);
    const declineTarget = deriveTileInspection(declined, decliningTile).targetDensity;
    expect(declineTarget).toBeLessThan(0.1);
    expect(declined.economy.density[decliningTile]).toBeCloseTo(
      0.1 + 0.08 * (declineTarget - 0.1),
      12,
    );
  });

  it('computes congestion and pollution from opening density before current growth', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);
    const road = tile(5, 8);

    const first = stepMonth(state);
    expect(first.economy.density[residential]).toBeGreaterThan(0);
    expect(first.environment.congestion[road]).toBe(0);
    expect(first.environment.pollution[road]).toBe(0);

    const second = stepMonth(first);
    expect(second.environment.congestion[road]).toBeGreaterThan(0);
    expect(second.environment.pollution[road]).toBeGreaterThan(0);
  });

  it('advances fire after market growth in the same displayed month', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);
    state.economy.density[residential] = 0.1;
    state.economy.wealth[residential] = 10_000;
    state.fire.incidents.push({
      id: `fire-m1-t${residential}`,
      status: 'burning',
      tileIds: [residential],
      zone: 'R',
      startedMonth: 1,
      structure: {
        footprint: '1x1', originTile: residential, height: 1, roof: 'flat',
        roofHeight: 1, roofOrientation: 0, detail: null, color: [112, 204, 124], landmark: false,
      },
      intensity: 0.5,
      damage: 0,
      age: 0,
      rubbleMonthsRemaining: 0,
    });

    const targetBeforeFire = 0.1 + 0.25 * (0.1 - 0.1);
    const next = stepMonth(state);

    expect(next.fire.incidents[0]?.intensity).toBeGreaterThan(0.5);
    expect(next.economy.density[residential]).toBeLessThan(targetBeforeFire);
    expect(next.economy.density[residential]).toBeCloseTo(
      0.1 - 0.018 * next.fire.incidents[0]!.intensity,
      3,
    );
  });

  it('conserves a capacity-constrained sector target across all served lots', () => {
    const state = emptyState();
    const first = addCoalBootstrap(state);
    const second = tile(6, 9);
    state.map.zones[second] = 'R';

    const next = stepMonth(state);
    const firstInspection = deriveTileInspection(next, first);
    const secondInspection = deriveTileInspection(next, second);

    expect(firstInspection.targetDensity + secondInspection.targetDensity).toBeCloseTo(
      firstInspection.densityCap + secondInspection.densityCap,
      10,
    );
    expect(next.economy.density[first]! + next.economy.density[second]!).toBeCloseTo(0.05, 12);
  });

  it('slurps unmet stock demand into newly released served capacity', () => {
    const constrained = emptyState();
    const original = addCoalBootstrap(constrained);
    const saturated = stepMonths(constrained, 120);
    expect(saturated.economy.density[original]).toBeCloseTo(0.1, 6);

    const released = tile(6, 9);
    saturated.map.zones[released] = 'R';
    const afterRelease = stepMonth(saturated);

    expect(afterRelease.economy.density[original]).toBeCloseTo(0.1, 6);
    expect(afterRelease.economy.density[released]).toBeGreaterThan(0);
    expect(deriveTileInspection(afterRelease, original).targetDensity).toBeCloseTo(0.1, 10);
    expect(deriveTileInspection(afterRelease, released).targetDensity).toBeCloseTo(0.1, 10);
  });

  it('charges every placed asset monthly, permits a negative treasury, and uses no purchase gate', () => {
    const state = emptyState();
    addCoalBootstrap(state);
    state.map.powerLines[tile(4, 5)] = true;
    state.map.facilities.push({
      id: 'station-1',
      kind: 'fire-station',
      anchor: tile(10, 10),
      tiles: [tile(10, 10)],
    });

    const next = stepMonth(state);
    const expectedExpense = 1_293 + 431 + 431_000 + 25_860 + 120_000;

    expect(next.economy.lastOperatingExpense).toBe(expectedExpense);
    expect(next.economy.lastNet).toBeCloseTo(next.economy.lastRevenue - expectedExpense, 10);
    expect(next.economy.treasury).toBeLessThan(0);
  });

  it('aggregates mixed plant capacity and typed operating expense without load blackouts', () => {
    const state = emptyState();
    const kinds = [
      'coal-power-plant',
      'gas-power-plant',
      'nuclear-power-plant',
      'wind-turbine',
      'solar-plant',
    ] as const;
    kinds.forEach((kind, index) => {
      const plantTile = tile(4 + index * 2, 4);
      state.map.facilities.push({ id: `plant-${index}`, kind, anchor: plantTile, tiles: [plantTile] });
      state.map.roads[tile(4 + index * 2, 5)] = true;
    });
    state.map.facilities.push({
      id: 'mixed-water', kind: 'water-tower', anchor: tile(14, 4),
      tiles: [tile(14, 4), tile(15, 4), tile(14, 5), tile(15, 5)],
    });
    state.map.roads[tile(14, 7)] = true;
    state.map.powerLines[tile(13, 4)] = true;
    for (let x = 4; x <= 14; x += 1) state.map.waterPipes[tile(x, 4)] = true;

    const next = stepMonth(state);
    const view = deriveMarketView(next);

    expect(view.livePowerCapacity).toBe(1_200 + 900 + 4_800 + 60 + 90);
    expect(next.economy.lastOperatingExpense).toBe(
      5 * 1_293 + 431_000 + 603_400 + 1_724_000 + 25_860 + 25_860 + 1_293 + 431,
    );
    expect(view.powerHeadroom).toBe(1);
  });

  it('reports a constrained component even when disconnected global capacity leaves positive headroom', () => {
    const state = emptyState();
    const overloadedPlant = tile(2, 30);
    const sparePlant = tile(20, 30);
    state.map.facilities.push({
      id: 'overloaded-wind',
      kind: 'wind-turbine',
      anchor: overloadedPlant,
      tiles: [overloadedPlant],
    });
    state.map.facilities.push({
      id: 'spare-solar',
      kind: 'solar-plant',
      anchor: sparePlant,
      tiles: [sparePlant],
    });
    state.map.roads[tile(2, 31)] = true;
    state.map.roads[tile(20, 31)] = true;
    const industrial = [3, 4, 5, 6].map((x) => tile(x, 30));
    for (const consumer of industrial) {
      state.map.zones[consumer] = 'I';
      state.economy.density[consumer] = 1;
    }

    const view = deriveMarketView(state);
    const shedInspection = deriveTileInspection(state, industrial[3]!);

    expect(view.livePowerCapacity).toBe(150);
    expect(view.powerLoad).toBe(80);
    expect(view.powerHeadroom).toBeGreaterThan(0);
    expect(view.powerAllocatedLoad).toBe(60);
    expect(view.powerUnservedLoad).toBe(20);
    expect(view.powerConstrainedComponentCount).toBe(1);
    expect(shedInspection.powered).toBe(false);
    expect(shedInspection.powerComponentCapacity).toBe(60);
    expect(shedInspection.powerComponentDemand).toBe(80);
    expect(shedInspection.powerComponentAllocated).toBe(60);
    expect(shedInspection.powerComponentConstrained).toBe(true);
  });

  it.each([
    ['coal-power-plant', 1_200, 431_000],
    ['gas-power-plant', 900, 603_400],
    ['nuclear-power-plant', 4_800, 1_724_000],
    ['wind-turbine', 60, 25_860],
    ['solar-plant', 90, 25_860],
  ] as const)('matches the homogeneous Python plant probe for %s', (kind, capacity, expense) => {
    const state = emptyState();
    const plant = tile(8, 8);
    state.map.facilities.push({ id: 'homogeneous-plant', kind, anchor: plant, tiles: [plant] });
    state.map.roads[tile(8, 9)] = true;
    state.map.zones[tile(8, 10)] = 'R';
    const thermal = kind === 'coal-power-plant' || kind === 'gas-power-plant' || kind === 'nuclear-power-plant';
    if (thermal) {
      state.map.facilities.push(
        { id: 'homogeneous-solar', kind: 'solar-plant', anchor: tile(4, 8), tiles: [tile(4, 8)] },
        { id: 'homogeneous-water', kind: 'water-tower', anchor: tile(6, 8), tiles: [tile(6, 8), tile(7, 8), tile(6, 9), tile(7, 9)] },
      );
      state.map.roads[tile(6, 11)] = true;
      state.map.powerLines[tile(5, 8)] = true;
      for (let x = 6; x <= 8; x += 1) state.map.waterPipes[tile(x, 8)] = true;
    }

    const next = stepMonth(state);

    const bootstrapCapacity = thermal ? 90 : 0;
    const bootstrapExpense = thermal ? 25_860 : 0;
    expect(next.market.demand.R).toBe((capacity + bootstrapCapacity) / 600);
    expect(deriveMarketView(next).livePowerCapacity).toBe(capacity + bootstrapCapacity);
    expect(next.economy.lastOperatingExpense).toBe(
      expense + bootstrapExpense + (thermal ? 2 : 1) * 1_293 + (thermal ? 431 : 0),
    );
  });

  it('severs an unsupported lot and resumes growth after its bridge is repaired', () => {
    const state = emptyState();
    const residential = addCoalBootstrap(state);
    const developed = stepMonths(state, 8);
    const beforeSever = developed.economy.density[residential]!;
    developed.map.roads[tile(5, 8)] = false;

    const severed = stepMonth(developed);
    expect(severed.economy.density[residential]).toBeCloseTo(beforeSever - 0.05, 12);
    severed.map.roads[tile(5, 8)] = true;

    const repaired = stepMonth(severed);
    expect(repaired.economy.density[residential]).toBeGreaterThan(severed.economy.density[residential]!);
  });

  it('applies bounded decline to a shed consumer and restores its service with same-component capacity', () => {
    const state = emptyState();
    const plant = tile(2, 20);
    state.map.facilities.push({ id: 'wind', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
    state.map.facilities.push({
      id: 'tower', kind: 'water-tower', anchor: tile(2, 18),
      tiles: [tile(2, 18), tile(3, 18), tile(2, 19), tile(3, 19)],
    });
    const industrial = Array.from({ length: 40 }, (_, index) => tile(3 + index, 20));
    const residential = Array.from({ length: 4 }, (_, index) => tile(43 + index, 20));
    for (let x = 2; x <= 46; x += 1) state.map.roads[tile(x, 21)] = true;
    state.map.waterPipes[tile(2, 19)] = true;
    for (let x = 2; x <= 46; x += 1) state.map.waterPipes[tile(x, 20)] = true;
    for (const consumer of industrial) {
      state.map.zones[consumer] = 'I';
      state.economy.density[consumer] = 0.1;
      state.economy.wealth[consumer] = 10_000;
      state.environment.powered[consumer] = true;
    }
    for (const consumer of residential) {
      state.map.zones[consumer] = 'R';
      state.economy.density[consumer] = 1;
      state.economy.wealth[consumer] = 10_000;
      state.environment.powered[consumer] = true;
    }

    const constrained = stepMonth(state);
    const shed = industrial.find((consumer) => constrained.environment.powered[consumer] === false)!;
    const constrainedView = deriveMarketView(constrained);
    const shedInspection = deriveTileInspection(constrained, shed);

    expect(constrained.economy.density[shed]).toBeCloseTo(0.05, 12);
    expect(shedInspection.powerComponentConstrained).toBe(true);
    expect(constrainedView.powerUnservedLoad).toBeGreaterThan(0);
    expect(constrainedView.powerConstrainedComponentCount).toBe(1);

    const solar = tile(2, 19);
    constrained.map.facilities.push({ id: 'solar', kind: 'solar-plant', anchor: solar, tiles: [solar] });
    const restored = stepMonth(constrained);
    const restoredInspection = deriveTileInspection(restored, shed);

    expect(restoredInspection.powered).toBe(true);
    expect(restoredInspection.powerComponentId).not.toBeNull();
    expect(restoredInspection.powerComponentCapacity).toBe(150);
    expect(restoredInspection.powerComponentConstrained).toBe(false);
    expect(deriveMarketView(restored).powerUnservedLoad).toBe(0);
    expect(restored.economy.density[shed]).toBeGreaterThan(0);
    expect(restored.economy.density[shed]).toBeLessThanOrEqual(restoredInspection.densityCap);
  });

  it('does not mutate the input and is deterministic from the serialized state alone', () => {
    const left = emptyState();
    addCoalBootstrap(left);
    const untouched = structuredClone(left);
    const right = structuredClone(left);

    const leftResult = stepMonths(left, 24);
    const rightResult = stepMonths(right, 24);

    expect(left).toEqual(untouched);
    expect(hashDeterministicState(leftResult)).toBe(hashDeterministicState(rightResult));
  });

  it('derives current desirability without an unsaved cache', () => {
    const live = emptyState();
    addCoalBootstrap(live);
    const afterOne = stepMonth(live);
    const afterTwo = stepMonth(afterOne);
    const afterThree = stepMonth(afterTwo);
    const afterFour = stepMonth(afterThree);

    expect(deriveMarketDesirability(afterTwo)).not.toEqual(deriveMarketDesirability(afterOne));
    expect(deriveMarketDesirability(afterThree)).not.toEqual(deriveMarketDesirability(afterTwo));
    expect(deriveMarketDesirability(afterFour)).not.toEqual(deriveMarketDesirability(afterThree));
  });

  it('uses the same desirability authority before and after reload', () => {
    const live = emptyState();
    addCoalBootstrap(live);
    const afterOne = stepMonth(live);
    const serialized = serializeMarketCityState(afterOne);
    const restored = restoreMarketCityState(serialized);

    expect(serialized).not.toContain('desirabilityCache');
    expect(hashDeterministicState(restored)).toBe(hashDeterministicState(afterOne));
    expect(deriveMarketDesirability(restored)).toEqual(deriveMarketDesirability(afterOne));
    expect(hashDeterministicState(stepMonth(restored))).toBe(hashDeterministicState(stepMonth(afterOne)));
  });

  it('rejects invalid multi-month requests', () => {
    expect(() => stepMonths(emptyState(), -1)).toThrow(/non-negative integer/i);
    expect(() => stepMonths(emptyState(), 1.5)).toThrow(/non-negative integer/i);
  });
});
