import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { applyWorldCommand } from '../../src/market-city/commands';
import { MARKET_FACILITY_CATALOG, MARKET_NETWORK_CATALOG } from '../../src/market-city/catalog';
import { MARKET_ITEM_MANIFEST } from '../../src/market-city/item-manifest';
import { deriveTileInspection } from '../../src/market-city/queries';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { stepMonth } from '../../src/market-city/simulation';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import { deriveCongestion, derivePower } from '../../src/market-city/spatial';
import {
  derivePassengerRailService,
  deriveRailPath,
  deriveRailTopology,
} from '../../src/market-city/transport';
import { deriveWaterService } from '../../src/market-city/water';
import {
  MARKET_CITY_MAP_SIZE,
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES,
  type MarketCityStateV2,
  type MarketFacility,
} from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'rail-core', cityName: 'Rail Core', mayorName: 'Ada', seed: 191,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
}

function station(id: string, x: number, y: number): MarketFacility {
  return {
    id,
    kind: 'train-station',
    anchor: tile(x, y),
    tiles: [tile(x, y), tile(x + 1, y), tile(x, y + 1), tile(x + 1, y + 1)],
  };
}

function connectRail(state: MarketCityStateV2, path: readonly number[]): void {
  const plan = deriveRailPath(SIZE, path);
  expect(plan.ok, plan.ok ? undefined : plan.reason).toBe(true);
  if (!plan.ok) return;
  for (const entry of plan.tiles) {
    state.map.rails[entry.tileId] = true;
    state.map.railConnectionMasks[entry.tileId] = (state.map.railConnectionMasks[entry.tileId] ?? 0)
      | entry.connectionMask;
  }
}

function roadAt(state: MarketCityStateV2, x: number, y: number): void {
  state.map.roads[tile(x, y)] = true;
}

/** A real source-fed utility backbone for tests that are specifically about rail. */
function provideTrainStationUtilities(state: MarketCityStateV2): void {
  state.map.facilities.push(
    {
      id: 'rail-test-solar', kind: 'solar-plant', anchor: tile(40, 40),
      tiles: [tile(40, 40), tile(41, 40), tile(42, 40), tile(43, 40), tile(40, 41), tile(41, 41), tile(42, 41), tile(43, 41)],
    },
    {
      id: 'rail-test-water', kind: 'water-tower', anchor: tile(35, 40),
      tiles: [tile(35, 40), tile(36, 40), tile(35, 41), tile(36, 41)],
    },
  );
  roadAt(state, 40, 43);
  roadAt(state, 35, 43);
  for (let tileId = 0; tileId < SIZE * SIZE; tileId += 1) {
    const hasSurfaceOccupant = state.map.roads[tileId]
      || state.map.avenueLanes[tileId]
      || state.map.rails[tileId]
      || state.map.zones[tileId] !== null
      || state.map.facilities.some((facility) => facility.tiles.includes(tileId));
    if (!hasSurfaceOccupant) state.map.powerLines[tileId] = true;
  }
  state.map.waterPipes.fill(true);
  const power = derivePower(state);
  state.environment.powered = power.powered;
  const water = deriveWaterService(state, power);
  state.environment.watered = water.watered;
  state.services.water = water.service;
}

