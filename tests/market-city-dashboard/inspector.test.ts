import { describe, expect, it } from 'vitest';

import { applyWorldCommand } from '../../src/market-city/commands';
import { createMarketCityState } from '../../src/market-city/state';
import type { MarketCityStateV2 } from '../../src/market-city/types';
import {
  deriveInspectorTarget,
  pinFromTarget,
  reduceInspectorState,
  type InspectorState,
  type InspectorTargetSnapshot,
} from '../../src/market-city-dashboard/inspector';

const SIZE = 48;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({ cityId: 'inspector-unit-city', seed: 17 });
}

function apply(state: MarketCityStateV2, command: Parameters<typeof applyWorldCommand>[1]): MarketCityStateV2 {
  const result = applyWorldCommand(state, command);
  expect(result.ok, result.reason).toBe(true);
  return result.state;
}

function target(overrides: Partial<InspectorTargetSnapshot> = {}): InspectorTargetSnapshot {
  return {
    targetId: 'tile:zone:10',
    focusTileId: 10,
    x: 10,
    y: 0,
    kind: 'zoned-tile',
    title: 'Residential Tile',
    subtitle: 'Tile 11, 1 · Empty zoning',
    icon: '⌂',
    road: { state: 'failed' },
    water: { state: 'failed', mode: 'usage', used: 0, capacity: 0 },
    power: { state: 'failed', mode: 'usage', used: 0, capacity: 0 },
    ...overrides,
  };
}

