import { describe, expect, it } from 'vitest';

import { deriveBuildingUnits } from '../../src/market-city/appearance';
import {
  deriveFireStationCoverage,
  deriveIncidentSuppression,
  derivePotentialFireCoverage,
  deterministicFireRandom,
  mix32,
  reconstructFireHistoryAtMonth,
  stepMarketFire,
} from '../../src/market-city/fire';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { buildResidentialBootstrapScenario } from '../../src/market-city/scenarios';
import { stepMonth } from '../../src/market-city/simulation';
import { createMarketCityState, hashDeterministicState } from '../../src/market-city/state';
import type {
  MarketCityStateV2,
  MarketFireIncident,
  MarketRenderLot,
  MarketZoneKind,
} from '../../src/market-city/types';

const SIZE = 48;
const tile = (x: number, y: number): number => y * SIZE + x;

function state(): MarketCityStateV2 {
  const value = createMarketCityState({
    cityId: 'fire-test',
    cityName: 'Fire Test',
    mayorName: 'Test Mayor',
    seed: 17,
    createdAt: '2026-08-11T00:00:00.000Z',
  });
  value.clock.paused = false;
  return value;
}

function develop(value: MarketCityStateV2, tileIds: readonly number[], zone: MarketZoneKind, density = 1): void {
  for (const id of tileIds) {
    value.map.zones[id] = zone;
    value.economy.density[id] = density;
    value.economy.wealth[id] = 20_000;
  }
}

function lot(tileIds: number[], zone: MarketZoneKind, footprint: MarketRenderLot['footprint']): MarketRenderLot {
  return {
    id: `lot-${tileIds[0]}`,
    tileIds,
    zone,
    height: 4,
    footprint,
    roof: 'flat',
    roofHeight: 1,
    roofOrientation: 0,
    detail: 'windows',
    color: zone === 'R' ? [112, 204, 124] : zone === 'C' ? [96, 166, 240] : [238, 178, 80],
    landmark: false,
    incidentId: null,
    fireIntensity: 0,
    fireDamage: 0,
    fireAge: 0,
    char: 0,
    plume: 0,
  };
}

function incident(
  tileIds: number[],
  zone: MarketZoneKind = 'R',
  overrides: Partial<MarketFireIncident> = {},
): MarketFireIncident {
  const originTile = Math.min(...tileIds);
  return {
    id: `fire-m1-t${originTile}`,
    status: 'burning',
    tileIds: [...tileIds].sort((left, right) => left - right),
    zone,
    startedMonth: 1,
    structure: {
      footprint: tileIds.length === 4 ? '2x2' : tileIds.length === 3 ? 'L' : tileIds.length === 2 ? '1x2' : '1x1',
      originTile,
      height: 4,
      roof: 'flat',
      roofHeight: 1,
      roofOrientation: 0,
      detail: 'windows',
      color: [112, 204, 124],
      landmark: false,
    },
    intensity: 0.04,
    damage: 0,
    age: 0,
    rubbleMonthsRemaining: 0,
    ...overrides,
  };
}

/**
 * Power is derived from the MAP, not from the persisted field, so a fixture
 * cannot simply flag a tile as powered — it needs a real supply.
 *
 * One shared plant sits well clear of the tiles these scenarios burn, and each
 * station gets a single line tile on its west side to draw from. Putting a
 * plant directly beside a station instead would occupy the very cells the
 * fixtures develop and set alight.
 */
const SUPPLY_X = 2;
function powerAt(value: MarketCityStateV2, anchor: number): void {
  const y = Math.floor(anchor / SIZE);
  if (!value.map.facilities.some(({ id }) => id === 'fixture-supply')) {
    const plant = tile(SUPPLY_X, y);
    value.map.facilities.push({
      id: 'fixture-supply', kind: 'wind-turbine', anchor: plant,
      tiles: [plant],
    });
  }
  for (let x = SUPPLY_X + 1; x < anchor % SIZE; x += 1) value.map.powerLines[tile(x, y)] = true;
}

