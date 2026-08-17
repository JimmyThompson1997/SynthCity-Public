import { describe, expect, it } from 'vitest';

import { MARKET_CITY_RULES } from '../../src/market-city/rules';

import { coordinateToIndex } from '../../src/market-city/math';
import { createMarketCityState } from '../../src/market-city/state';
import {
  deriveCongestion,
  deriveActiveMarketDesirability,
  deriveDensityCaps,
  deriveDesirability,
  derivePollution,
  derivePower,
  deriveRoadAccess,
  hasFacilityRoadAccess,
  type MarketPowerResult,
} from '../../src/market-city/spatial';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketCityStateV2,
  type MarketFacility,
  type MarketZoneKind,
} from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const TILE_COUNT = SIZE * SIZE;
const tile = (x: number, y: number) => coordinateToIndex(x, y, SIZE);

function makeState(): MarketCityStateV2 {
  const result = createMarketCityState({
      cityId: 'spatial-test',
      cityName: 'Spatial Test',
      mayorName: 'Test Mayor',
      seed: 41,
      createdAt: '2026-08-11T00:00:00.000Z',
  });
  result.clock.paused = false;
  return result;
}

function addFacility(state: MarketCityStateV2, facility: MarketFacility): void {
  state.map.facilities.push(facility);
}

function blankPower(overrides: Partial<MarketPowerResult> = {}): MarketPowerResult {
  return {
    powered: Array<boolean>(TILE_COUNT).fill(false),
    componentByTile: Array<string | null>(TILE_COUNT).fill(null),
    components: [],
    livePlantIds: [],
    liveCapacity: 0,
    load: 0,
    allocatedLoad: 0,
    unservedLoad: 0,
    constrainedComponentCount: 0,
    headroom: 0,
    plantOperations: [],
    ...overrides,
  };
}

describe('deriveRoadAccess', () => {
  it('serves zoned tiles through Manhattan radius three, but not radius four', () => {
    const state = makeState();
    const onBoundary = tile(10, 10);
    const outsideBoundary = tile(20, 20);
    state.map.zones[onBoundary] = 'R';
    state.map.zones[outsideBoundary] = 'C';
    state.map.roads[tile(13, 10)] = true;
    state.map.roads[tile(24, 20)] = true;

    const access = deriveRoadAccess(state);

    expect(access[onBoundary]).toBe(true);
    expect(access[outsideBoundary]).toBe(false);
    expect(access[tile(13, 10)]).toBe(false);
  });

  it('derives facility reach from the shared road surface at the radius-three boundary', () => {
    const state = makeState();
    const station: MarketFacility = {
      id: 'fire-station',
      kind: 'fire-station',
      anchor: tile(10, 10),
      tiles: [tile(10, 10)],
    };
    addFacility(state, station);
    state.environment.roadAccess[station.anchor] = true;
    state.map.avenueLanes[tile(11, 10)] = true;
    state.map.roads[tile(14, 10)] = true;

    expect(hasFacilityRoadAccess(state, station)).toBe(true);

    state.map.avenueLanes[tile(11, 10)] = false;
    expect(hasFacilityRoadAccess(state, station)).toBe(false);

    state.map.roads[tile(13, 10)] = true;
    expect(hasFacilityRoadAccess(state, station)).toBe(true);

    state.map.roads[tile(13, 10)] = false;
    expect(hasFacilityRoadAccess(state, station)).toBe(false);
  });
});

