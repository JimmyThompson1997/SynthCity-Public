import { describe, expect, it } from 'vitest';

import {
  createMarketCityState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS,
  MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING,
  MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS,
  MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE,
  MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING,
  MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING,
  MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT,
  MARKET_CITY_RULES_VERSION_PRE_WASTE,
} from '../../src/market-city/types';

const SIZE = 48;
const TILE_COUNT = SIZE * SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function arrayFireSnapshot(format: 'v1' | 'v2.0'): Record<string, unknown> {
  const current = createMarketCityState({ cityId: `legacy-${format}` });
  const burningTile = tile(8, 8);
  current.clock.month = 12;
  current.map.zones[burningTile] = 'R';
  current.economy.density[burningTile] = 0.65;
  const intensity = Array<number>(TILE_COUNT).fill(0);
  const damage = Array<number>(TILE_COUNT).fill(0);
  const age = Array<number>(TILE_COUNT).fill(0);
  intensity[burningTile] = 0.7;
  damage[burningTile] = 1.25;
  age[burningTile] = 3;
  const fire = { intensity, damage, age, char: current.fire.char, collapsedTotal: 2 };
  if (format === 'v2.0') {
    return stripCrime({ ...current, rulesVersion: 'claude-market-2.0.0', fire });
  }
  const { avenueLanes: _avenues, avenueTravelMasks: _travel, avenuePairMasks: _pairs, avenueMedianMasks: _medians,
    rails: _rails, railConnectionMasks: _railMasks, waterPipes: _pipes,
    landfillZones: _landfill, ...v1Map } = current.map;
  const { watered: _watered, ...v1Environment } = current.environment;
  const { services: _services, crime: _crime, ...v1State } = current;
  return {
    ...v1State,
    schemaVersion: 1,
    rulesVersion: 'claude-market-1.0.0',
    map: v1Map,
    environment: v1Environment,
    fire,
  };
}

/**
 * A snapshot that predates 2.10 has no crime record at all. The fixtures build
 * one from a CURRENT state and then downgrade its rulesVersion, so the key has
 * to come back off or the legacy validator correctly rejects it.
 */
function stripCrime<T>(snapshot: T): T {
  delete (snapshot as { crime?: unknown }).crime;
  return snapshot;
}


