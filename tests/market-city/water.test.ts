import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { MARKET_FACILITY_CATALOG, MARKET_NETWORK_CATALOG } from '../../src/market-city/catalog';
import { MARKET_ITEM_MANIFEST } from '../../src/market-city/item-manifest';
import { stepMonth } from '../../src/market-city/simulation';
import {
  createMarketCityState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import { deriveWaterService, reconcileWaterService } from '../../src/market-city/water';
import {
  MARKET_CITY_MAP_SIZE,
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_WATER,
  type MarketCityStateV2,
} from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'water-core', cityName: 'Water Core', mayorName: 'Ada', seed: 211,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
}

function addLiveCoalAndWaterPower(state: MarketCityStateV2, waterAnchor = tile(9, 4)): void {
  state.map.facilities.push({
    id: 'wind-bootstrap', kind: 'wind-turbine', anchor: tile(4, 4),
    tiles: [tile(4, 4)],
  });
  const end = waterAnchor % SIZE;
  for (let x = 5; x < end; x += 1) state.map.powerLines[tile(x, 4)] = true;
}

function addTower(state: MarketCityStateV2, x = 9, y = 4, id = 'tower'): void {
  state.map.facilities.push({
    id, kind: 'water-tower', anchor: tile(x, y),
    tiles: [tile(x, y), tile(x + 1, y), tile(x, y + 1), tile(x + 1, y + 1)],
  });
}

function addTrainStation(state: MarketCityStateV2, x: number, y: number, id = 'station'): number[] {
  const tiles = [tile(x, y), tile(x + 1, y), tile(x, y + 1), tile(x + 1, y + 1)];
  state.map.facilities.push({ id, kind: 'train-station', anchor: tiles[0]!, tiles });
  return tiles;
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

describe('Water catalog and manifest contracts', () => {
  it('activates the pipe and all three zero-cost Water facilities with frozen values', () => {
    expect(MARKET_NETWORK_CATALOG['water-pipe']).toMatchObject({
      category: 'utilities', footprint: { width: 1, height: 1 }, monthlyMaintenancePerTile: 0,
    });
    expect(MARKET_FACILITY_CATALOG['water-tower']).toMatchObject({
      category: 'water', footprint: { width: 2, height: 2 }, monthlyMaintenance: 0,
      operatingCapacity: 20_000,
    });
    expect(MARKET_FACILITY_CATALOG['coastal-water-pump']).toMatchObject({
      category: 'water', footprint: { width: 3, height: 3 }, operatingCapacity: 75_000,
    });
    expect(MARKET_FACILITY_CATALOG['water-treatment-plant']).toMatchObject({
      category: 'water', footprint: { width: 4, height: 3 }, operatingCapacity: 50_000,
    });
    for (const id of ['water-pipe', 'water-tower', 'coastal-water-pump', 'water-treatment-plant']) {
      expect(MARKET_ITEM_MANIFEST.find((item) => item.id === id)?.status).toBe('active');
    }
  });
});

describe('Water pipe command and underground demolition', () => {
  it('coexists below every surface layer, persists, and is removed only by underground demolition', () => {
    let state = city();
    const target = tile(12, 12);
    state.map.zones[target] = 'R';
    let result = applyWorldCommand(state, { type: 'place-water-pipe', tileIds: [target] });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.map.zones[target]).toBe('R');
    expect(state.map.waterPipes[target]).toBe(true);

    result = applyWorldCommand(state, { type: 'demolish', tileIds: [target] });
    expect(result.ok).toBe(true);
    expect(result.state.map.zones[target]).toBe('R');
    expect(result.state.map.waterPipes[target]).toBe(true);

    result = applyWorldCommand(result.state, { type: 'demolish', tileIds: [target], layer: 'underground' });
    expect(result.ok).toBe(true);
    expect(result.state.map.waterPipes[target]).toBe(false);
    expect(restoreMarketCityState(serializeMarketCityState(result.state))).toEqual(result.state);
  });

  it('rejects wet placement and rejects flooding over a pipe atomically', () => {
    const wet = city();
    wet.map.terrain.water[tile(3, 3)] = true;
    expect(applyWorldCommand(wet, {
      type: 'place-water-pipe', tileIds: [tile(3, 3)],
    })).toMatchObject({ ok: false, state: wet, changedTileIds: [] });

    const placed = applyWorldCommand(city(), {
      type: 'place-water-pipe', tileIds: [tile(4, 4)],
    });
    expect(placed.ok).toBe(true);
    const flooded = applyWorldCommand(placed.state, {
      type: 'paint-terrain', tileIds: [tile(4, 4)], water: true,
    });
    expect(flooded).toMatchObject({ ok: false, state: placed.state, changedTileIds: [] });
    expect(flooded.reason).toMatch(/pipe.*water|water.*pipe/i);
  });
});