describe('deriveRailPath', () => {
  it('preserves ordered cardinal routes and emits reciprocal masks through curves', () => {
    const path = [tile(4, 4), tile(5, 4), tile(6, 4), tile(6, 5), tile(7, 5), tile(7, 6)];
    const frozen = [...path];
    const plan = deriveRailPath(SIZE, path);
    expect(plan).toEqual({
      ok: true,
      tileIds: path,
      tiles: [
        { tileId: tile(4, 4), connectionMask: 2 },
        { tileId: tile(5, 4), connectionMask: 10 },
        { tileId: tile(6, 4), connectionMask: 12 },
        { tileId: tile(6, 5), connectionMask: 3 },
        { tileId: tile(7, 5), connectionMask: 12 },
        { tileId: tile(7, 6), connectionMask: 1 },
      ],
    });
    expect(path).toEqual(frozen);
    expect(deriveRailPath(SIZE, path)).toEqual(plan);
  });

  it.each([
    [[]],
    [[tile(1, 1), tile(1, 1)]],
    [[tile(1, 1), tile(2, 2)]],
    [[tile(47, 1), tile(0, 2)]],
    [[-1]],
    [[SIZE * SIZE]],
  ] as const)('rejects a malformed route %j', (path) => {
    expect(deriveRailPath(SIZE, path)).toMatchObject({ ok: false });
  });

  it('preserves exact explicit edges across deterministic self-avoiding generated routes', () => {
    fc.assert(fc.property(
      fc.integer({ min: 8, max: 39 }),
      fc.integer({ min: 8, max: 39 }),
      fc.array(fc.integer({ min: 0, max: 3 }), { minLength: 1, maxLength: 80 }),
      (startX, startY, directions) => {
        const deltas = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
        const path = [tile(startX, startY)];
        const seen = new Set(path);
        let x = startX;
        let y = startY;
        for (const direction of directions) {
          const [dx, dy] = deltas[direction]!;
          const nextX = x + dx;
          const nextY = y + dy;
          const next = tile(nextX, nextY);
          if (nextX < 0 || nextX >= SIZE || nextY < 0 || nextY >= SIZE || seen.has(next)) continue;
          path.push(next);
          seen.add(next);
          x = nextX;
          y = nextY;
        }
        const frozen = [...path];
        const result = deriveRailPath(SIZE, path);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.tileIds).toEqual(path);
        expect(path).toEqual(frozen);
        expect(deriveRailPath(SIZE, path)).toEqual(result);
        const expectedMasks = new Map(path.map((tileId) => [tileId, 0]));
        const bit = (dx: number, dy: number): number => (
          dx === 0 && dy === -1 ? 1 : dx === 1 && dy === 0 ? 2 : dx === 0 && dy === 1 ? 4 : 8
        );
        for (let index = 0; index + 1 < path.length; index += 1) {
          const from = path[index]!;
          const to = path[index + 1]!;
          const dx = to % SIZE - from % SIZE;
          const dy = Math.floor(to / SIZE) - Math.floor(from / SIZE);
          expectedMasks.set(from, (expectedMasks.get(from) ?? 0) | bit(dx, dy));
          expectedMasks.set(to, (expectedMasks.get(to) ?? 0) | bit(-dx, -dy));
        }
        expect(result.tiles).toEqual(path.map((tileId) => ({
          tileId, connectionMask: expectedMasks.get(tileId) ?? 0,
        })));
      },
    ), { numRuns: 128 });
  });
});

