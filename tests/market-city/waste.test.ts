import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { MARKET_SERVICE_ZONE_CATALOG } from '../../src/market-city/catalog';
import { MARKET_ITEM_MANIFEST } from '../../src/market-city/item-manifest';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { stepMonth, stepMonths } from '../../src/market-city/simulation';
import {
  createMarketCityState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import {
  deriveLandfillOperations,
  deriveLandfillFillStage,
  settleWaste,
} from '../../src/market-city/waste';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2 } from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'waste-core', cityName: 'Waste Core', mayorName: 'Ada', seed: 223,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
}

function developed(state: MarketCityStateV2, id: number, zone: 'R' | 'C' | 'I', density: number): void {
  state.map.zones[id] = zone;
  state.economy.density[id] = density;
}

describe('Landfill catalog and manifest contracts', () => {
  it('activates a free Public Services landfill brush with all completeness contracts', () => {
    expect(MARKET_SERVICE_ZONE_CATALOG.landfill).toMatchObject({
      kind: 'landfill', label: 'Landfill Zone', category: 'waste', buildCost: 0,
      footprint: { width: 1, height: 1 }, monthlyMaintenance: 0,
    });
    expect(MARKET_ITEM_MANIFEST.find((item) => item.id === 'landfill-zone')).toMatchObject({
      status: 'active', action: 'zone-landfill',
    });
  });
});

describe('Landfill zoning and removal', () => {
  it('is atomic across surface conflicts, allows an underground pipe, and preserves it through empty removal', () => {
    const state = city();
    const pipe = tile(10, 10);
    const blocked = tile(11, 10);
    state.map.roads[blocked] = true;
    const withPipe = applyWorldCommand(state, { type: 'place-water-pipe', tileIds: [pipe] });
    expect(withPipe.ok).toBe(true);
    const rejected = applyWorldCommand(withPipe.state, { type: 'zone-landfill', tileIds: [pipe, blocked] });
    expect(rejected).toMatchObject({ ok: false, state: withPipe.state, changedTileIds: [] });

    const placed = applyWorldCommand(withPipe.state, { type: 'zone-landfill', tileIds: [pipe] });
    expect(placed).toMatchObject({ ok: true, changedTileIds: [pipe] });
    expect(placed.state.map.landfillZones[pipe]).toBe(true);
    expect(placed.state.map.waterPipes[pipe]).toBe(true);

    const dezoned = applyWorldCommand(placed.state, { type: 'dezone', tileIds: [pipe] });
    expect(dezoned).toMatchObject({ ok: true });
    expect(dezoned.state.map.landfillZones[pipe]).toBe(false);
    expect(dezoned.state.map.waterPipes[pipe]).toBe(true);
  });

  it('rejects removal or flooding of stored garbage without changing the city', () => {
    const state = city();
    const target = tile(12, 12);
    state.map.landfillZones[target] = true;
    state.services.waste.storedByTile[target] = 100;
    state.services.waste.generatedThisMonth = 100;
    state.services.waste.generatedLifetime = 100;
    state.services.waste.landfilledThisMonth = 100;
    state.services.waste.landfilledLifetime = 100;
    validateMarketCityState(state);

    for (const command of [
      { type: 'dezone' as const, tileIds: [target] },
      { type: 'demolish' as const, tileIds: [target] },
      { type: 'paint-terrain' as const, tileIds: [target], water: true },
    ]) {
      const result = applyWorldCommand(state, command);
      expect(result).toMatchObject({ ok: false, state, changedTileIds: [], reason: 'Landfill contains garbage.' });
    }
  });
});