describe('derivePower', () => {
  it('keeps a roadless renewable live when its footprint touches conductive zones', () => {
    const state = makeState();
    const plantTile = tile(5, 5);
    const zoneTile = tile(6, 5);
    state.map.zones[zoneTile] = 'R';
    state.economy.density[zoneTile] = 0.5;
    addFacility(state, {
      id: 'roadless-wind',
      kind: 'wind-turbine',
      anchor: plantTile,
      tiles: [plantTile],
    });

    const power = derivePower(state);

    expect(power.livePlantIds).toEqual(['roadless-wind']);
    expect(power.liveCapacity).toBe(60);
    expect(power.powered[plantTile]).toBe(true);
    expect(power.powered[zoneTile]).toBe(true);
  });

  it('uses powered zones as conductors and bridges one intervening road in a straight line', () => {
    const state = makeState();
    const plantTile = tile(2, 2);
    const firstZone = tile(3, 2);
    const bridgeRoad = tile(4, 2);
    const secondZone = tile(5, 2);
    state.map.zones[firstZone] = 'R';
    state.map.zones[secondZone] = 'C';
    state.map.roads[tile(2, 3)] = true;
    state.map.roads[bridgeRoad] = true;
    addFacility(state, {
      id: 'wind',
      kind: 'wind-turbine',
      anchor: plantTile,
      tiles: [plantTile],
    });

    const power = derivePower(state);

    expect(power.livePlantIds).toEqual(['wind']);
    expect(power.powered[plantTile]).toBe(true);
    expect(power.powered[firstZone]).toBe(true);
    expect(power.powered[bridgeRoad]).toBe(true);
    expect(power.powered[secondZone]).toBe(true);
  });

  it('conducts through orthogonal power lines but not a merely diagonal zone', () => {
    const state = makeState();
    const plantTile = tile(7, 7);
    const firstLine = tile(8, 7);
    const secondLine = tile(9, 7);
    const diagonalZone = tile(10, 8);
    state.map.roads[tile(7, 8)] = true;
    state.map.powerLines[firstLine] = true;
    state.map.powerLines[secondLine] = true;
    state.map.zones[diagonalZone] = 'R';
    addFacility(state, {
      id: 'line-wind',
      kind: 'wind-turbine',
      anchor: plantTile,
      tiles: [plantTile],
    });

    const power = derivePower(state);

    expect(power.powered[firstLine]).toBe(true);
    expect(power.powered[secondLine]).toBe(true);
    expect(power.powered[diagonalZone]).toBe(false);
  });

  it('does not bridge diagonally or across two consecutive road tiles', () => {
    const state = makeState();
    const plantTile = tile(10, 10);
    const diagonalTarget = tile(12, 11);
    const twoRoadTarget = tile(14, 10);
    state.map.zones[diagonalTarget] = 'R';
    state.map.zones[twoRoadTarget] = 'I';
    state.map.roads[tile(10, 11)] = true;
    state.map.roads[tile(11, 10)] = true;
    state.map.roads[tile(12, 10)] = true;
    state.map.roads[tile(13, 10)] = true;
    addFacility(state, {
      id: 'solar',
      kind: 'solar-plant',
      anchor: plantTile,
      tiles: [plantTile],
    });

    const power = derivePower(state);

    expect(power.livePlantIds).toEqual(['solar']);
    expect(power.powered[diagonalTarget]).toBe(false);
    expect(power.powered[twoRoadTarget]).toBe(false);
  });

  it('aggregates mixed live-plant capacity and weighted RCI load', () => {
    const state = makeState();
    const windTile = tile(2, 2);
    const solarTile = tile(12, 12);
    const nuclearTile = tile(30, 30);
    state.map.roads[tile(12, 15)] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: windTile, tiles: [windTile] });
    addFacility(state, { id: 'solar', kind: 'solar-plant', anchor: solarTile, tiles: [solarTile] });
    addFacility(state, { id: 'nuclear', kind: 'nuclear-power-plant', anchor: nuclearTile, tiles: [nuclearTile] });
    const residential = tile(20, 20);
    const commercial = tile(21, 20);
    const industrial = tile(22, 20);
    state.map.zones[residential] = 'R';
    state.map.zones[commercial] = 'C';
    state.map.zones[industrial] = 'I';
    state.economy.density[residential] = 0.5;
    state.economy.density[commercial] = 0.25;
    state.economy.density[industrial] = 0.1;

    const power = derivePower(state);

    expect(power.livePlantIds).toEqual(['wind', 'solar']);
    expect(power.liveCapacity).toBe(150);
    expect(power.load).toBeCloseTo(4.25, 12);
    expect(power.headroom).toBeCloseTo(1 - 4.25 / 150, 12);
  });

  it('allocates each component only from its own plants instead of sharing global spare capacity', () => {
    const state = makeState();
    const overloadedPlant = tile(2, 2);
    const sparePlant = tile(20, 20);
    state.map.roads[tile(2, 3)] = true;
    state.map.roads[tile(20, 21)] = true;
    addFacility(state, {
      id: 'overloaded-wind',
      kind: 'wind-turbine',
      anchor: overloadedPlant,
      tiles: [overloadedPlant],
    });
    addFacility(state, {
      id: 'spare-wind',
      kind: 'wind-turbine',
      anchor: sparePlant,
      tiles: [sparePlant],
    });
    for (let x = 3; x <= 6; x += 1) {
      const industrial = tile(x, 2);
      state.map.zones[industrial] = 'I';
      state.economy.density[industrial] = 1;
    }
    const spareEmptyZone = tile(21, 20);
    state.map.zones[spareEmptyZone] = 'R';

    const power = derivePower(state);

    expect(power.load).toBe(80);
    expect(power.liveCapacity).toBe(120);
    expect(power.allocatedLoad).toBe(60);
    expect(power.unservedLoad).toBe(20);
    expect(power.powered[tile(3, 2)]).toBe(true);
    expect(power.powered[tile(4, 2)]).toBe(true);
    expect(power.powered[tile(5, 2)]).toBe(true);
    expect(power.powered[tile(6, 2)]).toBe(false);
    expect(power.powered[spareEmptyZone]).toBe(true);
    expect(power.constrainedComponentCount).toBe(1);
    expect(power.components.map(({ capacity, demand, allocated }) => ({ capacity, demand, allocated })))
      .toEqual([
        { capacity: 60, demand: 80, allocated: 60 },
        { capacity: 60, demand: 0, allocated: 0 },
      ]);
  });

  it('keeps previously powered consumers first, then uses stable tile order', () => {
    const state = makeState();
    const plant = tile(2, 10);
    state.map.roads[tile(2, 11)] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
    const consumers = [3, 4, 5, 6].map((x) => tile(x, 10));
    for (const consumer of consumers) {
      state.map.zones[consumer] = 'I';
      state.economy.density[consumer] = 1;
    }
    state.environment.powered[consumers[3]!] = true;

    const power = derivePower(state);

    expect(power.powered[consumers[3]!]).toBe(true);
    expect(power.powered[consumers[0]!]).toBe(true);
    expect(power.powered[consumers[1]!]).toBe(true);
    expect(power.powered[consumers[2]!]).toBe(false);
  });

  it('skips a non-fitting consumer, powers a later fitting consumer, and leaves empty lots available', () => {
    const state = makeState();
    const plant = tile(2, 20);
    state.map.roads[tile(2, 21)] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
    const loads = [
      [tile(3, 20), 'I', 1],
      [tile(4, 20), 'I', 1],
      [tile(5, 20), 'C', 1],
      [tile(6, 20), 'C', 1],
      [tile(7, 20), 'I', 1],
      [tile(8, 20), 'R', 1],
    ] as const;
    for (const [consumer, zone, density] of loads) {
      state.map.zones[consumer] = zone;
      state.economy.density[consumer] = density;
    }
    const emptyZone = tile(9, 20);
    state.map.zones[emptyZone] = 'R';

    const power = derivePower(state);

    expect(power.load).toBe(75);
    expect(power.allocatedLoad).toBe(55);
    expect(power.powered[tile(7, 20)]).toBe(false);
    expect(power.powered[tile(8, 20)]).toBe(true);
    expect(power.powered[emptyZone]).toBe(true);
    expect(power.components[0]?.remaining).toBe(5);
  });

  it('allows an exact-capacity allocation but withholds availability from an empty lot', () => {
    const state = makeState();
    const plant = tile(2, 30);
    state.map.roads[tile(2, 31)] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
    const consumers = [3, 4, 5].map((x) => tile(x, 30));
    for (const consumer of consumers) {
      state.map.zones[consumer] = 'I';
      state.economy.density[consumer] = 1;
    }
    const emptyZone = tile(6, 30);
    state.map.zones[emptyZone] = 'R';

    const power = derivePower(state);

    expect(consumers.every((consumer) => power.powered[consumer])).toBe(true);
    expect(power.allocatedLoad).toBe(60);
    expect(power.unservedLoad).toBe(0);
    expect(power.components[0]?.remaining).toBe(0);
    expect(power.powered[emptyZone]).toBe(false);
  });

  it('allocates each Train Station as one ordinary 20-power consumer in the shared queue', () => {
    const state = makeState();
    const wind = tile(2, 20);
    const station: MarketFacility = {
      id: 'station', kind: 'train-station', anchor: tile(3, 20),
      tiles: [tile(3, 20), tile(4, 20), tile(3, 21), tile(4, 21)],
    };
    state.map.roads[tile(2, 21)] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: wind, tiles: [wind] });
    addFacility(state, station);
    const industrial = [tile(5, 20), tile(6, 20), tile(7, 20)];
    for (const consumer of industrial) {
      state.map.zones[consumer] = 'I';
      state.economy.density[consumer] = 1;
    }

    let power = derivePower(state);
    expect(power.components[0]).toMatchObject({ capacity: 60, demand: 80, allocated: 60, remaining: 0, constrained: true });
    expect(power.load).toBe(80);
    expect(power.allocatedLoad).toBe(60);
    expect(power.unservedLoad).toBe(20);
    expect(station.tiles.every((cell) => power.powered[cell])).toBe(true);
    expect(power.powered[industrial[2]!]).toBe(false);

    // The previously served RCI tiles consume the 60-power wind allocation
    // first; the station gets no privileged reservation and goes dark whole.
    state.environment.powered.fill(false);
    for (const consumer of industrial) state.environment.powered[consumer] = true;
    power = derivePower(state);
    expect(station.tiles.every((cell) => !power.powered[cell])).toBe(true);
    expect(industrial.every((cell) => power.powered[cell])).toBe(true);
  });

  it('counts one multi-tile plant exactly once inside its component', () => {
    const state = makeState();
    const footprint = [
      tile(5, 5), tile(6, 5),
      tile(5, 6), tile(6, 6),
      tile(5, 7), tile(6, 7),
    ];
    addFacility(state, {
      id: 'solar',
      kind: 'solar-plant',
      anchor: footprint[0]!,
      tiles: footprint,
    });

    const power = derivePower(state);

    expect(power.livePlantIds).toEqual(['solar']);
    expect(power.liveCapacity).toBe(90);
    expect(power.components).toHaveLength(1);
    expect(power.components[0]?.livePlantIds).toEqual(['solar']);
    expect(power.components[0]?.capacity).toBe(90);
  });
});

