import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  deriveBuildingHeights,
  captureBuildingStructure,
  deriveFirePlume,
  deriveRenderLots,
  mix32,
  pickBuildingRoof,
  shadeBuildingColor,
  selectBuildingDetail,
  tileHash,
} from '../../src/market-city/appearance';
import { createMarketCityState } from '../../src/market-city/state';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketRoofKind,
  type MarketCityStateV2,
  type MarketLotFootprint,
  type MarketZoneKind,
} from '../../src/market-city/types';

const tileCount = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;

function makeState(): MarketCityStateV2 {
  const result = createMarketCityState({
      cityId: 'appearance-test',
      cityName: 'Appearance Test',
      mayorName: 'Test',
      seed: 12345,
      createdAt: '2026-08-11T00:00:00.000Z',
  });
  result.clock.speed = 0;
  return result;
}

function tileId(x: number, y: number): number {
  return y * MARKET_CITY_MAP_SIZE + x;
}

function develop(
  state: MarketCityStateV2,
  x: number,
  y: number,
  zone: MarketZoneKind,
  density = 1,
): number {
  const id = tileId(x, y);
  state.map.zones[id] = zone;
  state.economy.density[id] = density;
  return id;
}

function findOrigin(lo: number, hi: number, predicate: (x: number, y: number) => boolean = () => true) {
  for (let y = 1; y < MARKET_CITY_MAP_SIZE - 2; y += 1) {
    for (let x = 1; x < MARKET_CITY_MAP_SIZE - 2; x += 1) {
      const roll = tileHash(x, y, 7) % 100;
      if (roll >= lo && roll < hi && predicate(x, y)) return { x, y };
    }
  }
  throw new Error(`No origin found for roll [${lo}, ${hi})`);
}

describe('deterministic building-shape regression', () => {
  it('locks seven project-owned unsigned mix32 vectors', () => {
    expect([
      0,
      1,
      2,
      0xffff_ffff,
      0x8000_0000,
      123_456_789,
      987_654_321,
    ].map(mix32)).toEqual([
      493_009_611,
      1_059_954_845,
      100_097_173,
      4_288_662_295,
      1_446_441_375,
      1_028_295_467,
      1_923_028_376,
    ]);
  });

  it('locks an exhaustive project-owned roof, detail, orientation, and shade matrix', () => {
    const hashes = [0, 1, 2, 17, 255, 1_024, 65_535, 0xffff_ffff];
    const cases = (['R', 'C', 'I'] as const).flatMap((zone) => (
      Array.from({ length: 10 }, (_, index) => index + 1).flatMap((height) => (
        hashes.flatMap((hash) => [false, true].map((landmark) => {
          const roof = pickBuildingRoof(zone, height, hash, landmark);
          const color = shadeBuildingColor(zone, hash);
          expect(roof.roofHeight).toBeGreaterThanOrEqual(0);
          expect(roof.roofOrientation).toBeGreaterThanOrEqual(0);
          expect(roof.roofOrientation).toBeLessThanOrEqual(3);
          expect(color.every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)).toBe(true);
          return {
            zone,
            height,
            hash,
            landmark,
            roof: roof.roof,
            roofHeight: roof.roofHeight,
            roofOrientation: roof.roofOrientation,
            detail: selectBuildingDetail(zone, height, false),
            wideDetail: selectBuildingDetail(zone, height, true),
            color,
          };
        }))
      ))
    ));
    expect(cases).toHaveLength(480);
    expect(createHash('sha256').update(JSON.stringify(cases)).digest('hex'))
      .toBe('ff86cd44a94b3fa6ded751bdf83967e288de3415015379a8eaeaede11ec01f61');
  });
});

describe('facade coverage', () => {
  it('never leaves a standing building with no facade at all', () => {
    // Height four used to sit between the door and window thresholds, leaving
    // a blank wall. Any future facade gap fails here first.
    for (const zone of ['R', 'C', 'I'] as const) {
      for (let height = 1; height <= 10; height += 1) {
        for (const wide of [false, true]) {
          expect(selectBuildingDetail(zone, height, wide), `${zone}/${height}/wide=${wide}`)
            .not.toBeNull();
        }
      }
    }
    expect(selectBuildingDetail('R', 0, false)).toBeNull();
  });
});

