import { describe, expect, it } from 'vitest';
import {
  MARKET_CITY_STORAGE_NAMESPACE,
  cloneMarketCityState,
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import { applyWorldCommand } from '../../src/market-city/commands';
import { deriveDensityCaps } from '../../src/market-city/spatial';
import {
  MARKET_CITY_RULES_VERSION,
  type MarketCityStateV2,
  type MarketCityWorldCommand,
} from '../../src/market-city/types';

const SIZE = 48;
const TILES = SIZE * SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function city() {
  return createMarketCityState({
    cityId: 'state-command-test',
    cityName: 'State Command Test',
    mayorName: 'Ada',
    seed: 17,
    createdAt: '2026-08-11T00:00:00.000Z',
  });
}

function cityWithLockedFire(status: 'burning' | 'rubble' = 'burning'): MarketCityStateV2 {
  const state = city();
  const locked = tile(10, 10);
  state.map.zones[locked] = 'R';
  state.economy.density[locked] = status === 'burning' ? 0.8 : 0;
  state.economy.wealth[locked] = status === 'burning' ? 18_000 : 0;
  const fire = {
    id: `fire-m1-t${locked}`,
    status,
    tileIds: [locked],
    zone: 'R',
    startedMonth: 1,
    structure: {
      footprint: '1x1', originTile: locked, height: 4, roof: 'flat', roofHeight: 1,
      roofOrientation: 0, detail: 'windows', color: [112, 204, 124], landmark: false,
    },
    intensity: status === 'burning' ? 0.6 : 0,
    damage: status === 'burning' ? 2 : 11,
    age: status === 'burning' ? 3 : 12,
    rubbleMonthsRemaining: status === 'rubble' ? 50 : 0,
  } satisfies MarketCityStateV2['fire']['incidents'][number];
  state.fire.incidents.push(fire);
  state.clock.month = 1;
  state.fire.history.push({
    sequence: 1, month: 1, incidentId: fire.id, event: 'ignited', tileIds: [locked],
    zone: 'R', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
  });
  if (status === 'rubble') {
    state.fire.char[locked] = 1;
    state.fire.collapsedTotal = 1;
    state.fire.history.push({
      sequence: 2, month: 1, incidentId: fire.id, event: 'collapsed', tileIds: [locked],
      zone: 'R', intensity: 0, damage: fire.damage, rubbleMonthsRemaining: 50,
    });
  }
  return state;
}

describe('fresh MarketCityStateV2', () => {
  it('uses a fresh namespace and creates a deterministic zeroed 48x48 state', () => {
    const first = city();
    const second = city();

    expect(MARKET_CITY_STORAGE_NAMESPACE).toBe('synthcity-market-v2');
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schemaVersion: 2,
      rulesVersion: MARKET_CITY_RULES_VERSION,
      clock: { month: 0, paused: true, speed: 1, fireDifficulty: 'normal' },
      economy: {
        treasury: 5_000,
        lastRevenue: 0,
        lastOperatingExpense: 0,
        lastNet: 0,
      },
      market: {
        demand: { R: 0, C: 0, I: 0 },
        margin: { R: 0, C: 0, I: 0 },
      },
    });
    expect(first.map.size).toBe(SIZE);
    expect(first.map.zones).toHaveLength(TILES);
    expect(first.map.zones.every((value) => value === null)).toBe(true);
    expect(first.map.roads.every((value) => value === false)).toBe(true);
    expect(first.map.powerLines.every((value) => value === false)).toBe(true);
    expect(first.economy.density.every((value) => value === 0)).toBe(true);
    expect(first.environment.powered.every((value) => value === false)).toBe(true);
    expect(first.fire.incidents).toEqual([]);
    expect(first.fire.history).toEqual([]);
  });

  it('accepts a terrain fixture without retaining references to it', () => {
    const water = Array<boolean>(TILES).fill(false);
    const elevation = Array<number>(TILES).fill(2);
    const material = Array<'sand'>(TILES).fill('sand');
    water[tile(4, 5)] = true;

    const state = createMarketCityState({}, { water, elevation, material });
    water[tile(4, 5)] = false;
    elevation[0] = 99;

    expect(state.map.terrain.water[tile(4, 5)]).toBe(true);
    expect(state.map.terrain.elevation[0]).toBe(2);
    expect(state.map.terrain.material[0]).toBe('sand');
    expect(state.map.terrain.trees.every((value) => value === 0)).toBe(true);
  });

  it('deep-clones and round-trips through canonical JSON and a stable hash', () => {
    const original = city();
    const zoned = applyWorldCommand(original, { type: 'zone', tileIds: [tile(8, 8)], zone: 'R' }).state;
    const clone = cloneMarketCityState(zoned);
    const json = serializeMarketCityState(zoned);
    const restored = restoreMarketCityState(json);

    expect(clone).toEqual(zoned);
    expect(clone).not.toBe(zoned);
    expect(clone.map.zones).not.toBe(zoned.map.zones);
    expect(restored).toEqual(zoned);
    expect(hashDeterministicState(restored)).toBe(hashDeterministicState(zoned));
    expect(serializeMarketCityState(restored)).toBe(json);

    clone.map.zones[tile(8, 8)] = 'I';
    expect(zoned.map.zones[tile(8, 8)]).toBe('R');
  });

  it.each(['burning', 'rubble'] as const)('round-trips an exact pinned %s incident and history', (status) => {
    const original = cityWithLockedFire(status);

    const serialized = serializeMarketCityState(original);
    const restored = restoreMarketCityState(serialized);

    expect(restored.fire).toEqual(original.fire);
    expect(hashDeterministicState(restored)).toBe(hashDeterministicState(original));
    expect(serializeMarketCityState(restored)).toBe(serialized);
  });

  it('strictly rejects old schemas, wrong rules, extra keys, and malformed arrays', () => {
    const valid = JSON.parse(serializeMarketCityState(city())) as Record<string, unknown>;

    expect(() => restoreMarketCityState(JSON.stringify({ ...valid, schemaVersion: 5 })))
      .toThrow(/schemaVersion/i);
    expect(() => restoreMarketCityState(JSON.stringify({ ...valid, rulesVersion: 'synthcity-gameplay-5.1.0' })))
      .toThrow(/rulesVersion/i);
    expect(() => restoreMarketCityState(JSON.stringify({ ...valid, legacy: true })))
      .toThrow(/unexpected key/i);

    const malformed = structuredClone(valid) as {
      economy: { density: number[] };
    };
    malformed.economy.density.pop();
    expect(() => validateMarketCityState(malformed)).toThrow(/economy\.density/i);
  });

  it('rejects incident footprints and history that cannot be authoritative', () => {
    const malformedFootprint = cityWithLockedFire();
    const incident = malformedFootprint.fire.incidents[0]!;
    const second = tile(11, 10);
    malformedFootprint.map.zones[second] = 'R';
    incident.tileIds.push(second);
    incident.structure.footprint = '2x2';
    malformedFootprint.clock.month = 1;
    malformedFootprint.fire.history[0]!.tileIds = [...incident.tileIds];
    expect(() => validateMarketCityState(malformedFootprint)).toThrow(/footprint.*geometry/i);

    const futureHistory = cityWithLockedFire();
    futureHistory.clock.month = 1;
    futureHistory.fire.history[0]!.month = 2;
    expect(() => validateMarketCityState(futureHistory)).toThrow(/future/i);

    const futureIncident = cityWithLockedFire();
    futureIncident.fire.incidents[0]!.startedMonth = 2;
    futureIncident.fire.incidents[0]!.id = `fire-m2-t${futureIncident.fire.incidents[0]!.structure.originTile}`;
    expect(() => validateMarketCityState(futureIncident)).toThrow(/future/i);

    const excessiveRubble = cityWithLockedFire('rubble');
    excessiveRubble.fire.incidents[0]!.rubbleMonthsRemaining = 51;
    expect(() => validateMarketCityState(excessiveRubble)).toThrow(/rubble.*duration/i);

    const earlyClear = cityWithLockedFire('rubble');
    earlyClear.clock.month = 2;
    earlyClear.fire.incidents = [];
    earlyClear.fire.history.push({
      sequence: 3, month: 2, incidentId: earlyClear.fire.history[0]!.incidentId,
      event: 'rubble-cleared', tileIds: [...earlyClear.fire.history[0]!.tileIds], zone: 'R',
      intensity: 0, damage: 11, rubbleMonthsRemaining: 0,
    });
    expect(() => validateMarketCityState(earlyClear)).toThrow(/impossible.*transition/i);

    const impossibleHistory = cityWithLockedFire();
    const impossible = impossibleHistory.fire.incidents[0]!;
    impossibleHistory.clock.month = 2;
    impossibleHistory.fire.history = [
      {
        sequence: 1, month: 1, incidentId: impossible.id, event: 'ignited',
        tileIds: [...impossible.tileIds], zone: impossible.zone, intensity: 0.04,
        damage: 0, rubbleMonthsRemaining: 0,
      },
      {
        sequence: 2, month: 2, incidentId: impossible.id, event: 'suppressed',
        tileIds: [...impossible.tileIds], zone: impossible.zone, intensity: 0,
        damage: 0, rubbleMonthsRemaining: 0,
      },
      {
        sequence: 3, month: 2, incidentId: impossible.id, event: 'burning',
        tileIds: [...impossible.tileIds], zone: impossible.zone, intensity: 0.2,
        damage: 0.2, rubbleMonthsRemaining: 0,
      },
    ];
    impossibleHistory.fire.suppressedTotal = 1;
    expect(() => validateMarketCityState(impossibleHistory)).toThrow(/impossible.*transition/i);
  });
});