describe('deriveCongestion', () => {
  it('sets only road cells and clamps density within Manhattan radius three to one', () => {
    const state = makeState();
    const road = tile(20, 20);
    const outside = tile(24, 20);
    state.map.roads[road] = true;
    for (const [x, y] of [[20, 19], [21, 20], [19, 20], [20, 22], [22, 21]] as const) {
      const zoned = tile(x, y);
      state.map.zones[zoned] = 'R';
      state.economy.density[zoned] = 1;
    }
    state.map.zones[outside] = 'I';
    state.economy.density[outside] = 1;

    const congestion = deriveCongestion(state);

    expect(congestion[road]).toBe(1);
    expect(congestion[outside]).toBe(0);
    expect(congestion[tile(0, 0)]).toBe(0);
  });

  it('includes the radius-three boundary and excludes radius four', () => {
    const state = makeState();
    const road = tile(5, 5);
    const onBoundary = tile(8, 5);
    const outsideBoundary = tile(9, 5);
    state.map.roads[road] = true;
    state.map.zones[onBoundary] = 'R';
    state.map.zones[outsideBoundary] = 'I';
    state.economy.density[onBoundary] = 1;
    state.economy.density[outsideBoundary] = 1;

    expect(deriveCongestion(state)[road]).toBeCloseTo(0.25, 12);
  });
});

