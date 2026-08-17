import { describe, expect, it } from 'vitest';

import { stepMonth, stepMonths } from '../../src/market-city/simulation';
import {
  cachedManhattanKernel,
  cachedTilesWithinManhattan,
  tilesWithinManhattan,
} from '../../src/market-city/math';
import { deriveDensityCaps } from '../../src/market-city/spatial';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2 } from '../../src/market-city/types';
import { deriveWaterService } from '../../src/market-city/water';

function tile(x: number, y: number): number {
  return y * MARKET_CITY_MAP_SIZE + x;
}

function scenario(): MarketCityStateV2 {
  const state = createMarketCityState({ seed: 424_242 });
  state.clock.paused = false;
  const plantTiles = [tile(5, 5), tile(6, 5), tile(5, 6), tile(6, 6), tile(5, 7), tile(6, 7)];
  state.map.facilities.push({
    id: 'solar-bootstrap',
    kind: 'solar-plant',
    anchor: tile(1, 5),
    tiles: [tile(1, 5), tile(2, 5), tile(3, 5), tile(4, 5), tile(1, 6), tile(2, 6), tile(3, 6), tile(4, 6)],
  });
  state.map.facilities.push({
    id: 'coal-scenario',
    kind: 'coal-power-plant',
    anchor: plantTiles[0]!,
    tiles: plantTiles,
  });
  state.clock.fireDifficulty = 'easy';
  for (const y of [8, 15, 22, 29, 36]) {
    for (let x = 2; x <= 45; x += 1) state.map.roads[tile(x, y)] = true;
  }
  for (let y = 9; y <= 42; y += 1) {
    if ([15, 22, 29, 36].includes(y)) continue;
    for (let x = 2; x <= 45; x += 1) {
      state.map.zones[tile(x, y)] = x < 17 ? 'R' : x < 31 ? 'C' : 'I';
    }
  }
  state.map.facilities.push({
    id: 'water-scenario', kind: 'water-tower', anchor: tile(7, 5),
    tiles: [tile(7, 5), tile(8, 5), tile(7, 6), tile(8, 6)],
  });
  state.map.waterPipes.fill(true);
  const water = deriveWaterService(state);
  state.environment.watered = water.watered;
  state.services.water = water.service;
  return state;
}

describe('deterministic market scenarios', () => {
  it('uses an immutable geometry cache equivalent to the copy-safe public neighborhood', () => {
    const cached = cachedTilesWithinManhattan(tile(20, 20), 6, MARKET_CITY_MAP_SIZE);
    const copied = tilesWithinManhattan(tile(20, 20), 6, MARKET_CITY_MAP_SIZE);

    expect(cached).toEqual(copied);
    expect(Object.isFrozen(cached)).toBe(true);
    copied.pop();
    expect(cachedTilesWithinManhattan(tile(20, 20), 6, MARKET_CITY_MAP_SIZE)).toHaveLength(cached.length);
    expect(cachedManhattanKernel(tile(20, 20), 6, MARKET_CITY_MAP_SIZE).map((entry) => entry.tile))
      .toEqual(cached);
  });

  it('produces stable hashes and finite, capped state through 1,200 months', () => {
    const checkpoints = new Set([0, 1, 3, 12, 120, 300, 900, 1_200]);
    const hashes = new Map<number, string>();
    let state = scenario();

    for (let month = 0; month <= 1_200; month += 1) {
      if (checkpoints.has(month)) {
        hashes.set(month, hashDeterministicState(state));
        if (month < 1_200) {
          const restored = restoreMarketCityState(serializeMarketCityState(state));
          const liveNextHash = hashDeterministicState(stepMonth(state));
          const restoredNextHash = hashDeterministicState(stepMonth(restored));
          expect(liveNextHash).toBe(restoredNextHash);
        }
      }
      if (month === 1_200) break;
      state = stepMonth(state);
      const densityCaps = checkpoints.has(month + 1)
        ? deriveDensityCaps(state).densityCaps
        : null;
      let allFinite = true;
      let minimumDensity = Number.POSITIVE_INFINITY;
      let maximumCapExcess = Number.NEGATIVE_INFINITY;

      for (let tileId = 0; tileId < state.economy.density.length; tileId += 1) {
        const density = state.economy.density[tileId]!;
        allFinite &&= Number.isFinite(density)
          && Number.isFinite(state.economy.wealth[tileId]!)
          && Number.isFinite(state.environment.pollution[tileId]!);
        minimumDensity = Math.min(minimumDensity, density);
        if (densityCaps !== null && state.map.zones[tileId] !== null) {
          maximumCapExcess = Math.max(maximumCapExcess, density - densityCaps[tileId]!);
        }
      }
      expect(allFinite).toBe(true);
      expect(minimumDensity).toBeGreaterThanOrEqual(0);
      if (densityCaps !== null) expect(maximumCapExcess).toBeLessThanOrEqual(1e-12);
    }

    expect([...hashes.keys()]).toEqual([0, 1, 3, 12, 120, 300, 900, 1_200]);
    const stocks = { R: 0, C: 0, I: 0 };
    state.map.zones.forEach((zone, tileId) => {
      if (zone !== null) stocks[zone] += state.economy.density[tileId]!;
    });
    expect(stocks.R).toBeGreaterThan(35);
    expect(stocks.R).toBeLessThan(45);
    expect(stocks.C).toBeGreaterThan(35);
    expect(stocks.C).toBeLessThan(45);
    expect(stocks.I).toBeGreaterThan(35);
    expect(stocks.I).toBeLessThan(45);
  }, 60_000);

  it('steps a deterministic 10,000-month inert soak under the local 10-second gate', () => {
    const initial = createMarketCityState({ seed: 91 });
    const started = performance.now();
    const first = stepMonths(initial, 10_000);
    const elapsed = performance.now() - started;
    const second = stepMonths(createMarketCityState({ seed: 91 }), 10_000);

    expect(first.clock.month).toBe(10_000);
    expect(hashDeterministicState(first)).toBe(hashDeterministicState(second));
    expect(elapsed).toBeLessThan(10_000);
  });
});
