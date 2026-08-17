import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { createMarketCityState, restoreMarketCityState, serializeMarketCityState } from '../../src/market-city/state';
import { MARKET_CITY_MAP_SIZE } from '../../src/market-city/types';

const tile = (x: number, y: number) => y * MARKET_CITY_MAP_SIZE + x;

describe('explicit ordinary-road topology', () => {
  it('keeps adjacent parallel drags separate until the player explicitly joins them', () => {
    let state = createMarketCityState({ cityId: 'parallel-road-topology' });
    const upper = [tile(10, 10), tile(11, 10), tile(12, 10)];
    const lower = [tile(10, 11), tile(11, 11), tile(12, 11)];

    state = applyWorldCommand(state, { type: 'place-road', path: upper }).state;
    state = applyWorldCommand(state, { type: 'place-road', path: lower }).state;

    expect(state.map.roadConnectionMasks[upper[0]!]).toBe(2);
    expect(state.map.roadConnectionMasks[upper[1]!]).toBe(10);
    expect(state.map.roadConnectionMasks[lower[1]!]).toBe(10);
    expect(state.map.roadConnectionMasks[upper[1]!]! & 4).toBe(0);
    expect(state.map.roadConnectionMasks[lower[1]!]! & 1).toBe(0);

    const restored = restoreMarketCityState(serializeMarketCityState(state));
    expect(restored.map.roadConnectionMasks).toEqual(state.map.roadConnectionMasks);
  });
});