describe('universal object inspector projection', () => {
  it('projects empty zoned tiles and developed buildings through the canonical tile inspection', () => {
    const emptyState = apply(city(), { type: 'zone', zone: 'R', tileIds: [tile(10, 10)] });
    const empty = deriveInspectorTarget(emptyState, { x: 10, y: 10 });
    expect(empty).toMatchObject({
      targetId: `tile:zone:${tile(10, 10)}`,
      kind: 'zoned-tile',
      title: 'Residential Tile',
      road: { state: 'failed' },
      water: { state: 'failed', mode: 'usage' },
      power: { state: 'failed', mode: 'usage' },
    });

    const developedState = apply(emptyState, { type: 'zone', zone: 'C', tileIds: [tile(12, 10)] });
    developedState.economy.density[tile(12, 10)] = 0.5;
    const building = deriveInspectorTarget(developedState, { x: 12, y: 10 });
    expect(building).toMatchObject({
      targetId: `tile:zone:${tile(12, 10)}`,
      kind: 'building',
      title: 'Commercial Building',
    });
  });

  it('projects road and power-line surface targets with binary/usage connector states', () => {
    const roadState = apply(city(), { type: 'place-road', tileIds: [tile(8, 8)] });
    expect(deriveInspectorTarget(roadState, { x: 8, y: 8 })).toMatchObject({
      targetId: `tile:road:${tile(8, 8)}`,
      kind: 'road',
      title: 'Road',
      road: { state: 'connected' },
    });

    const lineState = apply(city(), { type: 'place-power-line', tileIds: [tile(9, 8)] });
    expect(deriveInspectorTarget(lineState, { x: 9, y: 8 })).toMatchObject({
      targetId: `tile:power-line:${tile(9, 8)}`,
      kind: 'power-line',
      power: { state: 'failed', mode: 'usage' },
    });
  });

  it('projects power and water facilities with canonical generation capacities', () => {
    let state = city();
    state = apply(state, { type: 'place-facility', kind: 'coal-power-plant', anchor: tile(20, 20) });
    state = apply(state, { type: 'place-road', tileIds: [tile(20, 23)] });
    const powerPlant = deriveInspectorTarget(state, { x: 20, y: 20 });
    expect(powerPlant).toMatchObject({
      targetId: expect.stringMatching(/^facility:/),
      kind: 'power-facility',
      title: 'Coal Power Plant',
      power: { mode: 'production', capacity: 1_200 },
    });

    state = apply(state, { type: 'place-facility', kind: 'water-tower', anchor: tile(30, 20) });
    state = apply(state, { type: 'place-road', tileIds: [tile(30, 23)] });
    const waterTower = deriveInspectorTarget(state, { x: 30, y: 20 });
    expect(waterTower).toMatchObject({
      targetId: expect.stringMatching(/^facility:/),
      kind: 'water-facility',
      title: 'Water Tower',
      water: { mode: 'production', capacity: 20_000 },
    });
  });

  it('makes thermal road and water gates truthful while renewable gates are not applicable', () => {
    let state = city();
    state = apply(state, { type: 'place-facility', kind: 'coal-power-plant', anchor: tile(20, 20) });
    const coal = deriveInspectorTarget(state, { x: 20, y: 20 });
    expect(coal).toMatchObject({
      kind: 'power-facility',
      road: { state: 'failed' },
      water: { state: 'failed', mode: 'usage', used: 2_400 },
      power: { state: 'failed', mode: 'production', capacity: 1_200 },
      details: expect.arrayContaining(['Plant inactive', 'Reason: No road access within 3 tiles.']),
    });

    state = apply(state, { type: 'place-facility', kind: 'wind-turbine', anchor: tile(35, 20) });
    const wind = deriveInspectorTarget(state, { x: 35, y: 20 });
    expect(wind).toMatchObject({
      kind: 'power-facility',
      road: { state: 'not-applicable' },
      water: { state: 'not-applicable' },
      power: { state: 'connected', mode: 'production', capacity: 60 },
    });
  });

  it('projects a Train Station through the same card with all four operational gates', () => {
    let state = city();
    state = apply(state, { type: 'place-facility', kind: 'train-station', anchor: tile(20, 20) });
    state = apply(state, { type: 'place-road', tileIds: [tile(20, 19)] });
    state = apply(state, { type: 'place-rail', path: [tile(20, 22)] });

    expect(deriveInspectorTarget(state, { x: 20, y: 20 })).toMatchObject({
      kind: 'surface-facility',
      title: 'Train Station',
      road: { state: 'connected' },
      rail: { state: 'connected' },
      power: { state: 'failed', mode: 'usage', used: 20, capacity: 0 },
      water: { state: 'failed', mode: 'usage', used: 50, capacity: 0 },
      details: [
        'Station inactive',
        'Water component none',
        'Reason: No allocated power capacity. No allocated water service.',
      ],
    });
  });

  it('keeps pins unique, ordered, replaceable, restorable, and removable on close', () => {
    const first = target({ targetId: 'facility:first', title: 'First' });
    const second = target({ targetId: 'facility:second', title: 'Second', kind: 'power-facility' });
    const initial: InspectorState = { open: null, pinned: [] };

    const firstOpen = reduceInspectorState(initial, { type: 'open', target: first });
    const firstPinned = reduceInspectorState(firstOpen, { type: 'minimize' });
    expect(firstPinned).toEqual({ open: null, pinned: [pinFromTarget(first)] });

    const secondPinned = reduceInspectorState(
      reduceInspectorState(firstPinned, { type: 'open', target: second }),
      { type: 'minimize' },
    );
    expect(secondPinned.pinned.map(({ targetId }) => targetId)).toEqual(['facility:first', 'facility:second']);

    const duplicateOpen = reduceInspectorState(secondPinned, { type: 'open', target: first });
    const duplicateMinimized = reduceInspectorState(duplicateOpen, { type: 'minimize' });
    expect(duplicateMinimized.pinned.map(({ targetId }) => targetId)).toEqual(['facility:first', 'facility:second']);

    const restored = reduceInspectorState(duplicateMinimized, { type: 'restore', targetId: 'facility:first' });
    expect(restored.open?.targetId).toBe('facility:first');
    const closed = reduceInspectorState(restored, { type: 'close' });
    expect(closed).toEqual({ open: null, pinned: [pinFromTarget(second)] });
  });

  it('preserves a missing pin with an explicit no-longer-present label', () => {
    const initial: InspectorState = { open: null, pinned: [pinFromTarget(target())] };
    const refreshed = reduceInspectorState(initial, {
      type: 'refresh',
      targetId: 'tile:zone:10',
      target: null,
    });
    expect(refreshed.pinned[0]).toMatchObject({ title: 'Object no longer present', icon: '·' });
  });
});
