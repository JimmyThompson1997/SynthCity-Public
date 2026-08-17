import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  deriveAvenueRibbon,
  type AvenueRibbonSuccess,
} from '../../src/market-city/avenue';
import { applyWorldCommand } from '../../src/market-city/commands';
import { deriveTileInspection } from '../../src/market-city/queries';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { stepMonth, stepMonths } from '../../src/market-city/simulation';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
  validateMarketCityState,
} from '../../src/market-city/state';
import { deriveCongestion, derivePower, deriveRoadAccess, hasFacilityRoadAccess } from '../../src/market-city/spatial';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2 } from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const tile = (x: number, y: number): number => y * SIZE + x;

function city(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'avenue-core', cityName: 'Avenue Core', mayorName: 'Ada', seed: 89,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
}

function ribbon(path: readonly number[], expansionSide: 'left' | 'right'): AvenueRibbonSuccess {
  const result = deriveAvenueRibbon(SIZE, path, expansionSide);
  expect(result.ok, result.ok ? undefined : result.reason).toBe(true);
  return result as AvenueRibbonSuccess;
}

describe('deriveAvenueRibbon', () => {
  it.each([
    ['east', [tile(10, 10), tile(11, 10), tile(12, 10)], 'left', [tile(10, 9), tile(11, 9), tile(12, 9)]],
    ['west', [tile(12, 10), tile(11, 10), tile(10, 10)], 'left', [tile(12, 11), tile(11, 11), tile(10, 11)]],
    ['south', [tile(10, 10), tile(10, 11), tile(10, 12)], 'left', [tile(11, 10), tile(11, 11), tile(11, 12)]],
    ['north', [tile(10, 12), tile(10, 11), tile(10, 10)], 'left', [tile(9, 12), tile(9, 11), tile(9, 10)]],
    ['east-right', [tile(10, 10), tile(11, 10), tile(12, 10)], 'right', [tile(10, 11), tile(11, 11), tile(12, 11)]],
  ] as const)('expands a straight %s path without sorting it', (_name, path, side, paired) => {
    const result = ribbon(path, side);
    expect(result.primaryTileIds).toEqual(path);
    expect(result.pairedTileIds).toEqual(paired);
    expect(result.footprint).toEqual([...new Set([...path, ...paired])].sort((a, b) => a - b));
  });

  it('produces directed right-hand lanes and reciprocal median pairs', () => {
    const primary = [tile(10, 10), tile(11, 10), tile(12, 10)];
    const left = ribbon(primary, 'left');
    const byTile = new Map(left.lanes.map((lane) => [lane.tileId, lane]));
    expect(primary.map((id) => byTile.get(id)?.travelMask)).toEqual([2, 2, 0]);
    expect([tile(10, 9), tile(11, 9), tile(12, 9)].map((id) => byTile.get(id)?.travelMask)).toEqual([0, 8, 8]);
    expect(primary.map((id) => byTile.get(id)?.pairMask)).toEqual([1, 1, 1]);
    expect([tile(10, 9), tile(11, 9), tile(12, 9)].map((id) => byTile.get(id)?.pairMask)).toEqual([4, 4, 4]);
  });

  it.each([
    ['east-south-left', [tile(8, 10), tile(9, 10), tile(10, 10), tile(10, 11), tile(10, 12)], 'left', [tile(8, 9), tile(9, 9), tile(10, 9), tile(11, 9), tile(11, 10), tile(11, 11), tile(11, 12)]],
    ['east-south-right', [tile(8, 10), tile(9, 10), tile(10, 10), tile(10, 11), tile(10, 12)], 'right', [tile(8, 11), tile(9, 11), tile(9, 12)]],
    ['east-north-left', [tile(8, 10), tile(9, 10), tile(10, 10), tile(10, 9), tile(10, 8)], 'left', [tile(8, 9), tile(9, 9), tile(9, 8)]],
    ['east-north-right', [tile(8, 10), tile(9, 10), tile(10, 10), tile(10, 9), tile(10, 8)], 'right', [tile(8, 11), tile(9, 11), tile(10, 11), tile(11, 11), tile(11, 10), tile(11, 9), tile(11, 8)]],
  ] as const)('fills the inner or outer corner for %s', (_name, path, side, paired) => {
    const result = ribbon(path, side);
    expect(result.pairedTileIds).toEqual(paired);
    expect(result.footprint).toHaveLength(path.length + paired.length);
  });

  it('requires an ordered two-tile drag for the minimum 2 by 2 Avenue', () => {
    expect(deriveAvenueRibbon(SIZE, [tile(10, 10)], 'left')).toEqual({
      ok: false,
      reason: 'Avenue requires a two-tile drag to create a 2 × 2 paired-lane block.',
    });
    const eastbound = ribbon([tile(10, 10), tile(11, 10)], 'left');
    const westbound = ribbon([tile(11, 10), tile(10, 10)], 'left');
    expect(eastbound.footprint).toHaveLength(4);
    expect(westbound.footprint).toHaveLength(4);
    expect(new Map(eastbound.lanes.map((lane) => [lane.tileId, lane])).get(tile(10, 10))?.travelMask).toBe(2);
    expect(new Map(westbound.lanes.map((lane) => [lane.tileId, lane])).get(tile(11, 10))?.travelMask).toBe(8);

    expect(deriveAvenueRibbon(SIZE, [], 'left')).toMatchObject({ ok: false });
    expect(deriveAvenueRibbon(SIZE, [tile(1, 1), tile(1, 1)], 'left')).toMatchObject({ ok: false });
    expect(deriveAvenueRibbon(SIZE, [tile(1, 1), tile(2, 2)], 'left')).toMatchObject({ ok: false });
    expect(deriveAvenueRibbon(SIZE, [tile(1, 1), tile(2, 1), tile(2, 2), tile(3, 2)], 'left')).toMatchObject({ ok: false });
    expect(deriveAvenueRibbon(SIZE, [tile(47, 10), tile(47, 11)], 'left')).toMatchObject({ ok: false });
  });

  it.each(['left', 'right'] as const)('keeps a minimal %s bend contiguous', (expansionSide) => {
    const result = ribbon([tile(10, 10), tile(11, 10), tile(11, 11)], expansionSide);
    for (let index = 1; index < result.pairedTileIds.length; index += 1) {
      const before = result.pairedTileIds[index - 1]!;
      const after = result.pairedTileIds[index]!;
      expect(Math.abs(before % SIZE - after % SIZE)
        + Math.abs(Math.floor(before / SIZE) - Math.floor(after / SIZE))).toBe(1);
    }
  });

  it('is deterministic, immutable, bounded, and topologically valid for all 16 turn-side orientations', () => {
    const headings = [
      { name: 'N', dx: 0, dy: -1 },
      { name: 'E', dx: 1, dy: 0 },
      { name: 'S', dx: 0, dy: 1 },
      { name: 'W', dx: -1, dy: 0 },
    ] as const;
    const bitForDelta = (dx: number, dy: number): number => (
      dx === 0 && dy === -1 ? 1 : dx === 1 && dy === 0 ? 2 : dx === 0 && dy === 1 ? 4 : 8
    );
    const deltaForBit = (bit: number): readonly [number, number] => (
      bit === 1 ? [0, -1] : bit === 2 ? [1, 0] : bit === 4 ? [0, 1] : [-1, 0]
    );
    for (const first of headings) {
      for (const turn of ['left', 'right'] as const) {
        const second = turn === 'left'
          ? { dx: first.dy, dy: -first.dx }
          : { dx: -first.dy, dy: first.dx };
        for (const expansionSide of ['left', 'right'] as const) {
          const points = [
            { x: 24 - first.dx * 2, y: 24 - first.dy * 2 },
            { x: 24 - first.dx, y: 24 - first.dy },
            { x: 24, y: 24 },
            { x: 24 + second.dx, y: 24 + second.dy },
            { x: 24 + second.dx * 2, y: 24 + second.dy * 2 },
          ];
          const path = points.map(({ x, y }) => tile(x, y));
          const frozenInput = [...path];
          const firstResult = ribbon(path, expansionSide);
          const replay = ribbon(path, expansionSide);
          expect(firstResult, `${first.name}-${turn}-${expansionSide}`).toEqual(replay);
          expect(path).toEqual(frozenInput);
          expect(new Set(firstResult.footprint).size).toBe(firstResult.footprint.length);
          expect(firstResult.footprint.every((id) => id >= 0 && id < SIZE * SIZE)).toBe(true);

          const laneSet = new Set(firstResult.footprint);
          const laneByTile = new Map(firstResult.lanes.map((lane) => [lane.tileId, lane]));
          const primarySet = new Set(path);
          const pairedSet = new Set(firstResult.pairedTileIds);
          const expectedTravelMasks = (ordered: readonly number[]): Map<number, number> => {
            const result = new Map(ordered.map((id) => [id, 0]));
            for (let index = 0; index + 1 < ordered.length; index += 1) {
              const from = ordered[index]!;
              const to = ordered[index + 1]!;
              const fromX = from % SIZE;
              const fromY = Math.floor(from / SIZE);
              const toX = to % SIZE;
              const toY = Math.floor(to / SIZE);
              result.set(from, (result.get(from) ?? 0) | bitForDelta(toX - fromX, toY - fromY));
            }
            return result;
          };
          const primaryTravel = expectedTravelMasks(path);
          const pairedTravel = expectedTravelMasks([...firstResult.pairedTileIds].reverse());
          for (const lane of firstResult.lanes) {
            expect(lane.travelMask).toBe(primaryTravel.get(lane.tileId) ?? pairedTravel.get(lane.tileId) ?? 0);
            for (const bit of [1, 2, 4, 8]) {
              if ((lane.travelMask & bit) !== 0) {
                const [dx, dy] = deltaForBit(bit);
                const x = lane.tileId % SIZE;
                const y = Math.floor(lane.tileId / SIZE);
                expect(laneSet.has(tile(x + dx, y + dy))).toBe(true);
              }
              if ((lane.pairMask & bit) !== 0) {
                const [dx, dy] = deltaForBit(bit);
                const x = lane.tileId % SIZE;
                const y = Math.floor(lane.tileId / SIZE);
                const neighbor = tile(x + dx, y + dy);
                const opposite = bitForDelta(-dx, -dy);
                expect(primarySet.has(lane.tileId) ? pairedSet.has(neighbor) : primarySet.has(neighbor)).toBe(true);
                expect(laneByTile.get(neighbor)!.pairMask & opposite).toBe(opposite);
              }
            }
          }
          for (let index = 1; index < firstResult.pairedTileIds.length; index += 1) {
            const before = firstResult.pairedTileIds[index - 1]!;
            const after = firstResult.pairedTileIds[index]!;
            expect(Math.abs(before % SIZE - after % SIZE)
              + Math.abs(Math.floor(before / SIZE) - Math.floor(after / SIZE))).toBe(1);
          }
        }
      }
    }
  });

  it('satisfies bounded ribbon invariants across generated arm lengths and orientations', () => {
    fc.assert(fc.property(
      fc.integer({ min: 0, max: 3 }),
      fc.boolean(),
      fc.constantFrom<'left' | 'right'>('left', 'right'),
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 1, max: 8 }),
      fc.integer({ min: 12, max: 35 }),
      fc.integer({ min: 12, max: 35 }),
      (headingIndex, clockwise, expansionSide, incomingLength, outgoingLength, centerX, centerY) => {
        const headings = [
          { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
        ] as const;
        const first = headings[headingIndex]!;
        const second = clockwise
          ? { dx: -first.dy, dy: first.dx }
          : { dx: first.dy, dy: -first.dx };
        const coordinates = [];
        for (let offset = incomingLength; offset > 0; offset -= 1) {
          coordinates.push({ x: centerX - first.dx * offset, y: centerY - first.dy * offset });
        }
        coordinates.push({ x: centerX, y: centerY });
        for (let offset = 1; offset <= outgoingLength; offset += 1) {
          coordinates.push({ x: centerX + second.dx * offset, y: centerY + second.dy * offset });
        }
        const path = coordinates.map(({ x, y }) => tile(x, y));
        const result = deriveAvenueRibbon(SIZE, path, expansionSide);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.primaryTileIds).toEqual(path);
        expect(new Set(result.footprint).size).toBe(result.footprint.length);
        expect(result.footprint.every((id) => id >= 0 && id < SIZE * SIZE)).toBe(true);
        expect(deriveAvenueRibbon(SIZE, path, expansionSide)).toEqual(result);
      },
    ), { numRuns: 128 });
  });
});