describe('Water facility operation and component-local capacity', () => {
  it('requires road, a live power component, and an attached pipe; accepts an Avenue road surface', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state);
    state.map.waterPipes[tile(9, 4)] = true;
    state.map.avenueLanes[tile(9, 7)] = true;
    const result = deriveWaterService(state);
    expect(result.facilities).toEqual([expect.objectContaining({
      id: 'tower', roadAccess: true, powerAccess: true, pipeAccess: true,
      componentId: `water:${tile(9, 4)}`, operational: true, inactiveReason: null,
      rawCapacity: 20_000, treatmentCapacity: 0,
    })]);

    const withoutLivePower = city();
    addTower(withoutLivePower);
    withoutLivePower.map.waterPipes[tile(9, 4)] = true;
    withoutLivePower.map.roads[tile(9, 7)] = true;
    expect(deriveWaterService(withoutLivePower).facilities[0]).toMatchObject({
      roadAccess: true, powerAccess: false, pipeAccess: true, operational: false,
    });
  });

  it('covers source-fed pipes at Manhattan seven but not eight', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state);
    state.map.roads[tile(9, 7)] = true;
    state.map.waterPipes[tile(9, 4)] = true;
    const seven = tile(16, 4);
    const eight = tile(17, 4);
    state.map.zones[seven] = 'R';
    state.map.zones[eight] = 'R';
    const result = deriveWaterService(state);
    expect(result.coverageByTile[seven]).toBe(`water:${tile(9, 4)}`);
    expect(result.watered[seven]).toBe(true);
    expect(result.coverageByTile[eight]).toBeNull();
    expect(result.watered[eight]).toBe(false);
  });

  it('adds treatment only to raw water and never creates water by itself', () => {
    const state = city();
    addLiveCoalAndWaterPower(state, tile(14, 4));
    state.map.roads[tile(9, 7)] = true;
    state.map.roads[tile(14, 7)] = true;
    addTower(state);
    state.map.facilities.push({
      id: 'treatment', kind: 'water-treatment-plant', anchor: tile(14, 4),
      tiles: [tile(14, 4), tile(15, 4), tile(16, 4), tile(17, 4), tile(14, 5), tile(15, 5),
        tile(16, 5), tile(17, 5), tile(14, 6), tile(15, 6), tile(16, 6), tile(17, 6)],
    });
    for (let x = 9; x <= 14; x += 1) state.map.waterPipes[tile(x, 4)] = true;
    const component = deriveWaterService(state).components[0];
    expect(component).toMatchObject({ rawCapacity: 20_000, treatmentCapacity: 50_000, usableCapacity: 40_000 });

    state.map.facilities = state.map.facilities.filter(({ kind }) => kind !== 'water-tower');
    expect(deriveWaterService(state).components[0]).toMatchObject({
      rawCapacity: 0, treatmentCapacity: 50_000, usableCapacity: 0,
    });
  });

  it('rejects an inland coastal pump and leaves a placed pump inactive after shoreline removal', () => {
    const inland = applyWorldCommand(city(), {
      type: 'place-facility', kind: 'coastal-water-pump', anchor: tile(10, 10),
    });
    expect(inland).toMatchObject({ ok: false, changedTileIds: [] });
    expect(inland.reason).toMatch(/shore|coast|water/i);

    const coast = city();
    coast.map.terrain.water[tile(9, 10)] = true;
    const placed = applyWorldCommand(coast, {
      type: 'place-facility', kind: 'coastal-water-pump', anchor: tile(10, 10),
    });
    expect(placed.ok).toBe(true);
    placed.state.map.terrain.water[tile(9, 10)] = false;
    expect(deriveWaterService(placed.state).facilities[0]).toMatchObject({
      kind: 'coastal-water-pump', shoreline: false, operational: false,
    });
  });

  it('assigns overlapping coverage by nearest pipe then canonical component id', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state, 9, 4, 'tower-a');
    addTower(state, 13, 4, 'tower-b');
    state.map.roads[tile(9, 7)] = true;
    state.map.roads[tile(13, 7)] = true;
    state.map.waterPipes[tile(9, 4)] = true;
    state.map.waterPipes[tile(13, 4)] = true;
    const tie = tile(11, 4);
    state.map.zones[tie] = 'I';
    expect(deriveWaterService(state).coverageByTile[tie]).toBe(`water:${tile(9, 4)}`);
  });
});