describe('atomic rail world command', () => {
  it('places extensions, curves, T/four-way junctions, and ordinary-road/Avenue crossings', () => {
    let state = city();
    const horizontal = Array.from({ length: 9 }, (_, index) => tile(6 + index, 12));
    let result = applyWorldCommand(state, { type: 'place-rail', path: horizontal });
    expect(result.ok).toBe(true);
    state = result.state;

    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(14, 12), tile(15, 12), tile(15, 13)] });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.map.railConnectionMasks[tile(14, 12)]).toBe(10);

    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(10, 8), tile(10, 9), tile(10, 10), tile(10, 11), tile(10, 12)] });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.map.railConnectionMasks[tile(10, 12)]).toBe(11);
    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(10, 12), tile(10, 13), tile(10, 14)] });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(state.map.railConnectionMasks[tile(10, 12)]).toBe(15);

    const roadCrossing = applyWorldCommand(state, { type: 'place-road', tileIds: [tile(9, 12)] });
    expect(roadCrossing.ok).toBe(true);
    state = roadCrossing.state;
    const avenueCrossing = applyWorldCommand(state, {
      type: 'place-avenue', path: [tile(7, 12), tile(8, 12)], expansionSide: 'right',
    });
    expect(avenueCrossing.ok).toBe(true);
    state = avenueCrossing.state;
    expect(state.map.roads[tile(9, 12)] && state.map.rails[tile(9, 12)]).toBe(true);
    expect(state.map.avenueLanes[tile(7, 12)] && state.map.rails[tile(7, 12)]).toBe(true);
    expect(() => validateMarketCityState(state)).not.toThrow();
  });

  it('rejects the entire path across occupancy, fire locks, bounds, or malformed order without mutation', () => {
    const opening = city();
    opening.map.zones[tile(8, 8)] = 'R';
    opening.economy.density[tile(8, 8)] = 0.4;
    const originalHash = hashDeterministicState(opening);
    const rejected = applyWorldCommand(opening, {
      type: 'place-rail', path: [tile(6, 8), tile(7, 8), tile(8, 8), tile(9, 8)],
    });
    expect(rejected).toMatchObject({ ok: false, state: opening, changedTileIds: [] });
    expect(hashDeterministicState(opening)).toBe(originalHash);

    const locked = city();
    const lockedTile = tile(7, 8);
    const incidentId = `fire-m1-t${lockedTile}`;
    locked.map.zones[lockedTile] = 'R';
    locked.economy.density[lockedTile] = 0.8;
    locked.economy.wealth[lockedTile] = 18_000;
    locked.fire.incidents.push({
      id: incidentId, status: 'burning', tileIds: [lockedTile], zone: 'R', startedMonth: 1,
      structure: {
        footprint: '1x1', originTile: lockedTile, height: 4, roof: 'flat', roofHeight: 1,
        roofOrientation: 0, detail: 'windows', color: [112, 204, 124], landmark: false,
      },
      intensity: 0.6, damage: 2, age: 3, rubbleMonthsRemaining: 0,
    });
    locked.clock.month = 1;
    locked.fire.history.push({
      sequence: 1, month: 1, incidentId, event: 'ignited', tileIds: [lockedTile],
      zone: 'R', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
    });
    expect(applyWorldCommand(locked, {
      type: 'place-rail', path: [tile(6, 8), lockedTile, tile(8, 8)],
    })).toMatchObject({ ok: false, state: locked, changedTileIds: [] });
    expect(applyWorldCommand(city(), {
      type: 'place-rail', path: [tile(47, 1), tile(0, 2)],
    })).toMatchObject({ ok: false, changedTileIds: [] });
  });

  it('bulldozes a rail cell, clears reciprocal masks, and reports every changed neighbor', () => {
    const opening = city();
    const path = [tile(8, 8), tile(9, 8), tile(10, 8)];
    const placed = applyWorldCommand(opening, { type: 'place-rail', path });
    expect(placed.ok).toBe(true);
    const removed = applyWorldCommand(placed.state, { type: 'demolish', tileIds: [tile(9, 8)] });
    expect(removed.ok).toBe(true);
    expect(removed.changedTileIds).toEqual(path);
    expect(removed.state.map.rails[tile(9, 8)]).toBe(false);
    expect(removed.state.map.railConnectionMasks[tile(8, 8)]).toBe(0);
    expect(removed.state.map.railConnectionMasks[tile(10, 8)]).toBe(0);
    expect(() => validateMarketCityState(removed.state)).not.toThrow();
  });

  it('persists exact topology and exposes inspector fields', () => {
    const path = [tile(8, 8), tile(9, 8), tile(10, 8)];
    const placed = applyWorldCommand(city(), { type: 'place-rail', path });
    expect(placed.ok).toBe(true);
    expect(deriveTileInspection(placed.state, tile(9, 8))).toMatchObject({
      rail: true, railConnectionMask: 10, railComponentId: 'rail:392', railRidership: 0,
    });
    expect(restoreMarketCityState(serializeMarketCityState(placed.state))).toEqual(placed.state);
  });
});