describe('derivePollution', () => {
  it('settles a uniform term at its own value, not at the value over the approach rate', () => {
    // The unmanaged-waste term is documented as capped at
    // MARKET_CITY_RULES.waste.maximumUnmanagedPollution. It used to be added
    // AFTER the approach step, so it was re-injected every month onto a stock
    // that only relaxes by pollutionApproach and settled at cap / approach --
    // ten became about sixty-seven of the nought-to-hundred scale, from
    // uncollected rubbish alone. It belongs in the field the stock approaches.
    const state = makeState();
    const uniform = MARKET_CITY_RULES.waste.maximumUnmanagedPollution;
    const runaway = uniform / MARKET_CITY_RULES.pollutionApproach;
    expect(runaway).toBeGreaterThan(uniform * 6);

    for (let month = 0; month < 400; month += 1) {
      state.environment.pollution = derivePollution(
        state,
        blankPower({ load: 0 }),
        state.environment.congestion,
        uniform,
      );
    }

    // An empty map has no emission field, so the stock must settle on the term.
    expect(state.environment.pollution[tile(24, 24)]).toBeCloseTo(uniform, 6);
    expect(state.environment.pollution[tile(0, 0)]).toBeCloseTo(uniform, 6);
  });

  it('normalizes the radius-six kernel at map edges', () => {
    const state = makeState();
    state.map.zones.fill('I');
    state.economy.density.fill(1);

    const pollution = derivePollution(state, blankPower({ load: TILE_COUNT * 20 }));

    expect(pollution[tile(0, 0)]).toBeCloseTo(22.5, 10);
    expect(pollution[tile(24, 24)]).toBeCloseTo(22.5, 10);
  });

  it('uses each disconnected component\'s own utilization for plant emissions', () => {
    const state = makeState();
    const firstCoal = tile(12, 24);
    const secondCoal = tile(35, 24);
    addFacility(state, { id: 'first-coal', kind: 'coal-power-plant', anchor: firstCoal, tiles: [firstCoal] });
    addFacility(state, { id: 'second-coal', kind: 'coal-power-plant', anchor: secondCoal, tiles: [secondCoal] });
    const power = blankPower({
      livePlantIds: ['first-coal', 'second-coal'],
      liveCapacity: 2_400,
      load: 900,
      allocatedLoad: 900,
      components: [
        {
          id: 'power:588',
          livePlantIds: ['first-coal'],
          capacity: 1_200,
          demand: 600,
          allocated: 600,
          remaining: 600,
          constrained: false,
          utilization: 0.5,
        },
        {
          id: 'power:611',
          livePlantIds: ['second-coal'],
          capacity: 1_200,
          demand: 300,
          allocated: 300,
          remaining: 900,
          constrained: false,
          utilization: 0.25,
        },
      ],
    });

    const pollution = derivePollution(state, power);

    expect(pollution[firstCoal]).toBeGreaterThan(0);
    expect(pollution[firstCoal]).toBeCloseTo(pollution[secondCoal]! * 2, 10);
  });

  it('moves fifteen percent toward the field from the previous pollution level', () => {
    const state = makeState();
    state.environment.pollution.fill(40);

    const pollution = derivePollution(state, blankPower());

    expect(pollution[tile(0, 0)]).toBeCloseTo(34, 12);
    expect(pollution[tile(24, 24)]).toBeCloseTo(34, 12);
  });
});