describe('Waste settlement', () => {
  it('floors one citywide developed-density total and allocates in stable tile order', () => {
    const state = city();
    developed(state, tile(1, 1), 'R', 0.5);
    developed(state, tile(2, 1), 'C', 0.5);
    developed(state, tile(3, 1), 'I', 0.5);
    const high = tile(10, 10);
    const low = tile(9, 10);
    const last = tile(11, 10);
    state.map.landfillZones[high] = true;
    state.map.landfillZones[low] = true;
    state.map.landfillZones[last] = true;
    state.map.roads[tile(9, 9)] = true;

    const settled = settleWaste(state);
    // floor(0.5 * (1 + 5 + 20)) = 13, allocated to the lowest valid tile.
    expect(settled.service).toMatchObject({
      generatedThisMonth: 13, landfilledThisMonth: 13, unmanagedThisMonth: 0,
      generatedLifetime: 13, landfilledLifetime: 13, unmanagedLifetime: 0,
    });
    expect(settled.service.storedByTile[low]).toBe(13);
    expect(settled.service.storedByTile[high]).toBe(0);
    expect(settled.service.storedByTile[last]).toBe(0);
    expect(state.services.waste.generatedLifetime).toBe(0);
  });

  it('limits each cell to 100 monthly intake and 10,000 stored tenths, then exposes the unmanaged pollution ratio', () => {
    const state = city();
    developed(state, tile(1, 1), 'I', 1);
    developed(state, tile(2, 1), 'I', 1);
    developed(state, tile(3, 1), 'I', 1);
    const first = tile(9, 9);
    const second = tile(10, 9);
    state.map.landfillZones[first] = true;
    state.map.landfillZones[second] = true;
    state.map.roads[tile(9, 8)] = true;
    state.services.waste.storedByTile[first] = 9_950;
    state.services.waste.generatedLifetime = 9_950;
    state.services.waste.landfilledLifetime = 9_950;
    const settled = settleWaste(state);
    expect(settled.service).toMatchObject({
      generatedThisMonth: 60, landfilledThisMonth: 60, unmanagedThisMonth: 0,
      landfilledLifetime: 10_010,
    });
    expect(settled.service.storedByTile[first]).toBe(10_000);
    expect(settled.service.storedByTile[second]).toBe(10);
    expect(settled.pollutionAddition).toBe(0);

    const full = city();
    developed(full, tile(1, 1), 'I', 1);
    full.map.landfillZones[first] = true;
    full.map.roads[tile(9, 8)] = true;
    full.services.waste.storedByTile[first] = 10_000;
    full.services.waste.generatedLifetime = 10_000;
    full.services.waste.landfilledLifetime = 10_000;
    const unmanaged = settleWaste(full);
    expect(unmanaged.service).toMatchObject({ generatedThisMonth: 20, landfilledThisMonth: 0, unmanagedThisMonth: 20 });
    expect(unmanaged.pollutionAddition).toBe(MARKET_CITY_RULES.waste.maximumUnmanagedPollution);
  });

  it('opens only cardinal landfill components with direct Road or Avenue contact and resumes their existing intake after reconnecting', () => {
    const state = city();
    developed(state, tile(1, 1), 'I', 1);
    const connectedComponent = [tile(20, 20), tile(21, 20), tile(21, 21)];
    const diagonalComponent = tile(22, 22);
    for (const landfill of [...connectedComponent, diagonalComponent]) state.map.landfillZones[landfill] = true;
    state.services.waste.storedByTile[connectedComponent[1]!] = 60;

    const disconnected = deriveLandfillOperations(state);
    expect(disconnected.components).toEqual([
      expect.objectContaining({
        id: `landfill:${connectedComponent[0]}`,
        tileIds: connectedComponent,
        roadConnected: false,
        storedTenths: 60,
        capacityTenths: 30_000,
        freeCapacityTenths: 29_940,
        usableMonthlyIntakeTenths: 0,
      }),
      expect.objectContaining({
        id: `landfill:${diagonalComponent}`,
        tileIds: [diagonalComponent],
        roadConnected: false,
        usableMonthlyIntakeTenths: 0,
      }),
    ]);
    const blocked = settleWaste(state);
    expect(blocked.service).toMatchObject({ landfilledThisMonth: 0, unmanagedThisMonth: 20 });
    expect(blocked.service.storedByTile[connectedComponent[1]!]).toBe(60);

    state.services.waste = blocked.service;
    state.map.avenueLanes[tile(20, 19)] = true;
    const avenueConnected = deriveLandfillOperations(state);
    expect(avenueConnected.components).toEqual([
      expect.objectContaining({ tileIds: connectedComponent, roadConnected: true, usableMonthlyIntakeTenths: 300 }),
      expect.objectContaining({ tileIds: [diagonalComponent], roadConnected: false, usableMonthlyIntakeTenths: 0 }),
    ]);
    const recovered = settleWaste(state);
    expect(recovered.service).toMatchObject({ landfilledThisMonth: 20, unmanagedThisMonth: 0, unmanagedLifetime: 20 });
    expect(recovered.service.storedByTile[connectedComponent[0]!]).toBe(20);
    expect(recovered.service.storedByTile[diagonalComponent]).toBe(0);
  });

  it('uses the six exact world-art stages', () => {
    expect([
      deriveLandfillFillStage(0), deriveLandfillFillStage(1), deriveLandfillFillStage(2_499),
      deriveLandfillFillStage(2_500), deriveLandfillFillStage(4_999), deriveLandfillFillStage(5_000),
      deriveLandfillFillStage(7_499), deriveLandfillFillStage(7_500), deriveLandfillFillStage(9_999),
      deriveLandfillFillStage(10_000),
    ]).toEqual(['empty', 'scattered', 'scattered', 'low', 'low', 'medium', 'medium', 'high', 'high', 'full']);
  });

  it('advances a stable developed city through every intake-limited fill threshold in numeric tile order', () => {
    const state = city();
    const landfill = tile(18, 18);
    state.map.landfillZones[landfill] = true;
    state.map.roads[tile(18, 17)] = true;
    for (let index = 0; index < 5; index += 1) developed(state, tile(2 + index, 2), 'I', 1);

    const observed: Array<readonly [number, number, string]> = [[0, 0, deriveLandfillFillStage(0)]];
    for (let month = 1; month <= 100; month += 1) {
      const settled = settleWaste(state);
      expect(settled.service.generatedThisMonth).toBe(100);
      expect(settled.service.landfilledThisMonth).toBe(100);
      expect(settled.service.unmanagedThisMonth).toBe(0);
      state.services.waste = settled.service;
      if ([1, 25, 50, 75, 100].includes(month)) {
        observed.push([month, settled.service.storedByTile[landfill]!, deriveLandfillFillStage(settled.service.storedByTile[landfill]!)]);
      }
    }
    expect(observed).toEqual([
      [0, 0, 'empty'], [1, 100, 'scattered'], [25, 2_500, 'low'],
      [50, 5_000, 'medium'], [75, 7_500, 'high'], [100, 10_000, 'full'],
    ]);
  });

  it('settles before same-month market decline, resets current counters, and remains exactly serializable', () => {
    const state = city();
    const zone = tile(5, 5);
    const landfill = tile(8, 8);
    developed(state, zone, 'I', 1);
    state.map.landfillZones[landfill] = true;
    state.map.roads[tile(8, 7)] = true;
    const once = stepMonth(state);
    expect(once.services.waste).toMatchObject({ generatedThisMonth: 20, landfilledThisMonth: 20, unmanagedThisMonth: 0 });
    expect(once.economy.density[zone]).toBeLessThan(1);
    const twice = stepMonth(once);
    expect(twice.services.waste.generatedThisMonth).toBeLessThanOrEqual(20);
    expect(stepMonths(state, 2)).toEqual(twice);
    expect(restoreMarketCityState(serializeMarketCityState(twice))).toEqual(twice);
  });
});