describe('Train Station operation and deterministic shuttle topology', () => {
  it('places the exact 2x2 footprint but stays inactive until its atomic power and water allocations succeed', () => {
    let state = city();
    let result = applyWorldCommand(state, { type: 'place-facility', kind: 'train-station', anchor: tile(10, 10) });
    expect(result.ok).toBe(true);
    state = result.state;
    const placed = state.map.facilities.find((facility) => facility.kind === 'train-station')!;
    expect(placed.tiles).toEqual([tile(10, 10), tile(11, 10), tile(10, 11), tile(11, 11)]);
    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      stationId: placed.id, roadAccess: false, componentId: null, attachmentTileIds: [], operational: false,
      inactiveReason: 'No road access within 3 tiles. No rail component adjacent to the station footprint. No allocated power capacity. No allocated water service.',
    });

    result = applyWorldCommand(state, { type: 'place-road', tileIds: [tile(10, 9)] });
    expect(result.ok).toBe(true);
    state = result.state;
    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(10, 12)] });
    expect(result.ok).toBe(true);
    state = result.state;
    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      roadAccess: true, componentId: 'rail:586', attachmentTileIds: [tile(10, 12)],
      railAccess: true,
      powerAccess: false,
      waterAccess: false,
      operational: false,
      inactiveReason: 'No allocated power capacity. No allocated water service.',
    });
    expect(state.environment.powered.every((value) => !value)).toBe(true);
    expect(state.environment.watered.every((value) => !value)).toBe(true);

    provideTrainStationUtilities(state);
    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true,
      operational: true, inactiveReason: null, waterComponentId: 'water:0',
    });
  });

  it('reserves power and water even before road and Rail gates are met', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 10, 10));
    provideTrainStationUtilities(state);

    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      roadAccess: false,
      railAccess: false,
      powerAccess: true,
      waterAccess: true,
      operational: false,
      inactiveReason: 'No road access within 3 tiles. No rail component adjacent to the station footprint.',
    });
  });

  it('accepts an Avenue as the station shared-road surface at radius three', () => {
    let state = city();
    let result = applyWorldCommand(state, { type: 'place-facility', kind: 'train-station', anchor: tile(10, 10) });
    expect(result.ok).toBe(true); state = result.state;
    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(10, 12)] });
    expect(result.ok).toBe(true); state = result.state;
    result = applyWorldCommand(state, {
      type: 'place-avenue', path: [tile(10, 7), tile(11, 7)], expansionSide: 'right',
    });
    expect(result.ok).toBe(true); state = result.state;
    provideTrainStationUtilities(state);
    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      roadAccess: true, railAccess: true, operational: true,
    });
  });

  it('assigns a station touching multiple components to the canonical lowest component', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 10, 10));
    roadAt(state, 10, 9);
    connectRail(state, [tile(9, 10), tile(9, 11)]);
    connectRail(state, [tile(12, 10), tile(12, 11)]);
    provideTrainStationUtilities(state);
    expect(deriveRailTopology(state).stations[0]).toMatchObject({
      componentId: `rail:${tile(9, 10)}`,
      attachmentTileIds: [tile(9, 10), tile(9, 11)],
      operational: true,
    });
  });

  it('does not create a zero-edge shuttle when two stations touch only one singleton rail', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 10, 10), station('station-b', 10, 13));
    roadAt(state, 10, 9); roadAt(state, 10, 15);
    connectRail(state, [tile(10, 12)]);
    provideTrainStationUtilities(state);
    const topology = deriveRailTopology(state);
    expect(topology.stations.every((entry) => entry.operational)).toBe(true);
    expect(topology.shuttleLegs).toEqual([]);
  });

  it('selects canonical shortest paths and a deterministic MST independent of facility insertion order', () => {
    const opening = city();
    const stations = [station('station-c', 18, 2), station('station-a', 2, 2), station('station-b', 10, 2)];
    opening.map.facilities.push(...stations);
    for (const x of [2, 10, 18]) roadAt(opening, x, 1);
    connectRail(opening, Array.from({ length: 16 }, (_, index) => tile(3 + index, 4)));
    provideTrainStationUtilities(opening);
    const result = deriveRailTopology(opening);
    expect(result.components).toEqual([{ id: `rail:${tile(3, 4)}`, tileIds: Array.from({ length: 16 }, (_, index) => tile(3 + index, 4)) }]);
    expect(result.shuttleLegs.map((leg) => ({
      stations: [leg.stationAId, leg.stationBId], path: leg.pathTileIds, length: leg.pathLength,
    }))).toEqual([
      { stations: ['station-a', 'station-b'], path: Array.from({ length: 8 }, (_, index) => tile(3 + index, 4)), length: 7 },
      { stations: ['station-b', 'station-c'], path: Array.from({ length: 8 }, (_, index) => tile(11 + index, 4)), length: 7 },
    ]);

    const reordered = city();
    reordered.map.facilities.push(...stations.slice().reverse());
    for (const x of [2, 10, 18]) roadAt(reordered, x, 1);
    connectRail(reordered, Array.from({ length: 16 }, (_, index) => tile(3 + index, 4)));
    provideTrainStationUtilities(reordered);
    expect(deriveRailTopology(reordered)).toEqual(result);
  });

  it('chooses the lexicographically smallest complete route when shortest paths tie', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 1, 4), station('station-b', 10, 4));
    roadAt(state, 1, 3); roadAt(state, 10, 3);
    const source = tile(3, 4);
    const target = tile(9, 4);
    const upper = [
      source, tile(4, 4),
      ...Array.from({ length: 5 }, (_, index) => tile(4 + index, 3)),
      tile(8, 4), target,
    ];
    const lower = [
      source, tile(4, 4),
      ...Array.from({ length: 5 }, (_, index) => tile(4 + index, 5)),
      tile(8, 4), target,
    ];
    connectRail(state, upper);
    connectRail(state, lower);
    provideTrainStationUtilities(state);

    const [leg] = deriveRailTopology(state).shuttleLegs;
    expect(leg?.pathLength).toBe(8);
    expect(leg?.pathTileIds).toEqual(upper);
  });

  it('derives one shuttle tree per disconnected component without cross-component legs', () => {
    const state = city();
    state.map.facilities.push(
      station('station-a', 2, 2), station('station-b', 10, 2),
      station('station-c', 2, 12), station('station-d', 10, 12),
    );
    for (const [x, y] of [[2, 1], [10, 1], [2, 11], [10, 11]] as const) roadAt(state, x, y);
    connectRail(state, Array.from({ length: 8 }, (_, index) => tile(3 + index, 4)));
    connectRail(state, Array.from({ length: 8 }, (_, index) => tile(3 + index, 14)));
    provideTrainStationUtilities(state);

    const topology = deriveRailTopology(state);
    expect(topology.shuttleLegs).toHaveLength(2);
    expect(topology.shuttleLegs.map(({ componentId, stationAId, stationBId }) => ({
      componentId, stationAId, stationBId,
    }))).toEqual([
      { componentId: `rail:${tile(3, 4)}`, stationAId: 'station-a', stationBId: 'station-b' },
      { componentId: `rail:${tile(3, 14)}`, stationAId: 'station-c', stationBId: 'station-d' },
    ]);
  });

  it('severs and deterministically restores shuttle service', () => {
    let state = city();
    let result = applyWorldCommand(state, { type: 'place-facility', kind: 'train-station', anchor: tile(2, 2) });
    expect(result.ok).toBe(true); state = result.state;
    result = applyWorldCommand(state, { type: 'place-facility', kind: 'train-station', anchor: tile(10, 2) });
    expect(result.ok).toBe(true); state = result.state;
    result = applyWorldCommand(state, { type: 'place-road', tileIds: [tile(2, 1), tile(10, 1)] });
    expect(result.ok).toBe(true); state = result.state;
    const path = Array.from({ length: 8 }, (_, index) => tile(3 + index, 4));
    result = applyWorldCommand(state, { type: 'place-rail', path });
    expect(result.ok).toBe(true); state = result.state;
    provideTrainStationUtilities(state);
    const originalLeg = deriveRailTopology(state).shuttleLegs[0];
    expect(originalLeg).toBeDefined();
    result = applyWorldCommand(state, { type: 'demolish', tileIds: [tile(7, 4)] });
    expect(result.ok).toBe(true); state = result.state;
    expect(deriveRailTopology(state).shuttleLegs).toEqual([]);
    result = applyWorldCommand(state, { type: 'place-rail', path: [tile(6, 4), tile(7, 4), tile(8, 4)] });
    expect(result.ok).toBe(true);
    expect(deriveRailTopology(result.state).shuttleLegs).toEqual([originalLeg]);
  });

  it('removes active train legs when water allocation fails and restores them without topology changes', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 2, 2), station('station-b', 10, 2));
    roadAt(state, 2, 1); roadAt(state, 10, 1);
    connectRail(state, Array.from({ length: 8 }, (_, index) => tile(3 + index, 4)));
    provideTrainStationUtilities(state);
    const originalLegs = deriveRailTopology(state).shuttleLegs;
    expect(originalLegs).toHaveLength(1);

    state.map.waterPipes.fill(false);
    const dry = deriveRailTopology(state);
    expect(dry.stations.every((entry) => entry.powerAccess && !entry.waterAccess)).toBe(true);
    expect(dry.stations.every((entry) => entry.inactiveReason === 'No allocated water service.')).toBe(true);
    expect(dry.shuttleLegs).toEqual([]);

    state.map.waterPipes.fill(true);
    expect(deriveRailTopology(state).shuttleLegs).toEqual(originalLegs);
  });

  it('migrates a 2.11 station save without changing its physical map and recalculates utilities', () => {
    const state = city();
    const placed = station('legacy-station', 10, 10);
    state.map.facilities.push(placed);
    roadAt(state, 10, 9);
    connectRail(state, [tile(10, 12)]);
    provideTrainStationUtilities(state);
    const physicalMap = structuredClone(state.map);
    const legacy = JSON.parse(serializeMarketCityState(state)) as MarketCityStateV2;
    (legacy as unknown as { rulesVersion: string }).rulesVersion = MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES;
    legacy.environment.powered.fill(false);
    legacy.environment.watered.fill(false);

    const migrated = restoreMarketCityState(JSON.stringify(legacy));
    expect(migrated.rulesVersion).toBe(MARKET_CITY_RULES_VERSION);
    expect(migrated.map).toEqual(physicalMap);
    expect(deriveRailTopology(migrated).stations[0]).toMatchObject({
      stationId: placed.id, roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true, operational: true,
    });
  });
});