function addOperationalStation(value: MarketCityStateV2, anchor = tile(12, 12), id = 'station-1'): void {
  value.map.facilities.push({ id, kind: 'fire-station', anchor, tiles: [anchor] });
  value.map.roads[anchor + SIZE] = true;
  powerAt(value, anchor);
}

describe('building-unit fire', () => {
  it('locks the deterministic fire random mixer', () => {
    expect(mix32(0)).toBe(493_009_611);
    expect(deterministicFireRandom(0, 0, 0)).toBeCloseTo(0.11478774505667388, 15);
    expect(deterministicFireRandom(1, 1, 1)).toBeCloseTo(0.3913913934957236, 15);
  });

  it('uses the approved constants and documented SynthCity deviations', () => {
    expect(MARKET_CITY_RULES.fire).toMatchObject({
      ignition: 0.00012,
      spread: 0.011,
      growth: 0.11,
      collapseDamage: 11,
      burnRate: 0.018,
      charDecay: 0.0035,
      wetReduction: 0.55,
      stationRadius: 21,
      stationPower: 0.30,
      suppression: 0.30,
      rubbleMonths: 50,
    });
  });

  it('derives every supported footprint as one shared unit and reserves active incidents', () => {
    const value = state();
    const ids = [tile(20, 20), tile(21, 20), tile(20, 21), tile(21, 21)];
    develop(value, ids, 'C');
    const desirability = Array(48 * 48).fill(1);
    const caps = Array(48 * 48).fill(0.1);
    const units = deriveBuildingUnits(value, caps);
    const grouped = units.find((candidate) => candidate.tileIds.includes(ids[0]!));
    expect(grouped?.tileIds.length).toBeGreaterThan(1);

    value.fire.incidents.push(incident(grouped!.tileIds, 'C', {
      structure: {
        ...incident(grouped!.tileIds).structure,
        footprint: grouped!.footprint,
        height: grouped!.height,
      },
    }));
    value.economy.density[ids[3]!] = 0;
    expect(deriveBuildingUnits(value, caps).every((unit) => (
      unit.tileIds.every((id) => !grouped!.tileIds.includes(id))
    ))).toBe(true);
  });

  it.each([
    ['1x1', [tile(10, 10)]],
    ['1x2', [tile(10, 10), tile(11, 10)]],
    ['2x1', [tile(10, 10), tile(10, 11)]],
    ['2x2', [tile(10, 10), tile(11, 10), tile(10, 11), tile(11, 11)]],
    ['L', [tile(10, 10), tile(10, 11), tile(11, 11)]],
  ] as const)('ignites a complete %s lot with one deterministic building draw', (footprint, ids) => {
    const value = state();
    develop(value, ids, 'I');
    const origin = Math.min(...ids);
    const hazard = MARKET_CITY_RULES.fire.ignition * ids.length * MARKET_CITY_RULES.fire.flammability.I;
    const probability = 1 - Math.exp(-hazard);
    let ignitionMonth = 1;
    while (deterministicFireRandom(origin, ignitionMonth, 1) >= probability) ignitionMonth += 1;
    value.clock.month = ignitionMonth - 1;

    const next = stepMarketFire(value, [lot([...ids], 'I', footprint)]);
    expect(next.clock.month).toBe(ignitionMonth);
    expect(next.fire.incidents).toHaveLength(1);
    expect(next.fire.incidents[0]).toMatchObject({
      startedMonth: ignitionMonth,
      tileIds: [...ids].sort((left, right) => left - right),
      structure: { footprint },
    });
    expect(next.fire.history).toHaveLength(1);
    expect(next.fire.history[0]).toMatchObject({ event: 'ignited', tileIds: [...ids].sort((left, right) => left - right) });
  });

  it('ignites naturally through the complete Normal monthly simulation', () => {
    let value = buildResidentialBootstrapScenario().state;
    value.market.verticalDevelopmentLevel = 10;
    value.clock.fireDifficulty = 'normal';
    for (let month = 1; month <= 50; month += 1) {
      value = stepMonth(value);
      expect(value.fire.history.some((entry) => entry.event === 'ignited')).toBe(month === 50);
    }

    expect(value.fire.incidents).toEqual([
      expect.objectContaining({
        id: 'fire-m50-t441',
        status: 'burning',
        tileIds: [441],
        zone: 'C',
        startedMonth: 50,
        intensity: 0.04,
      }),
    ]);
  });

  it('advances and burns an entire 2x2 incident with one intensity curve', () => {
    const value = state();
    const ids = [tile(10, 10), tile(11, 10), tile(10, 11), tile(11, 11)];
    develop(value, ids, 'R', 0.8);
    value.fire.incidents.push(incident(ids));

    const next = stepMarketFire(value, []);
    expect(next.fire.incidents).toHaveLength(1);
    expect(next.fire.incidents[0]?.tileIds).toEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids.map((id) => next.economy.density[id]))).toHaveLength(1);
    expect(value.economy.density[ids[0]!]).toBe(0.8);
  });

  it('weights spread once for every shared footprint edge and delays new spread one month', () => {
    const value = state();
    const sourceIds = [tile(10, 10), tile(10, 11)];
    const targetIds = [tile(11, 10), tile(11, 11)];
    develop(value, sourceIds, 'I');
    develop(value, targetIds, 'R');
    value.fire.incidents.push(incident(sourceIds, 'I', { intensity: 1 }));
    const targetLot = lot(targetIds, 'R', '2x1');

    let ignitionMonth = 1;
    while (ignitionMonth < 2_000) {
      value.clock.month = ignitionMonth - 1;
      const result = stepMarketFire(value, [targetLot]);
      if (result.fire.incidents.length === 2) {
        const created = result.fire.incidents.find((entry) => entry.id !== value.fire.incidents[0]!.id)!;
        expect(created.intensity).toBe(0.04);
        expect(created.age).toBe(0);
        break;
      }
      ignitionMonth += 1;
    }
    expect(ignitionMonth).toBeLessThan(2_000);
  });

  it('requires road and power but not water, accepts Avenue service, and covers 925 radius-twenty-one cells', () => {
    const value = state();
    const anchor = tile(24, 24);
    value.map.facilities.push({ id: 'station-1', kind: 'fire-station', anchor, tiles: [anchor] });
    expect(derivePotentialFireCoverage(value).every((amount) => amount === 0)).toBe(true);

    // Road alone is no longer enough.
    value.map.roads[tile(24, 25)] = true;
    expect(derivePotentialFireCoverage(value).every((amount) => amount === 0)).toBe(true);

    powerAt(value, anchor);
    let coverage = derivePotentialFireCoverage(value);
    expect(coverage.filter((amount) => amount > 0)).toHaveLength(925);
    expect(coverage[anchor]).toBeCloseTo(0.30, 12);
    expect(coverage[tile(45, 24)]).toBeCloseTo(0.30 / 22, 12);
    expect(coverage[tile(46, 24)]).toBe(0);

    value.map.roads[tile(24, 25)] = false;
    value.map.avenueLanes[tile(24, 25)] = true;
    coverage = derivePotentialFireCoverage(value);
    expect(coverage.filter((amount) => amount > 0)).toHaveLength(925);
  });

  it('splits fixed station power across unique incidents rather than their tiles', () => {
    const value = state();
    addOperationalStation(value);
    const first = incident([tile(13, 12), tile(14, 12)], 'R');
    const second = incident([tile(12, 14)], 'C', { id: `fire-m1-t${tile(12, 14)}` });
    value.fire.incidents.push(first, second);
    const coverage = deriveFireStationCoverage(value);
    const suppression = deriveIncidentSuppression(value);
    expect(coverage[tile(13, 12)]).toBeCloseTo(0.15 * (21 / 22), 12);
    expect(suppression.get(first.id)).toBeCloseTo(0.15 * (21 / 22), 12);
    expect(suppression.get(second.id)).toBeCloseTo(0.15 * (20 / 22), 12);
  });

  it('one point-blank station slows a fire while two suppress it', () => {
    const one = state();
    const anchor = tile(12, 12);
    addOperationalStation(one, anchor);
    develop(one, [anchor + 1], 'R');
    one.fire.incidents.push(incident([anchor + 1]));
    const slowed = stepMarketFire(one, []).fire.incidents[0];
    expect(slowed?.status).toBe('burning');
    expect(slowed?.intensity).toBeLessThan(0.04 + 0.11 * 0.96);

    const two = state();
    addOperationalStation(two, anchor, 'station-1');
    two.map.facilities.push({ id: 'station-2', kind: 'fire-station', anchor: anchor + 1, tiles: [anchor + 1] });
    two.map.roads[anchor + 2] = true;
    powerAt(two, anchor + 1);
    develop(two, [anchor + 2], 'R');
    two.fire.incidents.push(incident([anchor + 2]));
    expect(stepMarketFire(two, []).fire.incidents).toHaveLength(0);
  });

  it('collapses the whole footprint and retains immutable rubble for exactly 50 later steps', () => {
    let value = state();
    const ids = [tile(20, 20), tile(21, 20), tile(20, 21), tile(21, 21)];
    develop(value, ids, 'I');
    value.fire.incidents.push(incident(ids, 'I', { intensity: 1, damage: 10.5, age: 17 }));
    value = stepMarketFire(value, []);
    expect(value.fire.incidents[0]).toMatchObject({ status: 'rubble', rubbleMonthsRemaining: 50 });
    expect(ids.map((id) => value.economy.density[id])).toEqual([0, 0, 0, 0]);
    expect(ids.map((id) => value.map.zones[id])).toEqual(['I', 'I', 'I', 'I']);

    for (let month = 1; month <= 49; month += 1) value = stepMarketFire(value, []);
    expect(value.fire.incidents[0]?.rubbleMonthsRemaining).toBe(1);
    value = stepMarketFire(value, []);
    expect(value.fire.incidents).toHaveLength(0);
    expect(value.fire.history.at(-1)?.event).toBe('rubble-cleared');
  });

  it('records deterministic lifetime history and reconstructs read-only overlays', () => {
    const value = state();
    const id = tile(8, 8);
    develop(value, [id], 'C');
    const opening = incident([id], 'C', { intensity: 1, damage: 10.5 });
    value.fire.incidents.push(opening);
    value.fire.history.push({
      sequence: 1, month: 1, incidentId: opening.id, event: 'ignited', tileIds: [id],
      zone: 'C', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
    });
    const first = stepMarketFire(value, []);
    const firstAtMonth = { ...first, clock: { ...first.clock, month: 1 } };
    const hash = hashDeterministicState(firstAtMonth);
    const overlays = reconstructFireHistoryAtMonth(firstAtMonth, 1);
    expect(overlays).toEqual([
      expect.objectContaining({ incidentId: `fire-m1-t${id}`, event: 'collapse', tileIds: [id] }),
    ]);
    expect(hashDeterministicState(firstAtMonth)).toBe(hash);
    const replay = stepMarketFire(value, []);
    const replayAtMonth = { ...replay, clock: { ...replay.clock, month: 1 } };
    expect(replayAtMonth).toEqual(firstAtMonth);
  });

  it('shows ignition and suppression as one-month history flashes', () => {
    const value = state();
    const id = tile(8, 8);
    const fire = incident([id], 'R', { intensity: 0, damage: 0, age: 0 });
    value.clock.month = 6;
    value.fire.history = [
      {
        sequence: 1, month: 3, incidentId: fire.id, event: 'ignited', tileIds: [id],
        zone: 'R', intensity: 0.04, damage: 0, rubbleMonthsRemaining: 0,
      },
      {
        sequence: 2, month: 4, incidentId: fire.id, event: 'suppressed', tileIds: [id],
        zone: 'R', intensity: 0, damage: 0, rubbleMonthsRemaining: 0,
      },
    ];

    expect(reconstructFireHistoryAtMonth(value, 3)).toEqual([
      expect.objectContaining({ incidentId: fire.id, event: 'ignition' }),
    ]);
    expect(reconstructFireHistoryAtMonth(value, 4)).toEqual([
      expect.objectContaining({ incidentId: fire.id, event: 'suppression' }),
    ]);
    expect(reconstructFireHistoryAtMonth(value, 5)).toEqual([]);
  });
});