describe('deriveDensityCaps', () => {
  it('uses the persisted vertical level uniformly across all zone kinds', () => {
    const state = makeState();
    const residentialCenter = tile(12, 12);
    const industrialCenter = tile(35, 35);
    const commercialCenter = tile(24, 24);
    state.map.zones[residentialCenter] = 'R';
    state.map.zones[commercialCenter] = 'C';
    state.map.zones[industrialCenter] = 'I';
    state.environment.pollution[residentialCenter] = 100;
    state.market.verticalDevelopmentLevel = 7;

    const caps = deriveDensityCaps(state);

    expect(caps.heightCaps[residentialCenter]).toBe(7);
    expect(caps.densityCaps[residentialCenter]).toBeCloseTo(0.7, 12);
    expect(caps.heightCaps[commercialCenter]).toBe(7);
    expect(caps.heightCaps[industrialCenter]).toBe(7);
    expect(caps.heightCaps[tile(0, 0)]).toBe(0);
  });
});

describe('deriveDesirability', () => {
  it('applies exact sector weights, neighborhood averaging, and normalized wealth', () => {
    const state = makeState();
    const plantTile = tile(20, 20);
    const residential = tile(21, 20);
    const commercial = tile(22, 20);
    state.map.zones[residential] = 'R';
    state.map.zones[commercial] = 'C';
    state.map.roads[tile(20, 21)] = true;
    state.economy.density[commercial] = 0.8;
    state.economy.wealth[residential] = 37_242;
    state.economy.wealth[commercial] = 18_621;
    state.environment.pollution[commercial] = 20;
    state.environment.watered[residential] = true;
    state.environment.watered[commercial] = true;
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: plantTile, tiles: [plantTile] });

    const desirability = deriveDesirability(state);

    const residentialCellQuality = 0.4 * 1 + 0.1 * 0 + 0.25 * 1 + 0.25 * 0.5;
    const commercialCellQuality = 0.4 * 0.8 + 0.1 * 0.8 + 0.25 * 0.5 + 0.25 * 0.5;
    expect(desirability[residential]).toBeCloseTo(
      (residentialCellQuality + commercialCellQuality) / 85,
      12,
    );
  });

  it('subtracts one half independently for missing road and missing power', () => {
    const state = makeState();
    const zoned = tile(24, 24);
    state.map.zones[zoned] = 'R';
    state.environment.watered[zoned] = true;

    const desirability = deriveDesirability(state);
    const cellQuality = 0.4 + 0.25 * 0.5;

    expect(desirability[zoned]).toBeCloseTo(cellQuality / 85 - 1, 12);
  });

  it('subtracts one half independently when Water is missing', () => {
    const state = makeState();
    const zoned = tile(24, 24);
    state.map.zones[zoned] = 'R';
    const cellQuality = 0.4 + 0.25 * 0.5;

    expect(deriveDesirability(
      state,
      Array<boolean>(TILE_COUNT).fill(true),
      Array<boolean>(TILE_COUNT).fill(true),
    )[zoned]).toBeCloseTo(
      cellQuality / 85 - 0.5,
      12,
    );
  });

  it('keeps empty zoning conductive while excluding it from active neighborhood quality', () => {
    const state = makeState();
    const plant = tile(20, 20);
    const emptyBridge = tile(21, 20);
    const developed = tile(22, 20);
    addFacility(state, { id: 'wind', kind: 'wind-turbine', anchor: plant, tiles: [plant] });
    state.map.zones[emptyBridge] = 'R';
    state.map.zones[developed] = 'R';
    state.map.roads[tile(17, 20)] = true;
    state.map.roads[tile(25, 20)] = true;
    state.economy.density[developed] = 0.5;
    state.environment.watered[developed] = true;

    expect(derivePower(state).powered[developed]).toBe(true);
    expect(deriveRoadAccess(state)[emptyBridge]).toBe(false);
    expect(deriveActiveMarketDesirability(state)[developed]).toBeGreaterThan(0);
  });
});

