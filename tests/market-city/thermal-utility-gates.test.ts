import { describe, expect, it } from 'vitest';

import {
  createMarketCityState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { derivePower } from '../../src/market-city/spatial';
import { deriveUtilities } from '../../src/market-city/utilities';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING,
  MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES,
  type MarketCityStateV2,
} from '../../src/market-city/types';

const SIZE = 48;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'thermal-utility-red',
    cityName: 'Thermal Utility Red',
    mayorName: 'Ada',
    seed: 215,
    createdAt: '2026-08-16T00:00:00.000Z',
  });
}

function solarWaterCoalCity(): MarketCityStateV2 {
  const state = city();
  state.map.facilities.push(
    { id: 'solar', kind: 'solar-plant', anchor: tile(5, 5), tiles: [tile(5, 5), tile(6, 5), tile(7, 5), tile(8, 5), tile(5, 6), tile(6, 6), tile(7, 6), tile(8, 6)] },
    { id: 'tower', kind: 'water-tower', anchor: tile(9, 5), tiles: [tile(9, 5), tile(10, 5), tile(9, 6), tile(10, 6)] },
    { id: 'coal', kind: 'coal-power-plant', anchor: tile(15, 5), tiles: [tile(15, 5), tile(16, 5), tile(15, 6), tile(16, 6), tile(15, 7), tile(16, 7)] },
  );
  state.map.roads[tile(9, 8)] = true;
  state.map.roads[tile(15, 8)] = true;
  for (let x = 9; x <= 16; x += 1) state.map.waterPipes[tile(x, 5)] = true;
  return state;
}

describe('thermal utility gates', () => {
  it('keeps renewables live without roads while thermal generation waits for water', () => {
    const state = city();
    state.map.facilities.push(
      { id: 'solar', kind: 'solar-plant', anchor: tile(2, 2), tiles: [tile(2, 2), tile(3, 2), tile(4, 2), tile(5, 2), tile(2, 3), tile(3, 3), tile(4, 3), tile(5, 3)] },
      { id: 'wind', kind: 'wind-turbine', anchor: tile(10, 2), tiles: [tile(10, 2)] },
      { id: 'coal', kind: 'coal-power-plant', anchor: tile(20, 2), tiles: [tile(20, 2), tile(21, 2), tile(20, 3), tile(21, 3), tile(20, 4), tile(21, 4)] },
    );
    state.map.roads[tile(20, 5)] = true;

    expect(derivePower(state).livePlantIds).toEqual(['solar', 'wind']);
  });

  it('boots thermal power from renewable-powered water infrastructure and reserves its heavy cooling draw', () => {
    const utilities = deriveUtilities(solarWaterCoalCity());

    expect(utilities.water.facilities).toContainEqual(expect.objectContaining({
      id: 'tower', roadAccess: true, powerAccess: true, operational: true,
    }));
    expect(utilities.water.thermalPlants).toContainEqual(expect.objectContaining({
      id: 'coal', demand: 2_400, waterAccess: true,
    }));
    expect(utilities.power.plantOperations).toContainEqual(expect.objectContaining({
      id: 'coal', roadAccess: true, waterAccess: true, waterDemand: 2_400, operational: true,
    }));
    expect(utilities.power.livePlantIds).toEqual(['solar', 'coal']);
    expect(utilities.water.service).toMatchObject({ totalDemand: 2_400, totalAllocated: 2_400 });
  });

  it('uses the existing prior-service then canonical-tile water queue for atomic thermal draws', () => {
    const state = solarWaterCoalCity();
    state.map.facilities = state.map.facilities.filter(({ id }) => id !== 'coal');
    state.map.facilities.push(
      { id: 'nuclear-a', kind: 'nuclear-power-plant', anchor: tile(15, 5), tiles: [tile(15, 5), tile(16, 5), tile(17, 5), tile(15, 6), tile(16, 6), tile(17, 6), tile(15, 7), tile(16, 7), tile(17, 7)] },
      { id: 'nuclear-b', kind: 'nuclear-power-plant', anchor: tile(24, 5), tiles: [tile(24, 5), tile(25, 5), tile(26, 5), tile(24, 6), tile(25, 6), tile(26, 6), tile(24, 7), tile(25, 7), tile(26, 7)] },
      { id: 'coal', kind: 'coal-power-plant', anchor: tile(33, 5), tiles: [tile(33, 5), tile(34, 5), tile(33, 6), tile(34, 6), tile(33, 7), tile(34, 7)] },
    );
    for (const x of [15, 24, 33]) state.map.roads[tile(x, 8)] = true;
    for (let x = 9; x <= 34; x += 1) state.map.waterPipes[tile(x, 5)] = true;

    const utilities = deriveUtilities(state);
    expect(utilities.water.thermalPlants.map(({ id, waterAccess }) => [id, waterAccess])).toEqual([
      ['nuclear-a', true],
      ['nuclear-b', true],
      ['coal', false],
    ]);
    expect(utilities.water.service).toMatchObject({ totalDemand: 21_600, totalAllocated: 19_200 });
    expect(utilities.power.livePlantIds).toEqual(['solar', 'nuclear-a', 'nuclear-b']);
  });

  it('migrates a 2.14 city through the rail release without changing player-authored shape or ledgers', () => {
    const state = solarWaterCoalCity();
    const utilities = deriveUtilities(state);
    state.environment.powered = utilities.power.powered;
    state.environment.watered = utilities.water.watered;
    state.services.water = utilities.water.service;
    const prior = JSON.parse(serializeMarketCityState(state)) as Record<string, unknown>;
    prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING;
    const before = structuredClone(prior);

    const migrated = restoreMarketCityState(prior);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(before.map);
    expect(migrated.economy).toEqual(before.economy);
    expect(deriveUtilities(migrated).power.plantOperations.find(({ id }) => id === 'coal')).toMatchObject({
      operational: true, waterDemand: 2_400,
    });
    expect(restoreMarketCityState(serializeMarketCityState(migrated))).toEqual(migrated);
  });

  it('migrates the direct 2.15 predecessor with the same pure thermal derivation', () => {
    const state = solarWaterCoalCity();
    const utilities = deriveUtilities(state);
    state.environment.powered = utilities.power.powered;
    state.environment.watered = utilities.water.watered;
    state.services.water = utilities.water.service;
    const prior = JSON.parse(serializeMarketCityState(state)) as Record<string, unknown>;
    prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES;

    const migrated = restoreMarketCityState(prior);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(prior.map);
    expect(migrated.economy).toEqual(prior.economy);
    expect(deriveUtilities(migrated).power.plantOperations.find(({ id }) => id === 'coal')).toMatchObject({
      operational: true, waterDemand: 2_400,
    });
  });
});
