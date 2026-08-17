import { describe, expect, it } from 'vitest';

import { deriveBuildingHeights } from '../../src/market-city/appearance';
import { derivePotentialFireCoverage } from '../../src/market-city/fire';
import { coordinateToIndex, solveMarketTargets } from '../../src/market-city/math';
import {
  createMarketCityState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { deriveDensityCaps, deriveDesirability } from '../../src/market-city/spatial';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2, type MarketFacility } from '../../src/market-city/types';

const tile = (x: number, y: number): number => coordinateToIndex(x, y, MARKET_CITY_MAP_SIZE);

function state(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'vertical-development',
    cityName: 'Vertical Development',
    mayorName: 'Test Mayor',
    seed: 45,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
}

function fireStation(id: string, anchor: number): MarketFacility {
  return { id, kind: 'fire-station', anchor, tiles: [anchor] };
}

/**
 * Power comes from the MAP, so flagging the persisted field is not enough: a
 * station needs a live plant it can actually draw from. One shared supply sits
 * on the west edge and runs a line to each station.
 */
function roadServeStation(value: MarketCityStateV2, anchor: number): void {
  const size = value.map.size;
  const x = anchor % size;
  const y = Math.floor(anchor / size);
  value.map.roads[tile(x + 3, y)] = true;
  // The supply sits directly BELOW the station so it conducts straight into it.
  // Running a line along the station's own row instead laid power over the very
  // zoned tiles these height assertions measure.
  const plant = tile(x, y + 1);
  const supplyId = `fixture-supply-${x}-${y}`;
  if (!value.map.facilities.some(({ id }) => id === supplyId)) {
    value.map.facilities.push({
      id: supplyId, kind: 'wind-turbine', anchor: plant,
      tiles: [plant],
    });
  }
}


/**
 * A snapshot that predates 2.10 has no crime record. These fixtures build one
 * from a CURRENT state and downgrade its rulesVersion, so the key has to come
 * back off or the legacy validator correctly rejects it.
 */
function stripCrime<T>(snapshot: T): T {
  delete (snapshot as { crime?: unknown }).crime;
  return snapshot;
}

describe('vertical development level persistence', () => {
  it('starts every new city at level one and migrates a 2.5 save without changing other state', () => {
    const opening = state();
    expect(opening.market.verticalDevelopmentLevel).toBe(1);

    const legacy = JSON.parse(serializeMarketCityState(opening)) as {
      rulesVersion: string;
      market: Record<string, unknown>;
    };
    legacy.rulesVersion = 'claude-market-2.5.0';
    stripCrime(legacy);
    delete legacy.market.verticalDevelopmentLevel;

    const migrated = restoreMarketCityState(legacy);
    expect(migrated.market.verticalDevelopmentLevel).toBe(1);
    expect(migrated.identity).toEqual(opening.identity);
    expect(migrated.map).toEqual(opening.map);
    expect(restoreMarketCityState(serializeMarketCityState(migrated)))
      .toEqual(migrated);
  });

  it('rejects non-integer and out-of-range stored levels', () => {
    const opening = state();
    const invalid = JSON.parse(serializeMarketCityState(opening)) as {
      market: Record<string, unknown>;
    };

    for (const level of [0, 11, 1.5, '2', null]) {
      invalid.market.verticalDevelopmentLevel = level;
      expect(() => restoreMarketCityState(invalid)).toThrow(/vertical.*level|integer|1.*10/i);
    }
  });
});