describe('MarketCityStateV2 incompatible building-fire cutover', () => {
  it('creates the expanded schema-2 state with incident fire and empty service scaffolding', () => {
    const state = createMarketCityState({ cityId: 'v2-fire-city' });

    expect(state).toMatchObject({
      schemaVersion: 2,
      rulesVersion: MARKET_CITY_RULES_VERSION,
      fire: { incidents: [], collapsedTotal: 0, suppressedTotal: 0, history: [] },
      services: {
        water: { components: [], totalDemand: 0, totalAllocated: 0 },
        rail: { totalRidership: 0, stationUsage: [] },
        waste: {
          generatedThisMonth: 0,
          generatedLifetime: 0,
          landfilledThisMonth: 0,
          landfilledLifetime: 0,
          unmanagedThisMonth: 0,
          unmanagedLifetime: 0,
        },
      },
    });
    for (const layer of [
      state.map.avenueLanes,
      state.map.rails,
      state.map.waterPipes,
      state.map.landfillZones,
      state.environment.watered,
    ]) {
      expect(layer).toHaveLength(TILE_COUNT);
      expect(layer.every((value) => value === false)).toBe(true);
    }
    expect(state.fire.char).toHaveLength(TILE_COUNT);
  });

  it.each(['v1', 'v2.0'] as const)('purely migrates strict %s array-fire snapshots to 2.1 incidents', (format) => {
    const legacy = arrayFireSnapshot(format);
    const before = structuredClone(legacy);
    const migrated = restoreMarketCityState(legacy);
    const burningTile = tile(8, 8);

    expect(legacy).toEqual(before);
    expect(migrated).toMatchObject({
      schemaVersion: 2,
      rulesVersion: MARKET_CITY_RULES_VERSION,
      identity: { cityId: `legacy-${format}` },
      fire: { collapsedTotal: 2, suppressedTotal: 0 },
    });
    expect(migrated.fire.incidents).toEqual([
      expect.objectContaining({
        id: `fire-m9-t${burningTile}`,
        status: 'burning',
        tileIds: [burningTile],
        zone: 'R',
        startedMonth: 9,
        intensity: 0.7,
        damage: 1.25,
        age: 3,
        structure: expect.objectContaining({ footprint: '1x1', originTile: burningTile }),
      }),
    ]);
    expect(migrated.fire.history.filter((entry) => entry.event === 'collapsed')).toHaveLength(2);
    expect(validateMarketCityState(migrated)).toEqual(migrated);
    expect(restoreMarketCityState(migrated)).toEqual(migrated);
  });

  it('rejects malformed and unknown legacy fields instead of normalizing them', () => {
    const unknown = arrayFireSnapshot('v2.0');
    (unknown.fire as Record<string, unknown>).runtimeCache = [];
    expect(() => restoreMarketCityState(unknown)).toThrow(/fire.*unexpected/i);

    const malformed = arrayFireSnapshot('v1');
    ((malformed.fire as Record<string, unknown>).intensity as number[]).pop();
    expect(() => restoreMarketCityState(malformed)).toThrow(/intensity.*2304/i);

    const unsupported = arrayFireSnapshot('v2.0');
    // Left with its crime record on purpose: this asserts the VERSION is
    // rejected, so it must not trip the key check first.
    unsupported.rulesVersion = 'claude-market-2.0.1';
    expect(() => restoreMarketCityState(unsupported)).toThrow(/rulesVersion/i);

    const accessor = arrayFireSnapshot('v1');
    const originalFire = accessor.fire as Record<string, unknown>;
    Object.defineProperty(originalFire, 'intensity', {
      enumerable: true,
      get: () => Array<number>(TILE_COUNT).fill(0),
    });
    expect(() => restoreMarketCityState(accessor)).toThrow(/fire\.intensity.*data property/i);
  });

  it('round-trips only the exact current state and rejects hidden runtime fields', () => {
    const current = createMarketCityState();
    expect(restoreMarketCityState(serializeMarketCityState(current))).toEqual(current);
    expect(() => validateMarketCityState({ ...current, desirabilityCache: [] })).toThrow(/unexpected key/i);
    expect(() => validateMarketCityState({ ...current, heightDebug: { mode: 'uniform' } })).toThrow(/unexpected key/i);
    expect(serializeMarketCityState(current)).not.toMatch(/desirabilityCache|heightDebug/);
  });

  it('purely migrates the immediate pre-waste rules version while preserving a valid nonzero garbage ledger', () => {
    const legacy = createMarketCityState({ cityId: 'pre-waste-ledger' });
    const landfill = tile(12, 12);
    legacy.map.landfillZones[landfill] = true;
    legacy.services.waste = {
      generatedThisMonth: 80,
      generatedLifetime: 180,
      landfilledThisMonth: 50,
      landfilledLifetime: 150,
      unmanagedThisMonth: 30,
      unmanagedLifetime: 30,
      storedByTile: legacy.services.waste.storedByTile.map((_, id) => id === landfill ? 150 : 0),
    };
    const snapshot = structuredClone(legacy) as unknown as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_WASTE;
    stripCrime(snapshot);
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);
    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map.landfillZones[landfill]).toBe(true);
    expect(migrated.services.waste).toMatchObject({
      generatedThisMonth: 80, generatedLifetime: 180,
      landfilledThisMonth: 50, landfilledLifetime: 150,
      unmanagedThisMonth: 30, unmanagedLifetime: 30,
    });
    expect(migrated.services.waste.storedByTile[landfill]).toBe(150);
  });

  it('purely migrates the immediate pre-fire-radius rules version without changing city data', () => {
    const legacy = createMarketCityState({ cityId: 'pre-fire-radius' });
    const anchor = tile(24, 24);
    legacy.map.facilities.push({ id: 'legacy-fire-station', kind: 'fire-station', anchor, tiles: [anchor] });
    legacy.map.roads[tile(24, 25)] = true;
    legacy.economy.treasury = 12_345.67;
    const landfill = tile(6, 6);
    legacy.map.landfillZones[landfill] = true;
    legacy.services.waste = {
      generatedThisMonth: 80,
      generatedLifetime: 180,
      landfilledThisMonth: 50,
      landfilledLifetime: 150,
      unmanagedThisMonth: 30,
      unmanagedLifetime: 30,
      storedByTile: legacy.services.waste.storedByTile.map((_, id) => id === landfill ? 150 : 0),
    };
    const snapshot = JSON.parse(serializeMarketCityState(legacy)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS;
    stripCrime(snapshot);
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.schemaVersion).toBe(legacy.schemaVersion);
    expect(migrated.map.facilities).toEqual(legacy.map.facilities);
    expect(migrated.map.roads[tile(24, 25)]).toBe(true);
    expect(migrated.economy).toEqual(legacy.economy);
    expect(migrated.services.waste).toEqual(legacy.services.waste);
    expect(migrated).toEqual(legacy);
    expect(validateMarketCityState(migrated)).toEqual(migrated);
  });

  it('purely migrates the immediate pre-road-power-crossing rules version without changing city data', () => {
    const legacy = createMarketCityState({ cityId: 'pre-road-power-crossing' });
    const roadTile = tile(20, 24);
    legacy.map.roads[roadTile] = true;
    legacy.map.powerLines[tile(20, 23)] = true;
    legacy.map.powerLines[tile(20, 25)] = true;
    legacy.economy.treasury = 12_345.67;
    const snapshot = JSON.parse(serializeMarketCityState(legacy)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING;
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(legacy.map);
    expect(migrated.economy).toEqual(legacy.economy);
    expect(validateMarketCityState(migrated)).toEqual(migrated);
  });

  it('purely migrates the immediate pre-rail-power-crossing rules version without changing city data', () => {
    const legacy = createMarketCityState({ cityId: 'pre-rail-power-crossing' });
    const railTile = tile(20, 24);
    legacy.map.rails[railTile] = true;
    legacy.map.railConnectionMasks[railTile] = 0;
    legacy.map.powerLines[tile(20, 23)] = true;
    legacy.economy.treasury = 54_321.25;
    const snapshot = JSON.parse(serializeMarketCityState(legacy)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING;
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(legacy.map);
    expect(migrated.economy).toEqual(legacy.economy);
    expect(validateMarketCityState(migrated)).toEqual(migrated);
  });

  it('chains the 2.12 police-funding save through the Road/Power rules migration without changing its map', () => {
    const legacy = createMarketCityState({ cityId: 'pre-road-power-funding-chain' });
    const roadTile = tile(20, 24);
    legacy.map.roads[roadTile] = true;
    legacy.map.powerLines[tile(20, 23)] = true;
    legacy.crime.funding = 0;
    const snapshot = JSON.parse(serializeMarketCityState(legacy)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING;
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(legacy.map);
    expect(migrated.crime.funding).toBe(0);
    expect(validateMarketCityState(migrated)).toEqual(migrated);
  });

  it('purely migrates the fire-release rules version without changing city shape, ledgers, or schema', () => {
    const legacy = createMarketCityState({ cityId: 'pre-landfill-road-gate' });
    const landfill = tile(16, 16);
    legacy.map.landfillZones[landfill] = true;
    legacy.services.waste = {
      generatedThisMonth: 100,
      generatedLifetime: 300,
      landfilledThisMonth: 100,
      landfilledLifetime: 200,
      unmanagedThisMonth: 0,
      unmanagedLifetime: 100,
      storedByTile: legacy.services.waste.storedByTile.map((_, id) => id === landfill ? 200 : 0),
    };
    const snapshot = JSON.parse(serializeMarketCityState(legacy)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE;
    stripCrime(snapshot);
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.schemaVersion).toBe(legacy.schemaVersion);
    expect(migrated.map).toEqual(legacy.map);
    expect(migrated.economy).toEqual(legacy.economy);
    expect(migrated.services).toEqual(legacy.services);
    expect(migrated).toEqual(legacy);
  });

  it('migrates a pre-4×2 Solar lot without overwriting later map occupants', () => {
    const current = createMarketCityState({ cityId: 'pre-solar-footprint' });
    const anchor = tile(10, 10);
    // These roads occupy the two columns that a blind rightward expansion
    // would overwrite. The old Solar array occupied only the first 2×2 lot.
    current.map.roads[tile(12, 10)] = true;
    current.map.roads[tile(13, 10)] = true;
    const snapshot = JSON.parse(serializeMarketCityState(current)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT;
    stripCrime(snapshot);
    delete (snapshot.map as Record<string, unknown>).avenueMedianMasks;
    (snapshot.map as { facilities: unknown[] }).facilities = [{
      id: 'legacy-solar', kind: 'solar-plant', anchor,
      tiles: [tile(10, 10), tile(11, 10), tile(10, 11), tile(11, 11)],
    }];
    const before = structuredClone(snapshot);

    const migrated = restoreMarketCityState(snapshot);

    expect(snapshot).toEqual(before);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map.roads[tile(12, 10)]).toBe(true);
    expect(migrated.map.roads[tile(13, 10)]).toBe(true);
    expect(migrated.map.facilities).toEqual([{
      id: 'legacy-solar', kind: 'solar-plant', anchor,
      tiles: [tile(10, 10), tile(11, 10), tile(10, 11), tile(11, 11)],
    }]);
    expect(restoreMarketCityState(serializeMarketCityState(migrated))).toEqual(migrated);
  });

  it('migrates existing Avenue pair markings into durable median paint', () => {
    const current = createMarketCityState({ cityId: 'pre-avenue-median' });
    const first = tile(10, 10);
    const second = tile(10, 9);
    current.map.avenueLanes[first] = true;
    current.map.avenueLanes[second] = true;
    current.map.avenuePairMasks[first] = 1;
    current.map.avenuePairMasks[second] = 4;
    const snapshot = JSON.parse(serializeMarketCityState(current)) as Record<string, unknown>;
    snapshot.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS;
    stripCrime(snapshot);
    delete (snapshot.map as Record<string, unknown>).avenueMedianMasks;

    const migrated = restoreMarketCityState(snapshot);

    expect(migrated.map.avenueMedianMasks[first]).toBe(1);
    expect(migrated.map.avenueMedianMasks[second]).toBe(4);
  });

  it('rejects dangling topology masks and waste stored outside landfill cells', () => {
    const rail = createMarketCityState();
    rail.map.rails[tile(5, 5)] = true;
    rail.map.railConnectionMasks[tile(5, 5)] = 2;
    expect(() => validateMarketCityState(rail)).toThrow(/railConnectionMasks/i);

    const avenue = createMarketCityState();
    avenue.map.avenueLanes[tile(8, 8)] = true;
    avenue.map.avenuePairMasks[tile(8, 8)] = 4;
    expect(() => validateMarketCityState(avenue)).toThrow(/avenuePairMasks/i);

    const waste = createMarketCityState();
    waste.services.waste.storedByTile[tile(9, 9)] = 1;
    expect(() => validateMarketCityState(waste)).toThrow(/storedByTile.*landfill/i);
  });

  it('rejects noncanonical derived water and active passenger-rail service state', () => {
    const water = createMarketCityState();
    const pipe = tile(4, 4);
    water.map.waterPipes[pipe] = true;
    water.services.water.componentByTile[pipe] = `water:${pipe}`;
    water.services.water.components.push({
      id: `water:${pipe}`,
      rawCapacity: 20_000,
      treatmentCapacity: 20_000,
      usableCapacity: 40_000,
      demand: 5,
      allocated: 5,
    });
    water.services.water.totalDemand = 5;
    water.services.water.totalAllocated = 5;
    expect(() => validateMarketCityState(water)).toThrow(/canonical water derivation/i);

    const rail = createMarketCityState();
    rail.services.rail.totalRidership = 10;
    expect(() => validateMarketCityState(rail)).toThrow(/rail/i);
  });
});