describe('deterministic building height derivation', () => {
  it('uses the strict > 0.05 threshold, filled density, and actual cap', () => {
    const state = makeState();
    const densityCaps = Array<number>(tileCount).fill(1);
    const developed = [
      develop(state, 2, 2, 'R', 0.06),
      develop(state, 4, 2, 'R', 0.25),
      develop(state, 6, 2, 'R', 0.58),
      develop(state, 8, 2, 'R', 0.97),
    ];
    densityCaps[developed[3]!] = 0.4;
    const threshold = develop(state, 10, 2, 'R', 0.05);

    const heights = deriveBuildingHeights(state, densityCaps);

    expect(developed.map((id) => heights[id])).toEqual([1, 3, 6, 4]);
    expect(heights[threshold]).toBe(0);
  });

  it('uses the same filled-density conversion for each sector', () => {
    const state = makeState();
    const densityCaps = Array<number>(tileCount).fill(1);
    for (const zone of ['R', 'C', 'I'] as const) {
      for (let x = 2; x < 10; x += 1) {
        const tile = develop(state, x, zone === 'R' ? 4 : zone === 'C' ? 6 : 8, zone, 0.58);
        if (zone === 'I') densityCaps[tile] = 0.4;
      }
    }

    const first = deriveBuildingHeights(state, densityCaps);
    const second = deriveBuildingHeights(state, densityCaps);

    expect(second).toEqual(first);
    expect(first.filter((height) => height > 0)).toHaveLength(24);
    expect(Math.max(...first.filter((_, id) => state.map.zones[id] === 'R'))).toBe(6);
    expect(Math.max(...first.filter((_, id) => state.map.zones[id] === 'C'))).toBe(6);
    expect(Math.max(...first.filter((_, id) => state.map.zones[id] === 'I')))
      .toBeLessThanOrEqual(4);
  });
});