describe('free immutable world commands', () => {
  it.each([
    {
      name: 'Road',
      command: (target: number): MarketCityWorldCommand => ({ type: 'place-road', tileIds: [target] }),
      targets: (target: number): number[] => [target],
    },
    {
      name: 'Power line',
      command: (target: number): MarketCityWorldCommand => ({ type: 'place-power-line', tileIds: [target] }),
      targets: (target: number): number[] => [target],
    },
    {
      name: 'Rail',
      command: (target: number): MarketCityWorldCommand => ({ type: 'place-rail', path: [target] }),
      targets: (target: number): number[] => [target],
    },
    {
      name: 'Avenue',
      command: (target: number): MarketCityWorldCommand => ({
        type: 'place-avenue', path: [target, target + 1], expansionSide: 'left',
      }),
      targets: (target: number): number[] => [target],
    },
    {
      name: 'Fire Station',
      command: (target: number): MarketCityWorldCommand => ({ type: 'place-facility', kind: 'fire-station', anchor: target }),
      targets: (target: number): number[] => [target],
    },
  ])('replaces empty RCI and landfill zoning with $name placement', ({ command, targets }) => {
    const target = tile(20, 20);
    for (const zoning of ['rci', 'landfill'] as const) {
      const opening = city();
      for (const targetTile of targets(target)) {
        if (zoning === 'rci') {
          opening.map.zones[targetTile] = 'R';
          opening.economy.density[targetTile] = 0;
          opening.economy.wealth[targetTile] = 5_000;
        } else {
          opening.map.landfillZones[targetTile] = true;
        }
      }

      const placed = applyWorldCommand(opening, command(target));

      expect(placed.ok).toBe(true);
      for (const targetTile of targets(target)) {
        expect(placed.state.map.zones[targetTile]).toBeNull();
        expect(placed.state.map.landfillZones[targetTile]).toBe(false);
        expect(placed.state.economy.density[targetTile]).toBe(0);
        expect(placed.state.economy.wealth[targetTile]).toBe(0);
      }
      expect(() => validateMarketCityState(placed.state)).not.toThrow();
    }
  });

  it('keeps developed RCI and waste-filled landfill protected from physical replacement', () => {
    const developed = city();
    const rci = tile(22, 22);
    developed.map.zones[rci] = 'C';
    developed.economy.density[rci] = 0.4;
    developed.economy.wealth[rci] = 12_000;
    const beforeDeveloped = hashDeterministicState(developed);
    const rejectedRci = applyWorldCommand(developed, { type: 'place-road', tileIds: [rci] });
    expect(rejectedRci).toMatchObject({ ok: false, state: developed, changedTileIds: [] });
    expect(hashDeterministicState(developed)).toBe(beforeDeveloped);

    const filled = city();
    const landfill = tile(24, 22);
    filled.map.landfillZones[landfill] = true;
    filled.services.waste.storedByTile[landfill] = 1;
    filled.services.waste.generatedLifetime = 1;
    filled.services.waste.landfilledLifetime = 1;
    const beforeFilled = hashDeterministicState(filled);
    const rejectedLandfill = applyWorldCommand(filled, { type: 'place-road', tileIds: [landfill] });
    expect(rejectedLandfill).toMatchObject({ ok: false, state: filled, changedTileIds: [] });
    expect(hashDeterministicState(filled)).toBe(beforeFilled);
  });

  it('preserves V2 surface-layer invariants for existing placement, demolition, and flooding commands', () => {
    const opening = city();
    const railLeft = tile(20, 20);
    const railRight = tile(21, 20);
    opening.map.rails[railLeft] = true;
    opening.map.rails[railRight] = true;
    opening.map.railConnectionMasks[railLeft] = 2;
    opening.map.railConnectionMasks[railRight] = 8;

    const rejectedZone = applyWorldCommand(opening, { type: 'zone', zone: 'R', tileIds: [railLeft] });
    expect(rejectedZone).toMatchObject({ ok: false, state: opening, changedTileIds: [] });
    expect(rejectedZone.reason).toMatch(/occupied surface/i);
    expect(opening.map.zones[railLeft]).toBeNull();
    expect(opening.map.rails[railLeft]).toBe(true);
    expect(opening.map.railConnectionMasks[railLeft]).toBe(2);

    const crossing = applyWorldCommand(opening, { type: 'place-road', tileIds: [railLeft] });
    expect(crossing.ok).toBe(true);
    expect(crossing.state.map.roads[railLeft]).toBe(true);
    expect(crossing.state.map.rails[railLeft]).toBe(true);
    expect(() => validateMarketCityState(crossing.state)).not.toThrow();

    const flooded = applyWorldCommand(crossing.state, {
      type: 'paint-terrain', tileIds: [railLeft], water: true,
    });
    expect(flooded.ok).toBe(true);
    expect(flooded.state.map.roads[railLeft]).toBe(false);
    expect(flooded.state.map.rails[railLeft]).toBe(false);
    expect(flooded.state.map.railConnectionMasks[railLeft]).toBe(0);
    expect(flooded.state.map.railConnectionMasks[railRight]).toBe(0);
    expect(() => validateMarketCityState(flooded.state)).not.toThrow();

    const landfill = city();
    const landfillTile = tile(30, 30);
    landfill.map.landfillZones[landfillTile] = true;
    landfill.services.waste.generatedLifetime = 1;
    landfill.services.waste.landfilledLifetime = 1;
    landfill.services.waste.storedByTile[landfillTile] = 1;
    expect(() => validateMarketCityState(landfill)).not.toThrow();
    const refused = applyWorldCommand(landfill, { type: 'demolish', tileIds: [landfillTile] });
    expect(refused).toMatchObject({ ok: false, state: landfill, changedTileIds: [] });
    expect(refused.reason).toBe('Landfill contains garbage.');
  });

  it('lets ordinary Road or Rail and a Power Line share one tile in either placement order', () => {
    const crossing = tile(20, 20);

    const roadFirst = applyWorldCommand(city(), { type: 'place-road', tileIds: [crossing] });
    expect(roadFirst.ok).toBe(true);
    const powerOverRoad = applyWorldCommand(roadFirst.state, { type: 'place-power-line', tileIds: [crossing] });
    expect(powerOverRoad).toMatchObject({ ok: true, changedTileIds: [crossing] });
    expect(powerOverRoad.state.map.roads[crossing]).toBe(true);
    expect(powerOverRoad.state.map.powerLines[crossing]).toBe(true);
    expect(() => validateMarketCityState(powerOverRoad.state)).not.toThrow();
    expect(restoreMarketCityState(serializeMarketCityState(powerOverRoad.state))).toEqual(powerOverRoad.state);

    const powerFirst = applyWorldCommand(city(), { type: 'place-power-line', tileIds: [crossing] });
    expect(powerFirst.ok).toBe(true);
    const roadOverPower = applyWorldCommand(powerFirst.state, { type: 'place-road', tileIds: [crossing] });
    expect(roadOverPower).toMatchObject({ ok: true, changedTileIds: [crossing] });
    expect(roadOverPower.state.map.roads[crossing]).toBe(true);
    expect(roadOverPower.state.map.powerLines[crossing]).toBe(true);
    expect(() => validateMarketCityState(roadOverPower.state)).not.toThrow();

    const railFirst = applyWorldCommand(city(), { type: 'place-rail', path: [crossing] });
    expect(railFirst.ok).toBe(true);
    const powerOverRail = applyWorldCommand(railFirst.state, { type: 'place-power-line', tileIds: [crossing] });
    expect(powerOverRail).toMatchObject({ ok: true, changedTileIds: [crossing] });
    expect(powerOverRail.state.map.rails[crossing]).toBe(true);
    expect(powerOverRail.state.map.powerLines[crossing]).toBe(true);
    expect(() => validateMarketCityState(powerOverRail.state)).not.toThrow();
    expect(restoreMarketCityState(serializeMarketCityState(powerOverRail.state))).toEqual(powerOverRail.state);

    const powerFirstRail = applyWorldCommand(city(), { type: 'place-power-line', tileIds: [crossing] });
    expect(powerFirstRail.ok).toBe(true);
    const railOverPower = applyWorldCommand(powerFirstRail.state, { type: 'place-rail', path: [crossing] });
    expect(railOverPower).toMatchObject({ ok: true, changedTileIds: [crossing] });
    expect(railOverPower.state.map.rails[crossing]).toBe(true);
    expect(railOverPower.state.map.powerLines[crossing]).toBe(true);
    expect(() => validateMarketCityState(railOverPower.state)).not.toThrow();

    const roadRail = applyWorldCommand(railFirst.state, { type: 'place-road', tileIds: [crossing] });
    expect(roadRail.ok).toBe(true);
    const rejectedTripleOverlap = applyWorldCommand(roadRail.state, { type: 'place-power-line', tileIds: [crossing] });
    expect(rejectedTripleOverlap).toMatchObject({ ok: false, state: roadRail.state, changedTileIds: [] });
    expect(rejectedTripleOverlap.reason).toMatch(/Power line footprint conflicts/i);
  });

  it('places zones and networks for free and preserves a negative treasury', () => {
    const opening = city();
    opening.economy.treasury = -12_345;

    const zoned = applyWorldCommand(opening, {
      type: 'zone',
      tileIds: [tile(10, 10), tile(11, 10)],
      zone: 'R',
    });
    const road = applyWorldCommand(zoned.state, { type: 'place-road', tileIds: [tile(10, 11)] });
    const line = applyWorldCommand(road.state, { type: 'place-power-line', tileIds: [tile(9, 10)] });

    expect(zoned.ok).toBe(true);
    expect(road.ok).toBe(true);
    expect(line.ok).toBe(true);
    expect(line.state.economy.treasury).toBe(-12_345);
    expect(opening.map.zones[tile(10, 10)]).toBeNull();
    expect(line.state.map.zones[tile(10, 10)]).toBe('R');
    expect(line.state.map.roads[tile(10, 11)]).toBe(true);
    expect(line.state.map.powerLines[tile(9, 10)]).toBe(true);
  });

  it('skips water but places zoning on every eligible tile in a mixed brush', () => {
    const water = tile(3, 3);
    const dry = tile(4, 3);
    const opening = applyWorldCommand(city(), {
      type: 'paint-terrain',
      tileIds: [water],
      material: 'sand',
      water: true,
    }).state;

    const partial = applyWorldCommand(opening, {
      type: 'zone',
      tileIds: [dry, water],
      zone: 'C',
    });

    expect(partial).toMatchObject({ ok: true, changedTileIds: [dry] });
    expect(partial.state.map.zones[dry]).toBe('C');
    expect(partial.state.map.zones[water]).toBeNull();
  });

  it('blocks new zoning on physical occupants while keeping legacy overlays removable', () => {
    const road = tile(10, 10);
    const power = tile(11, 10);
    const facility = tile(12, 10);
    const sameZone = tile(13, 10);
    const differentZone = tile(14, 10);
    const developed = tile(15, 10);
    const empty = tile(16, 10);
    const bare = tile(17, 10);
    const opening = city();
    opening.map.roads[road] = true;
    opening.map.roadConnectionMasks[road] = 0;
    opening.environment.congestion[road] = 0.8;
    opening.map.powerLines[power] = true;
    opening.map.facilities.push({
      id: 'facility:wind-turbine:test', kind: 'wind-turbine', anchor: facility, tiles: [facility],
    });
    opening.environment.pollution[facility] = 42;
    opening.map.zones[sameZone] = 'R';
    opening.map.zones[differentZone] = 'C';
    opening.map.zones[developed] = 'R';
    opening.economy.density[developed] = 0.06;
    opening.map.zones[empty] = 'R';

    const zoned = applyWorldCommand(opening, {
      type: 'zone', zone: 'R', tileIds: [road, power, facility, sameZone, differentZone, bare],
    });
    expect(zoned).toMatchObject({ ok: true, changedTileIds: [bare] });
    expect(zoned.state.map.zones.slice(road, facility + 1)).toEqual([null, null, null]);
    expect(zoned.state.map.zones[sameZone]).toBe('R');
    expect(zoned.state.map.zones[differentZone]).toBe('C');
    expect(zoned.state.map.zones[bare]).toBe('R');
    expect(zoned.state.map.roads[road]).toBe(true);
    expect(zoned.state.map.roadConnectionMasks[road]).toBe(0);
    expect(zoned.state.map.powerLines[power]).toBe(true);
    expect(zoned.state.map.facilities).toEqual(opening.map.facilities);
    expect(deriveDensityCaps(zoned.state).densityCaps[bare]).toBeGreaterThan(0);

    // Existing saves may contain an old overlay. It must remain repairable by
    // Dezone without ever changing the physical road or facility underneath.
    const legacy = cloneMarketCityState(zoned.state);
    legacy.map.zones[road] = 'R';
    legacy.map.zones[facility] = 'R';
    const dezoned = applyWorldCommand(legacy, { type: 'dezone', tileIds: [road, facility, developed, empty] });
    expect(dezoned).toMatchObject({ ok: true, changedTileIds: [road, facility, developed, empty] });
    expect(dezoned.state.map.zones[road]).toBeNull();
    expect(dezoned.state.map.zones[facility]).toBeNull();
    expect(dezoned.state.map.zones[developed]).toBeNull();
    expect(dezoned.state.economy.density[developed]).toBe(0);
    expect(dezoned.state.map.zones[empty]).toBeNull();
    expect(dezoned.state.map.roads[road]).toBe(true);
    expect(dezoned.state.environment.congestion[road]).toBe(0.8);
    expect(dezoned.state.map.facilities).toEqual(opening.map.facilities);
    expect(dezoned.state.environment.pollution[facility]).toBe(42);
  });

  it('places rule-sized facilities atomically with deterministic IDs', () => {
    const anchor = tile(12, 12);
    const first = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'coal-power-plant',
      anchor,
    });
    const replay = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'coal-power-plant',
      anchor,
    });

    expect(first.ok).toBe(true);
    expect(first.changedTileIds).toEqual([
      tile(12, 12), tile(13, 12),
      tile(12, 13), tile(13, 13),
      tile(12, 14), tile(13, 14),
    ]);
    expect(first.state.map.facilities).toEqual(replay.state.map.facilities);
    expect(first.state.map.facilities[0]).toMatchObject({
      kind: 'coal-power-plant',
      anchor,
      tiles: first.changedTileIds,
    });

    const differentlyOccupied = applyWorldCommand(city(), {
      type: 'zone', tileIds: [tile(1, 1)], zone: 'I',
    }).state;
    const occupiedPlacement = applyWorldCommand(differentlyOccupied, {
      type: 'place-facility', kind: 'coal-power-plant', anchor,
    });
    expect(occupiedPlacement.state.map.facilities[0]!.id).not.toBe(first.state.map.facilities[0]!.id);

    const conflict = applyWorldCommand(first.state, {
      type: 'place-facility',
      kind: 'solar-plant',
      anchor: tile(13, 13),
    });
    expect(conflict.ok).toBe(false);
    expect(conflict.state).toBe(first.state);
    expect(conflict.state.map.facilities).toHaveLength(1);

    const offMap = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'nuclear-power-plant',
      anchor: tile(47, 47),
    });
    expect(offMap.ok).toBe(false);
    expect(offMap.state.map.facilities).toHaveLength(0);
  });

  it('uses a one-tile fire station footprint and rejects facility water atomically', () => {
    const station = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'fire-station',
      anchor: tile(20, 20),
    });
    expect(station.ok).toBe(true);
    expect(station.changedTileIds).toEqual([tile(20, 20)]);

    const watery = applyWorldCommand(city(), {
      type: 'paint-terrain',
      tileIds: [tile(30, 31)],
      material: 'sand',
      water: true,
    }).state;
    const rejected = applyWorldCommand(watery, {
      type: 'place-facility',
      kind: 'solar-plant',
      anchor: tile(30, 30),
    });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/water/i);
    expect(rejected.state.map.facilities).toHaveLength(0);
  });

  it('commits Solar Plant as one authoritative four-by-two footprint', () => {
    const placed = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'solar-plant',
      anchor: tile(5, 5),
    });

    expect(placed.ok).toBe(true);
    expect(placed.changedTileIds).toEqual([
      tile(5, 5), tile(6, 5), tile(7, 5), tile(8, 5),
      tile(5, 6), tile(6, 6), tile(7, 6), tile(8, 6),
    ]);
    expect(placed.state.map.facilities).toEqual([expect.objectContaining({
      kind: 'solar-plant',
      anchor: tile(5, 5),
      tiles: placed.changedTileIds,
    })]);
  });

  it('demolishes an entire facility and zeroes every affected tile state', () => {
    const placed = applyWorldCommand(city(), {
      type: 'place-facility',
      kind: 'solar-plant',
      anchor: tile(5, 5),
    }).state;
    const footprint = placed.map.facilities[0]!.tiles;
    for (const id of footprint) {
      placed.economy.density[id] = 0.7;
      placed.economy.wealth[id] = 21_000;
      placed.environment.pollution[id] = 80;
      placed.environment.congestion[id] = 0.8;
      placed.environment.roadAccess[id] = true;
      placed.environment.powered[id] = true;
      placed.fire.char[id] = 0.4;
    }

    const demolished = applyWorldCommand(placed, { type: 'demolish', tileIds: [tile(6, 6)] });

    expect(demolished.ok).toBe(true);
    expect(demolished.changedTileIds).toEqual(footprint);
    expect(demolished.state.map.facilities).toHaveLength(0);
    for (const id of footprint) {
      expect(demolished.state.economy.density[id]).toBe(0);
      expect(demolished.state.economy.wealth[id]).toBe(0);
      expect(demolished.state.environment.pollution[id]).toBe(0);
      expect(demolished.state.environment.congestion[id]).toBe(0);
      expect(demolished.state.environment.roadAccess[id]).toBe(false);
      expect(demolished.state.environment.powered[id]).toBe(false);
      expect(demolished.state.fire.char[id]).toBe(0);
    }
  });

  it('bulldozes physical occupants but preserves RCI and landfill zoning permissions', () => {
    const rciTile = tile(14, 14);
    const roadTile = tile(15, 14);
    const landfillTile = tile(16, 14);
    const state = city();
    state.map.zones[rciTile] = 'C';
    state.economy.density[rciTile] = 0.7;
    state.economy.wealth[rciTile] = 24_000;
    state.map.zones[roadTile] = 'I';
    state.map.roads[roadTile] = true;
    state.map.landfillZones[landfillTile] = true;

    const demolishedRci = applyWorldCommand(state, { type: 'demolish', tileIds: [rciTile] });
    expect(demolishedRci.ok).toBe(true);
    expect(demolishedRci.state.map.zones[rciTile]).toBe('C');
    expect(demolishedRci.state.economy.density[rciTile]).toBe(0);
    expect(demolishedRci.state.economy.wealth[rciTile]).toBe(0);
    expect(restoreMarketCityState(serializeMarketCityState(demolishedRci.state)).map.zones[rciTile]).toBe('C');

    const demolishedRoad = applyWorldCommand(demolishedRci.state, { type: 'demolish', tileIds: [roadTile] });
    expect(demolishedRoad.ok).toBe(true);
    expect(demolishedRoad.state.map.roads[roadTile]).toBe(false);
    expect(demolishedRoad.state.map.zones[roadTile]).toBe('I');

    const demolishedLandfill = applyWorldCommand(demolishedRoad.state, { type: 'demolish', tileIds: [landfillTile] });
    expect(demolishedLandfill.ok).toBe(true);
    expect(demolishedLandfill.state.map.landfillZones[landfillTile]).toBe(true);
  });

  it('dezones developed RCI without deleting non-RCI infrastructure beneath a zone overlay', () => {
    const developed = tile(18, 14);
    const roadOverlay = tile(19, 14);
    const state = city();
    state.map.zones[developed] = 'R';
    state.economy.density[developed] = 0.45;
    state.economy.wealth[developed] = 18_000;
    state.map.zones[roadOverlay] = 'C';
    state.map.roads[roadOverlay] = true;

    const developedDezone = applyWorldCommand(state, { type: 'dezone', tileIds: [developed] });
    expect(developedDezone.ok).toBe(true);
    expect(developedDezone.state.map.zones[developed]).toBeNull();
    expect(developedDezone.state.economy.density[developed]).toBe(0);
    expect(developedDezone.state.economy.wealth[developed]).toBe(0);

    const overlayDezone = applyWorldCommand(developedDezone.state, { type: 'dezone', tileIds: [roadOverlay] });
    expect(overlayDezone.ok).toBe(true);
    expect(overlayDezone.state.map.zones[roadOverlay]).toBeNull();
    expect(overlayDezone.state.map.roads[roadOverlay]).toBe(true);
  });

  it('clears occupants when terrain becomes water and applies elevation immutably', () => {
    const target = tile(16, 16);
    const road = applyWorldCommand(city(), { type: 'place-road', tileIds: [target] }).state;
    road.economy.density[target] = 0.5;
    road.fire.char[target] = 0.5;

    const flooded = applyWorldCommand(road, {
      type: 'paint-terrain',
      tileIds: [target],
      material: 'sand',
      water: true,
    });
    const raised = applyWorldCommand(flooded.state, {
      type: 'set-elevation',
      tileIds: [target],
      elevation: 3.25,
    });

    expect(flooded.ok).toBe(true);
    expect(flooded.state.map.terrain.water[target]).toBe(true);
    expect(flooded.state.map.roads[target]).toBe(false);
    expect(flooded.state.economy.density[target]).toBe(0);
    expect(flooded.state.fire.char[target]).toBe(0);
    expect(raised.state.map.terrain.elevation[target]).toBe(3.25);
    expect(flooded.state.map.terrain.elevation[target]).toBe(0);
  });

  it.each(['burning', 'rubble'] as const)('skips a %s footprint while mixed rectangle commands mutate eligible neighbors', (status) => {
    const locked = tile(10, 10);
    const neighbor = tile(11, 10);

    const zonedOpening = cityWithLockedFire(status);
    const zoned = applyWorldCommand(zonedOpening, { type: 'zone', tileIds: [locked, neighbor], zone: 'C' });
    expect(zoned).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(zoned.state.map.zones[locked]).toBe('R');
    expect(zoned.state.map.zones[neighbor]).toBe('C');

    const dezoneOpening = cityWithLockedFire(status);
    dezoneOpening.map.zones[neighbor] = 'I';
    const dezoned = applyWorldCommand(dezoneOpening, { type: 'dezone', tileIds: [locked, neighbor] });
    expect(dezoned).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(dezoned.state.map.zones[locked]).toBe('R');
    expect(dezoned.state.map.zones[neighbor]).toBeNull();

    const roadOpening = cityWithLockedFire(status);
    const road = applyWorldCommand(roadOpening, { type: 'place-road', tileIds: [locked, neighbor] });
    expect(road).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(road.state.map.roads[locked]).toBe(false);
    expect(road.state.map.roads[neighbor]).toBe(true);

    const lineOpening = cityWithLockedFire(status);
    const line = applyWorldCommand(lineOpening, { type: 'place-power-line', tileIds: [locked, neighbor] });
    expect(line).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(line.state.map.powerLines[locked]).toBe(false);
    expect(line.state.map.powerLines[neighbor]).toBe(true);

    const terrainOpening = cityWithLockedFire(status);
    const painted = applyWorldCommand(terrainOpening, { type: 'paint-terrain', tileIds: [locked, neighbor], material: 'sand' });
    expect(painted).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(painted.state.map.terrain.material[locked]).toBe('grass');
    expect(painted.state.map.terrain.material[neighbor]).toBe('sand');

    const elevationOpening = cityWithLockedFire(status);
    const elevated = applyWorldCommand(elevationOpening, { type: 'set-elevation', tileIds: [locked, neighbor], elevation: 2 });
    expect(elevated).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(elevated.state.map.terrain.elevation[locked]).toBe(0);
    expect(elevated.state.map.terrain.elevation[neighbor]).toBe(2);

    const demolishOpening = cityWithLockedFire(status);
    demolishOpening.map.roads[neighbor] = true;
    const demolished = applyWorldCommand(demolishOpening, { type: 'demolish', tileIds: [locked, neighbor] });
    expect(demolished).toMatchObject({ ok: true, changedTileIds: [neighbor] });
    expect(demolished.state.fire.incidents).toEqual(demolishOpening.fire.incidents);
    expect(demolished.state.map.zones[locked]).toBe('R');
    expect(demolished.state.map.roads[neighbor]).toBe(false);
  });

  it.each(['burning', 'rubble'] as const)('rejects an all-locked %s action without mutation', (status) => {
    const opening = cityWithLockedFire(status);
    const beforeHash = hashDeterministicState(opening);
    const locked = tile(10, 10);
    const commands: MarketCityWorldCommand[] = [
      { type: 'zone', tileIds: [locked], zone: 'C' },
      { type: 'dezone', tileIds: [locked] },
      { type: 'place-road', tileIds: [locked] },
      { type: 'place-power-line', tileIds: [locked] },
      { type: 'demolish', tileIds: [locked] },
      { type: 'paint-terrain', tileIds: [locked], material: 'sand' },
      { type: 'adjust-trees', tileIds: [locked], delta: 1 },
      { type: 'set-elevation', tileIds: [locked], elevation: 2 },
    ];
    for (const command of commands) {
      const result = applyWorldCommand(opening, command);
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/locked/i);
      expect(result.state).toBe(opening);
      expect(hashDeterministicState(result.state)).toBe(beforeHash);
    }
  });
});
