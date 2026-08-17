import { describe, expect, it } from 'vitest';

import { MARKET_FACILITY_CATALOG, MARKET_NETWORK_CATALOG } from '../../src/market-city/catalog';
import { applyWorldCommand } from '../../src/market-city/commands';
import { stepMonth } from '../../src/market-city/simulation';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { MARKET_CITY_MAP_SIZE } from '../../src/market-city/types';

const tile = (x: number, y: number): number => y * MARKET_CITY_MAP_SIZE + x;

function city() {
  return createMarketCityState({
    cityId: 'subway-core', cityName: 'Subway Core', mayorName: 'Ada', seed: 42,
    createdAt: '2026-08-13T00:00:00.000Z',
  });
}

describe('playable subway', () => {
  it('catalogues the separate underground tunnel and its one-tile entrance', () => {
    expect(MARKET_NETWORK_CATALOG.subway).toMatchObject({
      label: 'Subway Tunnel', category: 'transit', footprint: { width: 1, height: 1 },
    });
    expect(MARKET_FACILITY_CATALOG['subway-station']).toMatchObject({
      label: 'Subway Station', category: 'transit', footprint: { width: 1, height: 1 },
    });
  });

  it('routes below surface occupants and pipes without changing simulation results', () => {
    let state = city();
    const route = [tile(10, 10), tile(11, 10), tile(12, 10), tile(12, 11)];
    state = applyWorldCommand(state, { type: 'place-road', tileIds: [route[0]!] }).state;
    state = applyWorldCommand(state, { type: 'zone', zone: 'R', tileIds: [route[1]!] }).state;
    state = applyWorldCommand(state, { type: 'place-water-pipe', tileIds: route }).state;
    const before = stepMonth(state);

    const result = applyWorldCommand(state, { type: 'place-subway', path: route });
    expect(result.ok).toBe(true);
    expect(result.state.map.subways.filter(Boolean)).toHaveLength(route.length);
    expect(result.state.map.subwayConnectionMasks[route[0]!]).toBe(2);
    expect(result.state.map.subwayConnectionMasks[route[1]!]).toBe(10);
    expect(result.state.map.subwayConnectionMasks[route[2]!]).toBe(12);
    expect(result.state.map.subwayConnectionMasks[route[3]!]).toBe(1);
    expect(result.state.map.waterPipes[route[1]!]).toBe(true);

    const after = stepMonth(result.state);
    expect(after.economy).toEqual(before.economy);
    expect(after.environment.congestion).toEqual(before.environment.congestion);
    expect(after.market).toEqual(before.market);
    expect(after.services.rail).toEqual(before.services.rail);
  });

  it('requires a tunnel directly below the station, persists it, and demolishes layers independently', () => {
    const stationTile = tile(22, 22);
    const rejected = applyWorldCommand(city(), { type: 'place-facility', kind: 'subway-station', anchor: stationTile });
    expect(rejected).toMatchObject({ ok: false, reason: expect.stringMatching(/tunnel/i) });

    let state = applyWorldCommand(city(), { type: 'place-subway', path: [stationTile] }).state;
    state = applyWorldCommand(state, { type: 'place-facility', kind: 'subway-station', anchor: stationTile }).state;
    expect(state.map.facilities).toContainEqual(expect.objectContaining({ kind: 'subway-station', anchor: stationTile }));
    const hash = hashDeterministicState(state);
    const restored = restoreMarketCityState(serializeMarketCityState(state));
    expect(hashDeterministicState(restored)).toBe(hash);

    state = applyWorldCommand(restored, { type: 'demolish', layer: 'underground', tileIds: [stationTile] }).state;
    expect(state.map.subways[stationTile]).toBe(false);
    expect(state.map.facilities).toContainEqual(expect.objectContaining({ kind: 'subway-station' }));
    state = applyWorldCommand(state, { type: 'demolish', layer: 'surface', tileIds: [stationTile] }).state;
    expect(state.map.facilities).toHaveLength(0);
  });
});