describe('terrain isolation', () => {
  it('keeps every spatial and environmental result invariant under water and elevation changes', () => {
    const dry = makeState();
    const plantTile = tile(5, 5);
    const zoned = tile(6, 5);
    dry.map.zones[zoned] = 'R';
    dry.map.roads[tile(5, 6)] = true;
    dry.economy.density[zoned] = 0.7;
    dry.economy.wealth[zoned] = 12_000;
    dry.environment.pollution[zoned] = 17;
    addFacility(dry, { id: 'wind', kind: 'wind-turbine', anchor: plantTile, tiles: [plantTile] });
    const altered = structuredClone(dry);
    for (let i = 0; i < TILE_COUNT; i += 1) {
      altered.map.terrain.water[i] = i % 2 === 0;
      altered.map.terrain.elevation[i] = (i % 19) - 9;
    }

    const dryPower = derivePower(dry);
    const alteredPower = derivePower(altered);
    expect(deriveRoadAccess(altered)).toEqual(deriveRoadAccess(dry));
    expect(alteredPower).toEqual(dryPower);
    expect(deriveCongestion(altered)).toEqual(deriveCongestion(dry));
    expect(derivePollution(altered, alteredPower)).toEqual(derivePollution(dry, dryPower));
    expect(deriveDensityCaps(altered)).toEqual(deriveDensityCaps(dry));
    expect(deriveDesirability(altered)).toEqual(deriveDesirability(dry));
  });
});
