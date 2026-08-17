import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarketCityController, DEFAULT_MARKET_CITY_CONTROLLER_ENGINE } from '../../src/market-city-dashboard/controller';
import { MemoryMarketCityPersistence } from '../../src/market-city-dashboard/persistence';
import { MarketCityDashboardRuntime } from '../../src/market-city-dashboard/runtime';
import { createMarketCityState } from '../../src/market-city/state';

function subject() {
  const persistence = new MemoryMarketCityPersistence({ now: () => '2026-08-11T22:00:00.000Z' });
  const controller = MarketCityController.create({
    identity: {
      cityId: 'runtime-test',
      cityName: 'Runtime Test',
      mayorName: 'Ada',
      seed: 99,
      createdAt: '2026-08-11T22:00:00.000Z',
    },
  }, { persistence, engine: DEFAULT_MARKET_CITY_CONTROLLER_ENGINE });
  const renders: Array<{ initial?: boolean; changedTileIds?: number[]; command?: unknown }> = [];
  const runtime = new MarketCityDashboardRuntime(controller, persistence, {
    render: (_state, update) => renders.push(update),
    inspect: () => undefined,
    clearInspection: () => undefined,
  });
  return { persistence, controller, runtime, renders };
}

afterEach(() => vi.unstubAllGlobals());