describe('vertical-development fire-cap matrix', () => {
  it('uses global level plus one road-served fire coverage bonus across R, C, and I', () => {
    const value = state();
    const covered = [tile(10, 10), tile(11, 10), tile(12, 10)] as const;
    const uncovered = tile(35, 35);
    value.map.zones[covered[0]] = 'R';
    value.map.zones[covered[1]] = 'C';
    value.map.zones[covered[2]] = 'I';
    value.map.zones[uncovered] = 'R';
    const stationAnchor = tile(16, 10);
    value.map.facilities.push(fireStation('served-fire', stationAnchor));
    roadServeStation(value, stationAnchor);

    const coverage = derivePotentialFireCoverage(value);
    expect(coverage[covered[0]]).toBeGreaterThan(0);
    const levelOne = deriveDensityCaps(value);
    for (const id of covered) {
      expect(levelOne.heightCaps[id]).toBe(2);
      expect(levelOne.densityCaps[id]).toBeCloseTo(0.2, 12);
    }
    expect(levelOne.heightCaps[uncovered]).toBe(1);
    expect(levelOne.densityCaps[uncovered]).toBeCloseTo(0.1, 12);

    value.market.verticalDevelopmentLevel = 10;
    const levelTen = deriveDensityCaps(value);
    for (const id of covered) {
      expect(levelTen.heightCaps[id]).toBe(10);
      expect(levelTen.densityCaps[id]).toBeCloseTo(1, 12);
    }
  });

  it('gives no bonus to a roadless station and never stacks overlapping stations', () => {
    const roadless = state();
    const target = tile(10, 10);
    const roadlessAnchor = tile(16, 10);
    roadless.map.zones[target] = 'R';
    roadless.map.facilities.push(fireStation('roadless-fire', roadlessAnchor));
    expect(derivePotentialFireCoverage(roadless)[target]).toBe(0);
    expect(deriveDensityCaps(roadless).heightCaps[target]).toBe(1);

    roadServeStation(roadless, roadlessAnchor);
    roadless.map.facilities.push(fireStation('overlap-fire', tile(15, 10)));
    roadServeStation(roadless, tile(15, 10));
    expect(derivePotentialFireCoverage(roadless)[target]).toBeGreaterThan(0);
    expect(deriveDensityCaps(roadless).heightCaps[target]).toBe(2);
  });

  it('does not let pollution or nearby same-sector zoning change a height cap, while pollution still lowers desirability', () => {
    const value = state();
    const target = tile(20, 20);
    value.map.zones[target] = 'R';
    const clearCap = deriveDensityCaps(value).heightCaps[target];

    for (let y = 12; y <= 28; y += 1) {
      for (let x = 12; x <= 28; x += 1) value.map.zones[tile(x, y)] = 'R';
    }
    const clearDesirability = deriveDesirability(value)[target];
    value.environment.pollution[target] = 100;

    expect(deriveDensityCaps(value).heightCaps[target]).toBe(clearCap);
    expect(deriveDesirability(value)[target]).toBeLessThan(clearDesirability!);
  });
});

describe('density-filled stories and demand clearing', () => {
  it('renders stories from filled density and the resolved cap, never desirability rank', () => {
    const value = state();
    value.market.verticalDevelopmentLevel = 10;
    const empty = tile(4, 4);
    const low = tile(8, 4);
    const taller = tile(12, 4);
    const capped = tile(16, 4);
    for (const id of [empty, low, taller, capped]) value.map.zones[id] = 'R';
    value.economy.density[empty] = 0.05;
    value.economy.density[low] = 0.06;
    value.economy.density[taller] = 0.58;
    value.economy.density[capped] = 0.97;

    const caps = deriveDensityCaps(value).densityCaps;
    caps[capped] = 0.4;
    const heights = deriveBuildingHeights(value, caps);
    expect(heights[empty]).toBe(0);
    expect(heights[low]).toBe(1);
    expect(heights[taller]).toBe(6);
    expect(heights[capped]).toBe(4);
  });

  it('clears unchanged demand into a taller protected site and can leave the weaker site empty', () => {
    const value = state();
    const stronger = tile(10, 10);
    const weaker = tile(30, 30);
    value.map.zones[stronger] = 'R';
    value.map.zones[weaker] = 'R';
    const demand = 0.2;
    const values = [0.9, 0.5];

    const withoutStation = deriveDensityCaps(value);
    const baseline = solveMarketTargets(
      values,
      [withoutStation.densityCaps[stronger]!, withoutStation.densityCaps[weaker]!],
      demand,
    );
    expect(baseline.targets).toEqual([0.1, 0.1]);

    const stationAnchor = tile(16, 10);
    value.map.facilities.push(fireStation('allocation-fire', stationAnchor));
    roadServeStation(value, stationAnchor);
    const withStation = deriveDensityCaps(value);
    const protectedTargets = solveMarketTargets(
      values,
      [withStation.densityCaps[stronger]!, withStation.densityCaps[weaker]!],
      demand,
    );

    expect(demand).toBe(0.2);
    expect(protectedTargets.targets).toEqual([0.2, 0]);
    expect(protectedTargets.targets.reduce((sum, density) => sum + density, 0)).toBe(demand);
  });
});
