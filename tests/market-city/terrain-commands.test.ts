import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { createMarketCityState } from '../../src/market-city/state';
import { MARKET_CITY_MAP_SIZE, type MarketCityWorldCommand } from '../../src/market-city/types';

const TILE_COUNT = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;
const tile = (x: number, y: number): number => y * MARKET_CITY_MAP_SIZE + x;

describe('market-city terrain commands', () => {
  it('toggles water without repainting material and flooding clears occupants and trees', () => {
    const target = tile(8, 8);
    let state = createMarketCityState({ cityId: 'water-toggle' });
    state = applyWorldCommand(state, {
      type: 'paint-terrain', tileIds: [target], material: 'rock',
    }).state;
    state = applyWorldCommand(state, { type: 'place-road', tileIds: [target] }).state;
    state.map.terrain.trees[target] = 3;
    const before = state;

    const flooded = applyWorldCommand(state, {
      type: 'paint-terrain', tileIds: [target], water: true,
    });

    expect(flooded.ok).toBe(true);
    expect(flooded.state.map.terrain.water[target]).toBe(true);
    expect(flooded.state.map.terrain.material[target]).toBe('rock');
    expect(flooded.state.map.terrain.trees[target]).toBe(0);
    expect(flooded.state.map.roads[target]).toBe(false);
    expect(before.map.terrain.water[target]).toBe(false);
    expect(before.map.roads[target]).toBe(true);

    const restoredLand = applyWorldCommand(flooded.state, {
      type: 'paint-terrain', tileIds: [target], water: false,
    });
    expect(restoredLand.state.map.terrain.water[target]).toBe(false);
    expect(restoredLand.state.map.terrain.material[target]).toBe('rock');
  });

  it('repaints material without changing water and rejects an empty paint atomically', () => {
    const target = tile(9, 9);
    const water = Array<boolean>(TILE_COUNT).fill(false);
    water[target] = true;
    const state = createMarketCityState({ cityId: 'material-only' }, { water });

    const painted = applyWorldCommand(state, {
      type: 'paint-terrain', tileIds: [target], material: 'sand',
    });
    expect(painted.ok).toBe(true);
    expect(painted.state.map.terrain.material[target]).toBe('sand');
    expect(painted.state.map.terrain.water[target]).toBe(true);

    const rejected = applyWorldCommand(
      painted.state,
      { type: 'paint-terrain', tileIds: [target] } as MarketCityWorldCommand,
    );
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/material.*water|water.*material/i);
    expect(rejected.state).toBe(painted.state);
  });

  it('adjusts land trees by one, clamps 0..4, and forces selected water to zero', () => {
    const low = tile(4, 4);
    const high = tile(5, 4);
    const wet = tile(6, 4);
    const water = Array<boolean>(TILE_COUNT).fill(false);
    const trees = Array<number>(TILE_COUNT).fill(0);
    water[wet] = true;
    trees[low] = 0;
    trees[high] = 4;
    trees[wet] = 3;
    const opening = createMarketCityState({ cityId: 'trees' }, { water, trees });

    const raised = applyWorldCommand(opening, {
      type: 'adjust-trees', tileIds: [low, high, wet], delta: 1,
    });
    expect(raised.ok).toBe(true);
    expect(raised.state.map.terrain.trees[low]).toBe(1);
    expect(raised.state.map.terrain.trees[high]).toBe(4);
    expect(raised.state.map.terrain.trees[wet]).toBe(0);
    expect(opening.map.terrain.trees).toEqual(trees);

    const lowered = applyWorldCommand(raised.state, {
      type: 'adjust-trees', tileIds: [low, high, wet], delta: -1,
    });
    expect(lowered.state.map.terrain.trees[low]).toBe(0);
    expect(lowered.state.map.terrain.trees[high]).toBe(3);
    expect(lowered.state.map.terrain.trees[wet]).toBe(0);

    const invalid = applyWorldCommand(lowered.state, {
      type: 'adjust-trees', tileIds: [low], delta: 2,
    });
    expect(invalid.ok).toBe(false);
    expect(invalid.reason).toMatch(/exactly one/i);
    expect(invalid.state).toBe(lowered.state);
  });

  it('adjusts elevation atomically and resets the entire map to zero for free', () => {
    const first = tile(2, 2);
    const second = tile(3, 2);
    let state = createMarketCityState({ cityId: 'elevation' });
    state.economy.treasury = -50_000;
    state = applyWorldCommand(state, {
      type: 'set-elevation', tileIds: [first], elevation: 2,
    }).state;
    state = applyWorldCommand(state, {
      type: 'set-elevation', tileIds: [second], elevation: -1,
    }).state;

    const adjusted = applyWorldCommand(state, {
      type: 'adjust-elevation', tileIds: [first, second], delta: 0.5,
    });
    expect(adjusted.ok).toBe(true);
    expect(adjusted.state.map.terrain.elevation[first]).toBe(2.5);
    expect(adjusted.state.map.terrain.elevation[second]).toBe(-0.5);
    expect(adjusted.state.economy.treasury).toBe(-50_000);
    expect(state.map.terrain.elevation[first]).toBe(2);

    const rejected = applyWorldCommand(adjusted.state, {
      type: 'adjust-elevation', tileIds: [first, TILE_COUNT], delta: 1,
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.state).toBe(adjusted.state);
    expect(rejected.state.map.terrain.elevation[first]).toBe(2.5);

    const reset = applyWorldCommand(adjusted.state, { type: 'reset-elevation' });
    expect(reset.ok).toBe(true);
    expect(reset.changedTileIds).toEqual([first, second]);
    expect(reset.state.map.terrain.elevation.every((value) => value === 0)).toBe(true);
    expect(reset.state.economy.treasury).toBe(-50_000);
    expect(adjusted.state.map.terrain.elevation[first]).toBe(2.5);
  });
});