describe('playable MarketCity dashboard runtime', () => {
  it('previews and commits the retained map gesture without charging placement', async () => {
    const { controller, runtime, renders } = subject();
    runtime.ready();
    const plan = runtime.preview({
      type: 'zone', kind: 'residential', level: 5, cells: [{ x: 4, y: 5 }],
    });

    expect(plan).toMatchObject({
      accepted: true,
      cost: 0,
      affectedTileIds: [244],
      changedTileIds: [244],
    });
    expect(plan.prospectiveState).not.toBeNull();
    expect(plan.prospectiveState?.map.zones[244]).toBe('R');
    expect(controller.snapshot().map.zones[244]).toBeNull();
    const result = runtime.commit(plan);
    expect(result).toMatchObject({ accepted: true, cost: 0, changedTileIds: [244] });
    expect(controller.snapshot().map.zones[244]).toBe('R');
    expect(controller.snapshot().economy.treasury).toBe(5_000);
    expect(renders.at(-1)).toMatchObject({ changedTileIds: [244] });
    await runtime.whenDurable();
  });

  it('withholds prospective state for a rejected command and leaves the live hash untouched', () => {
    const { controller, runtime } = subject();
    const beforeHash = controller.hash();
    const plan = runtime.preview({
      type: 'place-network', network: 'road', cells: [{ x: -1, y: 0 }], route: [{ x: -1, y: 0 }],
    });

    expect(plan).toMatchObject({ accepted: false, prospectiveState: null, marketCommand: null });
    expect(controller.hash()).toBe(beforeHash);
  });

  it('retains a complete mixed zoning preview with bare placement, no-op, and blocked surface tiles', () => {
    const { controller, runtime } = subject();
    const road = { x: 4, y: 5 };
    const same = { x: 5, y: 5 };
    const different = { x: 6, y: 5 };
    const water = { x: 7, y: 5 };
    const bare = { x: 8, y: 5 };
    controller.dispatch({ type: 'place-road', tileIds: [5 * 48 + 4] });
    controller.dispatch({ type: 'zone', tileIds: [5 * 48 + 5], zone: 'R' });
    controller.dispatch({ type: 'zone', tileIds: [5 * 48 + 6], zone: 'C' });
    const state = controller.snapshot();
    state.map.terrain.water[5 * 48 + 7] = true;
    const persistence = new MemoryMarketCityPersistence();
    const waterController = MarketCityController.create({}, {
      persistence,
      engine: { ...DEFAULT_MARKET_CITY_CONTROLLER_ENGINE, createMarketCityState: () => state },
    });
    const waterRuntime = new MarketCityDashboardRuntime(waterController, persistence, {
      render: () => undefined, inspect: () => undefined, clearInspection: () => undefined,
    });

    const plan = waterRuntime.preview({ type: 'zone', kind: 'residential', cells: [road, same, different, water, bare] });
    expect(plan).toMatchObject({ accepted: true, changedTileIds: [5 * 48 + 8] });
    expect(plan.tileOutcomes).toEqual([
      { tileId: 5 * 48 + 4, disposition: 'blocked-occupied' },
      { tileId: 5 * 48 + 5, disposition: 'same-zone' },
      { tileId: 5 * 48 + 6, disposition: 'blocked-zone' },
      { tileId: 5 * 48 + 7, disposition: 'blocked-water' },
      { tileId: 5 * 48 + 8, disposition: 'place' },
    ]);
    expect(waterRuntime.commit(plan)).toMatchObject({ accepted: true, changedTileIds: [5 * 48 + 8] });
    expect(waterController.snapshot().map.zones.slice(5 * 48 + 4, 5 * 48 + 9)).toEqual([null, 'R', 'C', null, 'R']);
    expect(waterController.snapshot().map.roads[5 * 48 + 4]).toBe(true);
  });

  it('previews only empty zoning permissions for a Dezone brush', () => {
    const { controller } = subject();
    const empty = { x: 4, y: 5 };
    const roadOverlay = { x: 5, y: 5 };
    controller.dispatch({ type: 'zone', tileIds: [5 * 48 + 4], zone: 'R' });
    controller.dispatch({ type: 'place-road', tileIds: [5 * 48 + 5] });
    const legacy = controller.snapshot();
    legacy.map.zones[5 * 48 + 5] = 'R';
    const persistence = new MemoryMarketCityPersistence();
    const legacyController = MarketCityController.create({}, {
      persistence,
      engine: { ...DEFAULT_MARKET_CITY_CONTROLLER_ENGINE, createMarketCityState: () => legacy },
    });
    const runtime = new MarketCityDashboardRuntime(legacyController, persistence, {
      render: () => undefined, inspect: () => undefined, clearInspection: () => undefined,
    });

    const plan = runtime.preview({ type: 'dezone', cells: [empty, roadOverlay] });
    expect(plan).toMatchObject({ accepted: true, changedTileIds: [5 * 48 + 4, 5 * 48 + 5] });
    expect(plan.dezoneTileIds).toEqual([5 * 48 + 4, 5 * 48 + 5]);
    expect(runtime.commit(plan)).toMatchObject({ accepted: true, changedTileIds: [5 * 48 + 4, 5 * 48 + 5] });
    expect(legacyController.snapshot().map.zones[5 * 48 + 4]).toBeNull();
    expect(legacyController.snapshot().map.zones[5 * 48 + 5]).toBeNull();
    expect(legacyController.snapshot().map.roads[5 * 48 + 5]).toBe(true);
  });

  it('accepts the active underground subway command', () => {
    const { runtime } = subject();
    expect(runtime.dispatch({
      type: 'place-network', network: 'subway', cells: [{ x: 1, y: 1 }],
    })).toMatchObject({ accepted: true, changedTileIds: [49] });
  });

  it('keeps the complete request separate from mutable preview cells around fire locks', () => {
    const persistence = new MemoryMarketCityPersistence();
    const initial = createMarketCityState({
      cityId: 'locked-preview', cityName: 'Locked Preview', mayorName: 'Ada', seed: 9,
      createdAt: '2026-08-11T22:00:00.000Z',
    });
    const locked = 244;
    const mutable = 245;
    initial.clock.month = 1;
    initial.map.zones[locked] = 'R';
    initial.map.zones[mutable] = 'R';
    initial.economy.density[locked] = 0.8;
    initial.fire.incidents.push({
      id: `fire-m1-t${locked}`, status: 'burning', tileIds: [locked], zone: 'R', startedMonth: 1,
      structure: {
        footprint: '1x1', originTile: locked, height: 4, roof: 'flat', roofHeight: 1,
        roofOrientation: 0, detail: 'windows', color: [112, 204, 124], landmark: false,
      },
      intensity: 0.4, damage: 1, age: 1, rubbleMonthsRemaining: 0,
    });
    initial.fire.history.push({
      sequence: 1, month: 1, incidentId: `fire-m1-t${locked}`, event: 'ignited',
      tileIds: [locked], zone: 'R', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
    });
    const controller = MarketCityController.create({}, {
      persistence,
      engine: { ...DEFAULT_MARKET_CITY_CONTROLLER_ENGINE, createMarketCityState: () => initial },
    });
    const runtime = new MarketCityDashboardRuntime(controller, persistence, {
      render: () => undefined, inspect: () => undefined, clearInspection: () => undefined,
    });

    const mixed = runtime.preview({
      type: 'demolish', cells: [{ x: 4, y: 5 }, { x: 5, y: 5 }],
    });
    expect(mixed).toMatchObject({ accepted: true, affectedTileIds: [locked, mutable], changedTileIds: [mutable] });
    const lockedOnly = runtime.preview({ type: 'demolish', cells: [{ x: 4, y: 5 }] });
    expect(lockedOnly).toMatchObject({ accepted: false, affectedTileIds: [locked], changedTileIds: [] });
  });

  it('refuses a singleton Avenue preview and accepts the minimum 2 by 2 lane block', () => {
    const { runtime } = subject();
    const singleton = runtime.preview({
      type: 'place-network', network: 'avenue', route: [{ x: 10, y: 10 }],
      cells: [{ x: 10, y: 10 }], expansionSide: 'right',
    });
    expect(singleton).toMatchObject({
      accepted: false,
      reason: 'Avenue requires a two-tile drag to create a 2 × 2 paired-lane block.',
      affectedTileIds: [490],
      changedTileIds: [],
    });
    const plan = runtime.preview({
      type: 'place-network', network: 'avenue', route: [{ x: 10, y: 10 }, { x: 11, y: 10 }],
      cells: [{ x: 10, y: 10 }, { x: 11, y: 10 }], expansionSide: 'right',
    });
    expect(plan).toMatchObject({
      accepted: true,
      affectedTileIds: [490, 491, 538, 539],
      changedTileIds: [490, 491, 538, 539],
    });
  });

  it('reports the complete 2 by 2 Train Station footprint for visible placement preview', () => {
    const { runtime } = subject();
    const plan = runtime.preview({
      type: 'place-facility', facility: 'train-station', anchor: { x: 20, y: 20 },
    });
    expect(plan).toMatchObject({
      accepted: true,
      affectedTileIds: [980, 981, 1028, 1029],
      changedTileIds: [980, 981, 1028, 1029],
    });
  });

  it('keeps underground Water-pipe demolition separate from surface occupants', () => {
    const { controller, runtime } = subject();
    const cell = { x: 12, y: 12 };
    expect(runtime.dispatch({ type: 'zone', kind: 'residential', cells: [cell] }).accepted).toBe(true);
    expect(runtime.dispatch({ type: 'place-network', network: 'water-pipe', cells: [cell] }).accepted).toBe(true);
    const tileId = 12 * 48 + 12;
    expect(controller.snapshot().map.zones[tileId]).toBe('R');
    expect(controller.snapshot().map.waterPipes[tileId]).toBe(true);

    const underground = runtime.preview({ type: 'demolish', layer: 'underground', cells: [cell] });
    expect(underground).toMatchObject({ accepted: true, affectedTileIds: [tileId], changedTileIds: [tileId] });
    expect(runtime.commit(underground).accepted).toBe(true);
    expect(controller.snapshot().map.zones[tileId]).toBe('R');
    expect(controller.snapshot().map.waterPipes[tileId]).toBe(false);
  });

  it('steps, saves, reloads, and reproduces the exact canonical hash', async () => {
    const { controller, runtime } = subject();
    runtime.dispatch({ type: 'place-facility', facility: 'coal-power-plant', anchor: { x: 2, y: 2 } });
    runtime.dispatch({ type: 'place-network', network: 'road', cells: [{ x: 2, y: 5 }] });
    runtime.dispatch({ type: 'zone', kind: 'residential', cells: [{ x: 3, y: 5 }] });
    runtime.step(12);
    await runtime.whenDurable();
    const hash = controller.hash();
    expect(controller.snapshot().clock.month).toBe(12);
    await runtime.reload();
    expect(controller.hash()).toBe(hash);
    expect(controller.snapshot().map.zones[243]).toBe('R');

    runtime.dispatch({ type: 'demolish', cells: [{ x: 3, y: 5 }] });
    const demolishedHash = controller.hash();
    await runtime.reload();
    expect(controller.hash()).toBe(demolishedHash);
    expect(controller.snapshot().map.zones[243]).toBe('R');
    expect(controller.snapshot().economy.density[243]).toBe(0);
  });

  it('coalesces repeated browser month steps into one animation-frame render', () => {
    const scheduled: { frame?: FrameRequestCallback } = {};
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      scheduled.frame = callback;
      return 7;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const { controller, runtime, renders } = subject();
    runtime.ready();
    const openingRenderCount = renders.length;

    runtime.step(1);
    runtime.step(1);
    expect(controller.snapshot().clock.month).toBe(2);
    expect(renders).toHaveLength(openingRenderCount);

    expect(scheduled.frame).toBeTypeOf('function');
    scheduled.frame!(0);
    expect(renders).toHaveLength(openingRenderCount + 1);
    expect(renders.at(-1)).toMatchObject({ command: { type: 'step-market-month', months: 1 } });
  });

  it('undoes only map edits and keeps canonical snapshots defensive', async () => {
    const { controller, runtime } = subject();
    runtime.dispatch({ type: 'zone', kind: 'industrial', cells: [{ x: 7, y: 7 }] });
    const snapshot = runtime.snapshot();
    snapshot.map.zones[343] = 'C';
    expect(controller.snapshot().map.zones[343]).toBe('I');
    expect(await runtime.undo()).toBe(true);
    expect(controller.snapshot().map.zones[343]).toBeNull();
  });
});