describe('informational passenger ridership', () => {
  it('uses Manhattan radius six, full C/I job stock, and the exact bidirectional leg formula', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 2, 2), station('station-b', 20, 2));
    roadAt(state, 2, 1); roadAt(state, 20, 1);
    connectRail(state, Array.from({ length: 18 }, (_, index) => tile(3 + index, 4)));

    const residentA = tile(2, 9); // six below the station footprint at y=3
    const outsideA = tile(2, 10); // seven: excluded
    const commercialB = tile(20, 9);
    const industrialB = tile(21, 9);
    const residentB = tile(26, 3); // five from the station footprint at x=21
    const industrialA = tile(8, 3); // five from the station footprint at x=3
    for (const [id, zone, density] of [
      [residentA, 'R', 0.5], [outsideA, 'R', 1], [commercialB, 'C', 0.2],
      [industrialB, 'I', 0.3], [residentB, 'R', 0.1], [industrialA, 'I', 0.4],
    ] as const) {
      state.map.zones[id] = zone;
      state.economy.density[id] = density;
    }

    provideTrainStationUtilities(state);
    const derived = derivePassengerRailService(state);
    // A: 50 residents / 40 jobs. B: 10 residents / 50 jobs. usage = 50 + 10.
    expect(derived.topology.shuttleLegs[0]?.ridership).toBe(60);
    expect(derived.service.totalRidership).toBe(60);
    expect(derived.service.stationUsage).toEqual([
      { stationId: 'station-a', ridership: 60 },
      { stationId: 'station-b', ridership: 60 },
    ]);
    expect(derived.service.tileUsage.filter((usage) => usage > 0)).toHaveLength(18);
  });

  it('persists canonical service, rejects tampering, and recomputes monthly without market effects', () => {
    let state = city();
    state.map.facilities.push(station('station-a', 2, 2), station('station-b', 10, 2));
    roadAt(state, 2, 1); roadAt(state, 10, 1);
    connectRail(state, Array.from({ length: 8 }, (_, index) => tile(3 + index, 4)));
    state.map.zones[tile(2, 9)] = 'R'; state.economy.density[tile(2, 9)] = 0.4;
    state.map.zones[tile(10, 9)] = 'C'; state.economy.density[tile(10, 9)] = 0.3;
    provideTrainStationUtilities(state);
    state = stepMonth(state);
    // Unserved zones first respect their local density cap, then decline by 0.05
    // before end-of-month ridership is settled.
    expect(state.services.rail.totalRidership).toBe(10);
    expect(restoreMarketCityState(serializeMarketCityState(state))).toEqual(state);

    const tampered = structuredClone(state);
    tampered.services.rail.totalRidership += 1;
    expect(() => validateMarketCityState(tampered)).toThrow(/rail/i);
    const coherentlyForged = structuredClone(state);
    coherentlyForged.services.rail.totalRidership += 1;
    for (const usage of coherentlyForged.services.rail.stationUsage) usage.ridership += 1;
    for (let tileId = 0; tileId < coherentlyForged.services.rail.tileUsage.length; tileId += 1) {
      if ((coherentlyForged.services.rail.tileUsage[tileId] ?? 0) > 0) {
        coherentlyForged.services.rail.tileUsage[tileId] = (coherentlyForged.services.rail.tileUsage[tileId] ?? 0) + 1;
      }
    }
    expect(() => validateMarketCityState(coherentlyForged)).toThrow(/canonical passenger rail/i);
    expect(deriveCongestion(state).every((value) => value === 0)).toBe(true);
  });

  it('clears canonical service when the final route and stations are demolished before save', () => {
    let state = city();
    const first = station('station-a', 2, 2);
    const second = station('station-b', 10, 2);
    state.map.facilities.push(first, second);
    roadAt(state, 2, 1); roadAt(state, 10, 1);
    const path = Array.from({ length: 8 }, (_, index) => tile(3 + index, 4));
    connectRail(state, path);
    state.map.zones[tile(2, 9)] = 'R'; state.economy.density[tile(2, 9)] = 0.4;
    state.map.zones[tile(10, 9)] = 'C'; state.economy.density[tile(10, 9)] = 0.3;
    provideTrainStationUtilities(state);
    state = stepMonth(state);
    expect(state.services.rail.totalRidership).toBeGreaterThan(0);

    const removed = applyWorldCommand(state, {
      type: 'demolish', tileIds: [...first.tiles, ...second.tiles, ...path],
    });
    expect(removed.ok).toBe(true);
    expect(removed.state.map.rails.every((rail) => !rail)).toBe(true);
    expect(removed.state.map.facilities.some((facility) => facility.kind === 'train-station')).toBe(false);
    expect(removed.state.services.rail).toEqual({
      totalRidership: 0,
      tileUsage: Array<number>(SIZE * SIZE).fill(0),
      stationUsage: [],
    });
    expect(() => validateMarketCityState(removed.state)).not.toThrow();
    expect(restoreMarketCityState(serializeMarketCityState(removed.state))).toEqual(removed.state);
  });

  it('keeps impossible one-station service canonical-empty and rejects zero-valued records', () => {
    const state = city();
    state.map.facilities.push(station('station-a', 2, 2));
    roadAt(state, 2, 1);
    connectRail(state, [tile(3, 4), tile(4, 4)]);
    expect(() => validateMarketCityState(state)).not.toThrow();

    const tampered = structuredClone(state);
    tampered.services.rail.stationUsage.push({ stationId: 'station-a', ridership: 0 });
    expect(() => validateMarketCityState(tampered)).toThrow(/rail.*empty|passenger leg/i);
  });
});