describe('atomic Avenue world command', () => {
  it('commits the whole ribbon, masks, persistence, and inspection atomically', () => {
    const opening = city();
    const path = [tile(8, 10), tile(9, 10), tile(10, 10), tile(10, 11), tile(10, 12)];
    const expected = ribbon(path, 'left');
    const placed = applyWorldCommand(opening, { type: 'place-avenue', path, expansionSide: 'left' });
    expect(placed.ok).toBe(true);
    expect(placed.changedTileIds).toEqual(expected.footprint);
    expect(opening.map.avenueLanes.every((value) => !value)).toBe(true);
    for (const lane of expected.lanes) {
      expect(placed.state.map.avenueLanes[lane.tileId]).toBe(true);
      expect(placed.state.map.avenueTravelMasks[lane.tileId]).toBe(lane.travelMask);
      expect(placed.state.map.avenuePairMasks[lane.tileId]).toBe(lane.pairMask);
      expect(placed.state.map.avenueMedianMasks[lane.tileId]).toBe(lane.pairMask);
    }
    const inspected = deriveTileInspection(placed.state, path[0]!);
    expect(inspected).toMatchObject({ avenueLane: true, roadSurface: true, avenueTravelMask: 2, avenuePairMask: 1 });
    expect(() => validateMarketCityState(placed.state)).not.toThrow();
    expect(restoreMarketCityState(serializeMarketCityState(placed.state))).toEqual(placed.state);
  });

  it('rejects an obstructed or off-map derived cell without changing identity or hash', () => {
    const opening = city();
    // Empty zoning is consumable by physical placement. A developed lot is
    // still a real obstruction and must reject the complete Avenue ribbon.
    opening.map.zones[tile(11, 9)] = 'R';
    opening.economy.density[tile(11, 9)] = 0.4;
    const before = hashDeterministicState(opening);
    const rejected = applyWorldCommand(opening, {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    });
    expect(rejected).toMatchObject({ ok: false, state: opening, changedTileIds: [] });
    expect(hashDeterministicState(opening)).toBe(before);
    const edge = city();
    expect(applyWorldCommand(edge, {
      type: 'place-avenue', path: [tile(47, 10), tile(47, 11)], expansionSide: 'left',
    })).toMatchObject({ ok: false, state: edge, changedTileIds: [] });
  });

  it('keeps the selected edge side authoritative while the mirrored command remains valid', () => {
    const cases = [
      { path: [tile(0, 0), tile(1, 0)], rejected: 'left' as const, accepted: 'right' as const, footprint: [tile(0, 0), tile(1, 0), tile(0, 1), tile(1, 1)] },
      { path: [tile(0, 47), tile(1, 47)], rejected: 'right' as const, accepted: 'left' as const, footprint: [tile(0, 46), tile(1, 46), tile(0, 47), tile(1, 47)] },
    ];
    for (const { path, rejected, accepted, footprint } of cases) {
      const opening = city();
      const before = hashDeterministicState(opening);
      const rejectedResult = applyWorldCommand(opening, { type: 'place-avenue', path, expansionSide: rejected });
      expect(rejectedResult).toMatchObject({ ok: false, state: opening, changedTileIds: [] });
      expect(hashDeterministicState(opening)).toBe(before);

      const acceptedResult = applyWorldCommand(opening, { type: 'place-avenue', path, expansionSide: accepted });
      expect(acceptedResult.ok).toBe(true);
      expect(acceptedResult.changedTileIds).toEqual(footprint);
    }
  });

  it.each(['burning', 'rubble'] as const)('rejects the whole ribbon across a %s footprint', (status) => {
    const opening = city();
    const lockedTile = tile(11, 9);
    opening.map.zones[lockedTile] = 'R';
    opening.fire.incidents.push({
      id: `fire-m1-t${lockedTile}`,
      status,
      tileIds: [lockedTile],
      zone: 'R',
      startedMonth: 1,
      structure: {
        footprint: '1x1', originTile: lockedTile, height: 2, roof: 'flat', roofHeight: 1,
        roofOrientation: 0, detail: 'windows', color: [112, 204, 124], landmark: false,
      },
      intensity: status === 'burning' ? 0.4 : 0,
      damage: status === 'rubble' ? MARKET_CITY_RULES.fire.collapseDamage : 0.2,
      age: 1,
      rubbleMonthsRemaining: status === 'rubble' ? MARKET_CITY_RULES.fire.rubbleMonths : 0,
    });
    opening.clock.month = 1;
    opening.fire.history.push({
      sequence: 1, month: 1, incidentId: `fire-m1-t${lockedTile}`, event: 'ignited', tileIds: [lockedTile],
      zone: 'R', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
    });
    if (status === 'rubble') {
      opening.fire.char[lockedTile] = 1;
      opening.fire.collapsedTotal = 1;
      opening.fire.history.push({
        sequence: 2, month: 1, incidentId: `fire-m1-t${lockedTile}`, event: 'collapsed', tileIds: [lockedTile],
        zone: 'R', intensity: 0, damage: MARKET_CITY_RULES.fire.collapseDamage,
        rubbleMonthsRemaining: MARKET_CITY_RULES.fire.rubbleMonths,
      });
    }
    const before = hashDeterministicState(opening);
    const rejected = applyWorldCommand(opening, {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    });
    expect(rejected).toMatchObject({
      ok: false,
      state: opening,
      changedTileIds: [],
      reason: 'Avenue footprint overlaps a burning building or rubble.',
    });
    expect(hashDeterministicState(opening)).toBe(before);
  });

  it('OR-merges extensions and crossing joins deterministically', () => {
    const horizontal = applyWorldCommand(city(), {
      type: 'place-avenue', path: [tile(8, 10), tile(9, 10), tile(10, 10)], expansionSide: 'left',
    }).state;
    const extension = applyWorldCommand(horizontal, {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    });
    expect(extension.ok).toBe(true);
    const crossing = applyWorldCommand(extension.state, {
      type: 'place-avenue', path: [tile(10, 8), tile(10, 9), tile(10, 10), tile(10, 11), tile(10, 12)], expansionSide: 'right',
    });
    expect(crossing.ok).toBe(true);
    expect(crossing.state.map.avenueTravelMasks[tile(10, 10)]).not.toBe(0);
    expect(() => validateMarketCityState(crossing.state)).not.toThrow();
  });

  it('keeps the established Avenue median paint when a later Avenue overlays it', () => {
    const established = applyWorldCommand(city(), {
      type: 'place-avenue', path: [tile(8, 10), tile(9, 10), tile(10, 10), tile(11, 10)], expansionSide: 'left',
    }).state;
    const beforeMedianMasks = [...established.map.avenueMedianMasks];
    const crossing = applyWorldCommand(established, {
      type: 'place-avenue', path: [tile(10, 8), tile(10, 9), tile(10, 10), tile(10, 11), tile(10, 12)], expansionSide: 'right',
    });
    expect(crossing.ok).toBe(true);
    for (let lane = 0; lane < beforeMedianMasks.length; lane += 1) {
      if (established.map.avenueLanes[lane]) {
        expect(crossing.state.map.avenueMedianMasks[lane]).toBe(beforeMedianMasks[lane]);
      }
    }
    expect(() => validateMarketCityState(crossing.state)).not.toThrow();
  });

  it('never invents pair or travel links from unrelated Avenue adjacency', () => {
    const opening = city();
    const unrelated = tile(10, 9);
    opening.map.avenueLanes[unrelated] = true;
    const placed = applyWorldCommand(opening, {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10)], expansionSide: 'right',
    });
    expect(placed.ok).toBe(true);
    expect(placed.state.map.avenueTravelMasks[unrelated]).toBe(0);
    expect(placed.state.map.avenuePairMasks[unrelated]).toBe(0);
    expect(() => validateMarketCityState(placed.state)).not.toThrow();
  });

  it('joins ordinary roads, provides shared service, but never contributes congestion', () => {
    let state = applyWorldCommand(city(), {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    }).state;
    state = applyWorldCommand(state, { type: 'place-road', tileIds: [tile(10, 10)] }).state;
    expect(state.map.roads[tile(10, 10)]).toBe(true);
    expect(state.map.avenueLanes[tile(10, 10)]).toBe(true);
    state.map.zones[tile(12, 12)] = 'R';
    state.economy.density[tile(12, 12)] = 1;
    const station = { id: 'fire', kind: 'fire-station' as const, anchor: tile(12, 13), tiles: [tile(12, 13)] };
    state.map.facilities.push(station);
    expect(deriveRoadAccess(state)[tile(12, 12)]).toBe(true);
    expect(hasFacilityRoadAccess(state, station)).toBe(true);
    expect(deriveCongestion(state).filter((value) => value > 0)).toEqual([]);

    const plantTile = tile(20, 20);
    state.map.facilities.push({ id: 'wind', kind: 'wind-turbine', anchor: plantTile, tiles: [plantTile] });
    state.map.avenueLanes[tile(20, 21)] = true;
    expect(derivePower(state).livePlantIds).toContain('wind');
  });

  it('crosses existing rail without destroying either transport layer', () => {
    const opening = city();
    opening.map.rails[tile(11, 10)] = true;
    const placed = applyWorldCommand(opening, {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    });
    expect(placed.ok).toBe(true);
    expect(placed.state.map.rails[tile(11, 10)]).toBe(true);
    expect(placed.state.map.avenueLanes[tile(11, 10)]).toBe(true);
    expect(() => validateMarketCityState(placed.state)).not.toThrow();
  });

  it('charges road maintenance once per Avenue tile and bypasses no inert fast path', () => {
    const placed = applyWorldCommand(city(), {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    }).state;
    placed.clock.paused = false;
    const next = stepMonth(placed);
    expect(next.economy.lastOperatingExpense).toBe(6 * 1_293);
    const twoMonths = stepMonths(placed, 2);
    expect(twoMonths.clock.month).toBe(2);
    expect(twoMonths.economy.lastOperatingExpense).toBe(6 * 1_293);
    expect(twoMonths.economy.treasury).toBe(5_000 - 2 * 6 * 1_293);
  });

  it('bulldozes one lane cell and clears reciprocal travel and pair bits', () => {
    const placed = applyWorldCommand(city(), {
      type: 'place-avenue', path: [tile(10, 10), tile(11, 10), tile(12, 10)], expansionSide: 'left',
    }).state;
    const removed = tile(11, 10);
    const demolished = applyWorldCommand(placed, { type: 'demolish', tileIds: [removed] });
    expect(demolished.ok).toBe(true);
    expect(demolished.changedTileIds).toEqual([
      tile(11, 9),
      tile(10, 10),
      removed,
    ].sort((left, right) => left - right));
    expect(demolished.state.map.avenueLanes[removed]).toBe(false);
    expect(demolished.state.map.avenueTravelMasks[tile(10, 10)]! & 2).toBe(0);
    expect(demolished.state.map.avenuePairMasks[tile(11, 9)]! & 4).toBe(0);
    expect(() => validateMarketCityState(demolished.state)).not.toThrow();
  });
});