describe('appearance-only lot merging', () => {
  const cases: Array<{
    range: [number, number];
    footprint: MarketLotFootprint;
    cells: Array<[number, number]>;
  }> = [
    { range: [0, 14], footprint: '2x2', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
    { range: [14, 30], footprint: 'L', cells: [[0, 0], [0, 1], [1, 1]] },
    { range: [30, 50], footprint: '1x2', cells: [[0, 0], [1, 0]] },
    { range: [50, 66], footprint: '2x1', cells: [[0, 0], [0, 1]] },
    { range: [66, 100], footprint: '1x1', cells: [[0, 0]] },
  ];

  for (const fixture of cases) {
    it(`uses the ${fixture.footprint} threshold and row-major origin`, () => {
      const state = makeState();
      const desirability = Array<number>(tileCount).fill(0.75);
      const densityCaps = Array<number>(tileCount).fill(0.1);
      const { x, y } = findOrigin(...fixture.range);
      const ids = fixture.cells.map(([dx, dy]) => develop(state, x + dx, y + dy, 'R'));

      const lots = deriveRenderLots(state, densityCaps);
      const originLot = lots.find((lot) => lot.tileIds.includes(ids[0]!));

      expect(originLot?.footprint).toBe(fixture.footprint);
      expect(originLot?.tileIds).toEqual(ids);
    });
  }

  it('fails closed to 1x1 when the selected footprint cannot be claimed', () => {
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(1);
    const densityCaps = Array<number>(tileCount).fill(0.1);
    const { x, y } = findOrigin(0, 14);
    const origin = develop(state, x, y, 'R');
    develop(state, x + 1, y, 'R');
    develop(state, x, y + 1, 'R');

    const originLot = deriveRenderLots(state, densityCaps)
      .find((lot) => lot.tileIds.includes(origin));

    expect(originLot?.footprint).toBe('1x1');
    expect(originLot?.tileIds).toEqual([origin]);
  });

  it('merges only equal-zone, equal-height developed tiles', () => {
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(1);
    const densityCaps = Array<number>(tileCount).fill(0.1);
    const { x, y } = findOrigin(0, 14);
    const origin = develop(state, x, y, 'R');
    develop(state, x + 1, y, 'C');
    develop(state, x, y + 1, 'R');
    develop(state, x + 1, y + 1, 'R');

    const originLot = deriveRenderLots(state, densityCaps)
      .find((lot) => lot.tileIds.includes(origin));

    expect(originLot?.footprint).toBe('1x1');
  });

  it('falls back to a flat cap for rectangle-only roofs on an L lot', () => {
    const needsRectangle = new Set<MarketRoofKind>(['gable', 'sawtooth', 'parapet', 'steps', 'wedge']);
    const { x, y } = findOrigin(14, 30, (px, py) => {
      const roof = pickBuildingRoof('R', 1, tileHash(px, py, 11)).roof;
      return needsRectangle.has(roof);
    });
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(1);
    const densityCaps = Array<number>(tileCount).fill(0.1);
    const origin = develop(state, x, y, 'R');
    develop(state, x, y + 1, 'R');
    develop(state, x + 1, y + 1, 'R');

    const lot = deriveRenderLots(state, densityCaps)
      .find((candidate) => candidate.tileIds.includes(origin));

    expect(lot?.footprint).toBe('L');
    expect(lot?.roof).toBe('flat');
    expect(lot?.roofHeight).toBe(1);
    expect(lot?.roofOrientation).toBe(0);
  });
});

describe('city-wide render-lot rules', () => {
  it('gives exactly one tallest commercial lot a spire, tie-breaking by y then x', () => {
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(1);
    const densityCaps = Array<number>(tileCount).fill(0.1);
    const candidates = [
      develop(state, 10, 10, 'C'),
      develop(state, 5, 3, 'C'),
      develop(state, 3, 3, 'C'),
    ];

    const lots = deriveRenderLots(state, densityCaps);
    const landmarks = lots.filter((lot) => lot.landmark);

    expect(landmarks).toHaveLength(1);
    expect(landmarks[0]?.tileIds).toEqual([candidates[2]]);
    expect(landmarks[0]?.roof).toBe('spire');
    expect(landmarks[0]?.roofHeight).toBe(2);
  });

  it('renders a pinned building incident from its captured merged structure', () => {
    const { x, y } = findOrigin(0, 14);
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(1);
    const densityCaps = Array<number>(tileCount).fill(0.1);
    const ids = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([dx, dy]) => (
      develop(state, x + dx!, y + dy!, 'I')
    ));
    state.fire.char[ids[2]!] = 0.65;
    const openingLot = deriveRenderLots(state, densityCaps)
      .find((candidate) => candidate.tileIds.includes(ids[0]!))!;
    state.fire.incidents.push({
      id: `fire-m1-t${Math.min(...openingLot.tileIds)}`,
      status: 'burning',
      tileIds: [...openingLot.tileIds].sort((left, right) => left - right),
      zone: openingLot.zone,
      startedMonth: 1,
      structure: captureBuildingStructure(openingLot),
      intensity: 0.8,
      damage: 6,
      age: 18,
      rubbleMonthsRemaining: 0,
    });

    const lot = deriveRenderLots(state, densityCaps)
      .find((candidate) => candidate.tileIds.includes(ids[0]!));

    expect(lot?.fireIntensity).toBe(0.8);
    expect(lot?.incidentId).toBe(`fire-m1-t${Math.min(...openingLot.tileIds)}`);
    expect(lot?.char).toBe(0.65);
    expect(lot?.plume).toBe(1);
    expect(deriveFirePlume(0, 18)).toBe(0);
  });

  it('is stable across calls and does not mutate authoritative state', () => {
    const state = makeState();
    const desirability = Array<number>(tileCount).fill(0.8);
    const densityCaps = Array<number>(tileCount).fill(0.4);
    for (let y = 4; y < 10; y += 1) {
      for (let x = 4; x < 12; x += 1) develop(state, x, y, y < 6 ? 'R' : y < 8 ? 'C' : 'I', 0.4);
    }
    const before = JSON.stringify(state);

    const first = deriveRenderLots(state, densityCaps);
    const second = deriveRenderLots(state, densityCaps);

    expect(second).toEqual(first);
    expect(JSON.stringify(state)).toBe(before);
  });
});