describe('active rail contracts and economics', () => {
  it('activates the Rail and Train Station manifest/catalog contracts', () => {
    expect(MARKET_NETWORK_CATALOG.rail).toMatchObject({
      kind: 'rail', label: 'Rail', category: 'transit', footprint: { width: 1, height: 1 },
      monthlyMaintenancePerTile: 0,
    });
    expect(MARKET_FACILITY_CATALOG['train-station']).toMatchObject({
      kind: 'train-station', label: 'Train Station', category: 'transit',
      footprint: { width: 2, height: 2 }, monthlyMaintenance: 0, serviceRadius: 6,
      capabilities: expect.arrayContaining(['road-gated', 'rail-adjacent', 'power-gated', 'water-covered']),
    });
    expect(MARKET_CITY_RULES.transit).toEqual({ trainStationPowerLoad: 20, trainStationWaterDemand: 50 });
    for (const id of ['rail', 'train-station']) {
      expect(MARKET_ITEM_MANIFEST.find((item) => item.id === id)).toMatchObject({
        status: 'active', contracts: {
          ui: expect.any(String), engine: expect.any(String), renderer: expect.any(String),
          inspector: expect.any(String), persistence: expect.any(String), browser: expect.any(String),
        },
      });
    }
  });

  it('does not charge Train Stations as Fire Stations', () => {
    const opening = city();
    opening.map.facilities.push(station('station-a', 2, 2));
    const stepped = stepMonth(opening);
    expect(stepped.economy.lastOperatingExpense).toBe(0);
    expect(MARKET_CITY_RULES.fireStationMonthlyExpense).toBeGreaterThan(0);
  });
});