describe('Water allocation, simulation, and persistence', () => {
  it('allocates each Train Station as one ordinary 50-water consumer and recovers atomically', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state);
    state.map.roads[tile(9, 7)] = true;
    const stationTiles = addTrainStation(state, 20, 20);
    state.map.roads[tile(20, 19)] = true;
    state.map.waterPipes.fill(true);

    const protectedTiles = new Set<number>([
      ...state.map.facilities.flatMap((facility) => facility.tiles),
      ...state.map.roads.map((road, tileId) => road ? tileId : -1).filter((tileId) => tileId >= 0),
    ]);
    const industrial: number[] = [];
    for (let tileId = 0; tileId < tile(20, 20) && industrial.length < 400; tileId += 1) {
      if (protectedTiles.has(tileId)) continue;
      state.map.zones[tileId] = 'I';
      state.economy.density[tileId] = 1;
      industrial.push(tileId);
    }
    expect(industrial).toHaveLength(400);

    let water = deriveWaterService(state);
    expect(water.service).toMatchObject({ totalDemand: 20_050, totalAllocated: 20_000 });
    expect(water.components[0]).toMatchObject({ demand: 20_050, allocated: 20_000, usableCapacity: 20_000 });
    expect(stationTiles.every((cell) => !water.watered[cell])).toBe(true);

    const released = industrial.pop()!;
    state.map.zones[released] = null;
    state.economy.density[released] = 0;
    water = deriveWaterService(state);
    expect(water.service).toMatchObject({ totalDemand: 20_000, totalAllocated: 20_000 });
    expect(stationTiles.every((cell) => water.watered[cell])).toBe(true);
  });

  it('allocates all-or-nothing by previously watered consumer then stable tile id', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state);
    state.map.roads[tile(9, 7)] = true;
    // A connected, map-spanning pipe grid makes more industrial demand than one tower can serve.
    for (let y = 0; y < SIZE; y += 1) {
      for (let x = 0; x < SIZE; x += 1) state.map.waterPipes[tile(x, y)] = true;
    }
    const consumers: number[] = [];
    for (let id = 0; id < state.map.zones.length && consumers.length < 401; id += 1) {
      if (state.map.facilities.some(({ tiles }) => tiles.includes(id))) continue;
      state.map.zones[id] = 'I';
      state.economy.density[id] = 1;
      consumers.push(id);
    }
    const prior = consumers[400]!;
    state.environment.watered[prior] = true;
    const result = deriveWaterService(state);
    expect(result.service.totalDemand).toBe(20_050);
    expect(result.service.totalAllocated).toBe(20_000);
    expect(result.watered[prior]).toBe(true);
    expect(result.watered[consumers[399]!]).toBe(false);
  });

  it('requires water for all RCI growth and applies the existing bounded decline when water is lost', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    const zoned = tile(9, 8);
    state.map.roads[tile(9, 7)] = true;
    state.map.zones[zoned] = 'R';
    for (let y = 4; y <= 8; y += 1) state.map.powerLines[tile(8, y)] = true;
    state.economy.density[zoned] = 0.1;
    state.economy.wealth[zoned] = 10_000;
    const dry = stepMonth(state);
    expect(dry.environment.roadAccess[zoned]).toBe(true);
    expect(dry.environment.powered[zoned]).toBe(true);
    expect(dry.environment.watered[zoned]).toBe(false);
    expect(dry.economy.density[zoned]).toBeCloseTo(0.05, 12);

    addTower(state);
    state.map.waterPipes[tile(9, 4)] = true;
    const wet = stepMonth(state);
    expect(wet.environment.watered[zoned]).toBe(true);
    expect(wet.economy.density[zoned]).not.toBeCloseTo(0.05, 12);
  });

  it('reconciles closing water demand without changing canonical topology or allocation', () => {
    const state = city();
    addLiveCoalAndWaterPower(state);
    addTower(state);
    const zoned = tile(9, 8);
    state.map.roads[tile(9, 7)] = true;
    state.map.zones[zoned] = 'R';
    state.economy.density[zoned] = 0.4;
    state.economy.wealth[zoned] = 10_000;
    for (let y = 4; y <= 8; y += 1) state.map.powerLines[tile(8, y)] = true;
    state.map.waterPipes[tile(9, 4)] = true;

    const opening = deriveWaterService(state);
    state.environment.watered = opening.watered;
    const settled = stepMonth(state);
    const reconciled = reconcileWaterService(settled, opening);
    const fresh = deriveWaterService(settled);

    expect(reconciled).toEqual(fresh);
    expect(settled.environment.watered).toEqual(fresh.watered);
    expect(settled.services.water).toEqual(fresh.service);
  });

  it('migrates the immediate pre-Water rules version and rejects tampered derived water state', () => {
    const prior = city() as unknown as Record<string, unknown>;
    prior.rulesVersion = MARKET_CITY_RULES_VERSION_PRE_WATER;
    stripCrime(prior);
    const migrated = restoreMarketCityState(prior);
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.environment.watered.every((value) => !value)).toBe(true);

    const active = city();
    addLiveCoalAndWaterPower(active);
    addTower(active);
    active.map.roads[tile(9, 7)] = true;
    active.map.waterPipes[tile(9, 4)] = true;
    const derived = deriveWaterService(active);
    active.environment.watered = derived.watered;
    active.services.water = derived.service;
    expect(() => validateMarketCityState(active)).not.toThrow();
    active.services.water.totalAllocated += 1;
    expect(() => validateMarketCityState(active)).toThrow(/canonical water|water derivation|totalAllocated|totals must reconcile/i);
  });
});
