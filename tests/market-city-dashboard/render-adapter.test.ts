import { describe, expect, it } from 'vitest';

import {
  MARKET_TO_RENDERER_TERRAIN_MATERIAL,
  toSquareGridRendererState,
} from '../../src/market-city-dashboard/render-adapter';
import { deriveRenderLots } from '../../src/market-city/appearance';
import { applyWorldCommand } from '../../src/market-city/commands';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { buildOneCoalEquilibriumScenario } from '../../src/market-city/scenarios';
import { stepMonths } from '../../src/market-city/simulation';
import { deriveDensityCaps, deriveDesirability } from '../../src/market-city/spatial';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../../src/market-city/state';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2 } from '../../src/market-city/types';

const SIZE = MARKET_CITY_MAP_SIZE;
const TILE_COUNT = SIZE * SIZE;
const tile = (x: number, y: number) => y * SIZE + x;
const vertex = (x: number, y: number) => y * (SIZE + 1) + x;

function apply(state: MarketCityStateV2, command: Parameters<typeof applyWorldCommand>[1]): MarketCityStateV2 {
  const result = applyWorldCommand(state, command);
  if (!result.ok) throw new Error(result.reason);
  return result.state;
}

describe('MarketCity square-grid render adapter', () => {
  it('maps the 48x48 terrain contract and averages adjacent elevations into 49x49 vertices', () => {
    const source = createMarketCityState({
      cityId: 'terrain-adapter',
      seed: 77,
      createdAt: '2026-08-11T12:00:00.000Z',
    });
    source.map.terrain.material.splice(0, 4, 'grass', 'earth', 'sand', 'rock');
    source.map.terrain.water[2] = true;
    source.map.terrain.trees.splice(0, 4, 0, 1, 2, 3);
    source.map.terrain.elevation[tile(0, 0)] = 0;
    source.map.terrain.elevation[tile(1, 0)] = 2;
    source.map.terrain.elevation[tile(0, 1)] = 4;
    source.map.terrain.elevation[tile(1, 1)] = 6;
    const before = structuredClone(source);

    const view = toSquareGridRendererState(source);

    expect(view.width).toBe(48);
    expect(view.height).toBe(48);
    expect(view.terrain).toMatchObject({ baselineHeight: 2, waterSurfaceHeight: 1 });
    expect(view.terrain.surfaces.slice(0, 4)).toEqual(['land', 'land', 'water', 'land']);
    expect(view.terrain.materials.slice(0, 4)).toEqual(['grass-light', 'grass-dark', 'dry-ground', 'snow']);
    expect(MARKET_TO_RENDERER_TERRAIN_MATERIAL).toEqual({
      grass: 'grass-light',
      earth: 'grass-dark',
      sand: 'dry-ground',
      rock: 'snow',
    });
    expect(view.terrain.treeLevels.slice(0, 4)).toEqual([0, 1, 2, 3]);
    expect(view.terrain.vertexHeights).toHaveLength((SIZE + 1) * (SIZE + 1));
    expect(view.terrain.vertexHeights[vertex(0, 0)]).toBe(2);
    expect(view.terrain.vertexHeights[vertex(1, 0)]).toBe(3);
    expect(view.terrain.vertexHeights[vertex(0, 1)]).toBe(4);
    expect(view.terrain.vertexHeights[vertex(1, 1)]).toBe(5);
    expect(source).toEqual(before);
  });

  it('derives reciprocal north/east/south/west masks for road and power art', () => {
    let source = createMarketCityState();
    source = apply(source, { type: 'place-road', path: [tile(1, 1), tile(2, 1), tile(2, 2)] });
    source = apply(source, { type: 'place-power-line', tileIds: [tile(10, 0), tile(10, 1), tile(10, 2)] });

    const view = toSquareGridRendererState(source);

    expect(view.networks.road.filter(Boolean)).toHaveLength(3);
    expect(view.networkConnections.road[tile(1, 1)]).toBe(2);
    expect(view.networkConnections.road[tile(2, 1)]).toBe(12);
    expect(view.networkConnections.road[tile(2, 2)]).toBe(1);
    expect(view.ordinaryRoadConnectionMasks).toEqual(source.map.roadConnectionMasks);
    expect(view.networkConnections.power[tile(10, 0)]).toBe(4);
    expect(view.networkConnections.power[tile(10, 1)]).toBe(5);
    expect(view.networkConnections.power[tile(10, 2)]).toBe(1);
    expect(view.networks['power-line'].filter(Boolean)).toHaveLength(3);

    expect(view.networks.subway).toHaveLength(TILE_COUNT);
    expect(view.networks.subway.some(Boolean)).toBe(false);
    expect(view.networkConnections.subway).toHaveLength(TILE_COUNT);
    expect(view.networkConnections.subway.some(Boolean)).toBe(false);
  });

  it('projects canonical Water pipes, component service, allocation, and facility gates defensively', () => {
    let source = createMarketCityState();
    const tower = tile(10, 10);
    source = apply(source, { type: 'place-facility', kind: 'water-tower', anchor: tower });
    source = apply(source, { type: 'place-water-pipe', tileIds: [tile(9, 10), tile(9, 11), tile(9, 12)] });
    const before = structuredClone(source);

    const view = toSquareGridRendererState(source);
    const facility = view.facilities.find(({ kind }) => kind === 'water-tower');

    expect(view.networks['water-pipe']).toEqual(source.map.waterPipes);
    expect(view.networkConnections.water[tile(9, 10)]).toBe(4);
    expect(view.networkConnections.water[tile(9, 11)]).toBe(5);
    expect(view.networkConnections.water[tile(9, 12)]).toBe(1);
    expect(view.waterCoverage).toHaveLength(TILE_COUNT);
    expect(view.marketWaterComponentByTile).toEqual(source.services.water.componentByTile);
    expect(view.gameplay.watered).toEqual(source.environment.watered);
    expect(facility).toMatchObject({
      kind: 'water-tower',
      operational: false,
      roadAccess: false,
      powerAccess: false,
      pipeAccess: true,
      shoreline: true,
      componentId: null,
      waterComponentId: 'water:489',
      rawCapacity: 20_000,
      treatmentCapacity: 0,
    });

    view.networks['water-pipe'][tile(9, 10)] = false;
    view.networkConnections.water[tile(9, 11)] = 0;
    view.waterCoverage[tile(9, 10)] = null;
    view.marketWaterComponentByTile[tile(9, 10)] = null;
    view.gameplay.watered[tile(9, 10)] = true;
    expect(source).toEqual(before);
  });

  it('projects the landfill storage ledger into staged world data defensively', () => {
    const source = createMarketCityState();
    const empty = tile(8, 9);
    const full = tile(9, 9);
    source.map.landfillZones[empty] = true;
    source.map.landfillZones[full] = true;
    source.map.roads[tile(8, 8)] = true;
    source.services.waste = {
      generatedThisMonth: 10_000,
      generatedLifetime: 10_000,
      landfilledThisMonth: 10_000,
      landfilledLifetime: 10_000,
      unmanagedThisMonth: 0,
      unmanagedLifetime: 0,
      storedByTile: source.services.waste.storedByTile.map((_, tileId) => tileId === full ? 10_000 : 0),
    };
    const before = structuredClone(source);

    const view = toSquareGridRendererState(source);

    expect(view.landfillZones).toEqual(source.map.landfillZones);
    expect(view.waste).toEqual(source.services.waste);
    expect(view.landfills).toEqual([
      expect.objectContaining({ tileId: empty, roadConnected: true, componentTileCount: 2, componentCapacityTenths: 20_000, storedTenths: 0, capacityTenths: 10_000, fillBasisPoints: 0, stage: 'empty' }),
      expect.objectContaining({ tileId: full, roadConnected: true, componentTileCount: 2, componentCapacityTenths: 20_000, storedTenths: 10_000, capacityTenths: 10_000, fillBasisPoints: 10_000, stage: 'full' }),
    ]);

    view.landfillZones[empty] = false;
    view.landfills[1]!.storedTenths = 0;
    view.waste.storedByTile[full] = 0;
    expect(source).toEqual(before);
  });

  it('projects canonical Rail topology, station operation, and derived nonpersistent shuttle legs defensively', () => {
    const source = createMarketCityState();
    const railTiles = Array.from({ length: 12 }, (_, offset) => tile(4 + offset, 10));
    railTiles.forEach((tileId, index) => {
      source.map.rails[tileId] = true;
      source.map.railConnectionMasks[tileId] = index === 0 ? 2 : index === railTiles.length - 1 ? 8 : 10;
    });
    const stationATiles = [tile(3, 8), tile(4, 8), tile(3, 9), tile(4, 9)];
    const stationBTiles = [tile(14, 8), tile(15, 8), tile(14, 9), tile(15, 9)];
    source.map.facilities.push(
      { id: 'station-a', kind: 'train-station', anchor: stationATiles[0]!, tiles: stationATiles },
      { id: 'station-b', kind: 'train-station', anchor: stationBTiles[0]!, tiles: stationBTiles },
      { id: 'wind-a', kind: 'wind-turbine', anchor: tile(3, 6), tiles: [tile(3, 6)] },
      { id: 'wind-b', kind: 'wind-turbine', anchor: tile(14, 6), tiles: [tile(14, 6)] },
      {
        id: 'tower', kind: 'water-tower', anchor: tile(7, 6),
        tiles: [tile(7, 6), tile(8, 6), tile(7, 7), tile(8, 7)],
      },
    );
    source.map.roads[tile(3, 7)] = true;
    source.map.roads[tile(14, 7)] = true;
    source.map.roads[tile(7, 8)] = true;
    for (let x = 4; x <= 7; x += 1) source.map.powerLines[tile(x, 6)] = true;
    source.map.waterPipes[tile(7, 8)] = true;
    const before = structuredClone(source);

    const view = toSquareGridRendererState(source);

    expect(view.networks.rail).toEqual(source.map.rails);
    expect(view.networkConnections.rail).toEqual(source.map.railConnectionMasks);
    expect(view.railTopology.components).toHaveLength(1);
    expect(view.railTopology.stations).toEqual([
      expect.objectContaining({ stationId: 'station-a', roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true, operational: true }),
      expect.objectContaining({ stationId: 'station-b', roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true, operational: true }),
    ]);
    expect(view.railShuttleLegs).toEqual([
      expect.objectContaining({ stationAId: 'station-a', stationBId: 'station-b', pathTileIds: railTiles.slice(0, 11) }),
    ]);
    expect(view.facilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'station-a', operational: true, roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true, componentId: 'rail:484' }),
      expect.objectContaining({ id: 'station-b', operational: true, roadAccess: true, railAccess: true, powerAccess: true, waterAccess: true, componentId: 'rail:484' }),
    ]));

    view.networks.rail[railTiles[0]!] = false;
    view.networkConnections.rail[railTiles[1]!] = 0;
    view.railTopology.components[0]!.tileIds.length = 0;
    view.railShuttleLegs[0]!.pathTileIds.length = 0;
    expect(source).toEqual(before);
  });

  it('passes canonical avenue lanes and direction topology to the renderer defensively', () => {
    const source = createMarketCityState();
    const eastbound = tile(9, 8);
    const westbound = tile(9, 9);
    source.map.avenueLanes[eastbound] = true;
    source.map.avenueTravelMasks[eastbound] = 2;
    source.map.avenuePairMasks[eastbound] = 4;
    source.map.avenueLanes[westbound] = true;
    source.map.avenueTravelMasks[westbound] = 8;
    source.map.avenuePairMasks[westbound] = 1;
    source.map.roads[tile(8, 8)] = true;

    const view = toSquareGridRendererState(source);

    expect(view.networks.avenue[eastbound]).toBe(true);
    expect(view.networks.avenue[westbound]).toBe(true);
    expect(view.avenueTravelMasks[eastbound]).toBe(2);
    expect(view.avenueTravelMasks[westbound]).toBe(8);
    expect(view.avenuePairMasks[eastbound]).toBe(4);
    expect(view.avenuePairMasks[westbound]).toBe(1);
    // Avenue adjacency does not invent an ordinary-road link.
    expect(view.networkConnections.road[tile(8, 8)]).toBe(0);
    expect(view.networkConnections.road[eastbound]).toBe(0);
    expect(view.ordinaryRoadConnectionMasks[tile(8, 8)]).toBe(0);

    source.map.roads[eastbound] = true;
    source.map.roads[tile(9, 7)] = true;
    source.map.roads[tile(9, 9)] = true;
    source.map.roadConnectionMasks[eastbound] = 5;
    source.map.roadConnectionMasks[tile(9, 7)] = 4;
    source.map.roadConnectionMasks[tile(9, 9)] = 1;
    const crossing = toSquareGridRendererState(source);
    expect(crossing.networks.road[eastbound]).toBe(true);
    expect(crossing.networks.avenue[eastbound]).toBe(true);
    expect((crossing.ordinaryRoadConnectionMasks[eastbound] ?? 0) & 5).toBe(5);

    view.networks.avenue[eastbound] = false;
    view.avenueTravelMasks[eastbound] = 0;
    view.avenuePairMasks[eastbound] = 0;
    expect(source.map.avenueLanes[eastbound]).toBe(true);
    expect(source.map.avenueTravelMasks[eastbound]).toBe(2);
    expect(source.map.avenuePairMasks[eastbound]).toBe(4);
  });

  it('adapts zones, facilities, gameplay units, and frozen market appearance', () => {
    let source = createMarketCityState({
      cityId: 'market-view',
      cityName: 'Market View',
      mayorName: 'Mayor View',
      seed: 15,
      createdAt: '2026-08-11T12:00:00.000Z',
    });
    const residential = tile(4, 4);
    source = apply(source, { type: 'zone', tileIds: [residential], zone: 'R' });
    source = apply(source, { type: 'place-facility', kind: 'coal-power-plant', anchor: tile(8, 4) });
    source = apply(source, { type: 'place-facility', kind: 'wind-turbine', anchor: tile(5, 3) });
    source = apply(source, { type: 'place-power-line', tileIds: [tile(5, 4), tile(6, 4), tile(7, 4)] });
    source = apply(source, { type: 'place-road', tileIds: [tile(4, 5), tile(8, 7)] });
    source.economy.density[residential] = 0.42;
    source.economy.wealth[residential] = MARKET_CITY_RULES.maximumIncome / 2;
    source.environment.pollution[residential] = 12.5;
    source.environment.congestion[residential] = 0.25;
    source.environment.roadAccess[residential] = true;
    source.environment.powered[residential] = true;
    const before = structuredClone(source);

    const view = toSquareGridRendererState(source);
    const directCaps = deriveDensityCaps(source);
    const directDesirability = deriveDesirability(source);
    const directLots = deriveRenderLots(source, directCaps.densityCaps);

    expect(view.cityId).toBe('market-view');
    expect(view.zones[residential]).toEqual({ kind: 'residential' });
    expect(view.facilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: 'coal-power-plant',
        anchor: { x: 8, y: 4 },
        footprint: source.map.facilities[0]!.tiles,
        operational: false,
        inactiveReason: 'No allocated water service.',
      }),
    ]));

    expect(view.gameplay.density[residential]).toBe(4_200);
    expect(view.gameplay.wealth[residential]).toBe(5_000);
    expect(view.gameplay.pollution[residential]).toBe(1_250);
    expect(view.gameplay.congestion[residential]).toBe(2_500);
    expect(view.gameplay.roadAccess[residential]).toBe(true);
    expect(view.gameplay.powered[residential]).toBe(true);
    expect(view.marketDensityCaps).toEqual(directCaps.densityCaps);
    expect(view.marketHeightCaps).toEqual(directCaps.heightCaps);
    expect(view.marketDesirability).toEqual(directDesirability);
    expect(view.marketRenderLots).toEqual(directLots);
    expect(view.marketRenderLots.some((lot) => lot.tileIds.includes(residential))).toBe(true);
    expect(source).toEqual(before);
  });

  it('derives Fire Station operation from shared-road access and power, ignoring water', () => {
    let source = createMarketCityState();
    const station = tile(20, 20);
    source = apply(source, { type: 'place-facility', kind: 'fire-station', anchor: station });
    source.environment.roadAccess[station] = true;
    source.environment.powered[station] = true;
    source.environment.watered[station] = true;

    expect(toSquareGridRendererState(source).facilities[0]).toMatchObject({
      kind: 'fire-station',
      operational: false,
      inactiveReason: 'No road access within 3 tiles.',
    });

    source.environment.roadAccess[station] = false;
    source.environment.powered[station] = false;
    source.environment.watered[station] = false;
    source.map.roads[tile(23, 20)] = true;

    // A road alone leaves it dark.
    expect(toSquareGridRendererState(source).facilities[0]).toMatchObject({
      kind: 'fire-station',
      operational: false,
      inactiveReason: 'No power.',
    });

    // Power is derived from the map, so the station needs a live plant beside it.
    // Wind is intentionally utility-independent; thermal plants need Water.
    source = apply(source, { type: 'place-facility', kind: 'wind-turbine', anchor: tile(21, 20) });

    expect(toSquareGridRendererState(source).facilities.find(({ kind }) => kind === 'fire-station')).toMatchObject({
      kind: 'fire-station',
      operational: true,
      inactiveReason: null,
    });

    source.map.roads[tile(23, 20)] = false;
    source.map.avenueLanes[tile(23, 20)] = true;

    expect(toSquareGridRendererState(source).facilities.find(({ kind }) => kind === 'fire-station')).toMatchObject({
      kind: 'fire-station',
      operational: true,
      inactiveReason: null,
    });
  });

  it('returns wholly defensive renderer arrays and appearance objects', () => {
    let source = createMarketCityState();
    const residential = tile(5, 5);
    source = apply(source, { type: 'zone', tileIds: [residential], zone: 'R' });
    source.economy.density[residential] = 0.2;
    const before = structuredClone(source);
    const view = toSquareGridRendererState(source);

    view.terrain.treeLevels[0] = 99;
    view.networks.road[0] = true;
    view.gameplay.density[residential] = 0;
    view.marketDensityCaps[residential] = 0;
    view.marketRenderLots[0]!.tileIds[0] = 0;

    expect(source).toEqual(before);
    expect(source.map.terrain.trees[0]).toBe(0);
    expect(source.map.roads[0]).toBe(false);
    expect(source.economy.density[residential]).toBe(0.2);
  });

  it('uses the same building units before rendering, fire stepping, and save reload', () => {
    const live = stepMonths(buildOneCoalEquilibriumScenario().state, 19);
    const restored = restoreMarketCityState(serializeMarketCityState(live));
    const caps = deriveDensityCaps(restored);
    const desirability = deriveDesirability(restored);
    const expectedLots = deriveRenderLots(restored, caps.densityCaps);

    expect(toSquareGridRendererState(restored).marketRenderLots).toEqual(expectedLots);
    expect(hashDeterministicState(stepMonths(restored, 1))).toBe(hashDeterministicState(stepMonths(live, 1)));
  });

  it('rebuilds the skyline from the same canonical authority after a zoning permission changes', () => {
    const mature = stepMonths(buildOneCoalEquilibriumScenario().state, 60);
    const inaccessibleEmptyCommercial = tile(7, 0);
    const withEmptyPermission = apply(mature, {
      type: 'zone',
      tileIds: [inaccessibleEmptyCommercial],
      zone: 'C',
    });

    expect(withEmptyPermission.environment.roadAccess[inaccessibleEmptyCommercial]).toBe(false);
    expect(withEmptyPermission.economy.density[inaccessibleEmptyCommercial]).toBe(0);
    for (const paused of [true, false]) {
      const modeState = structuredClone(withEmptyPermission);
      modeState.clock.paused = paused;
      modeState.clock.speed = paused ? 0 : 1;
      const afterState = apply(modeState, {
        type: 'dezone',
        tileIds: [inaccessibleEmptyCommercial],
      });
      const after = toSquareGridRendererState(afterState).marketRenderLots;
      const caps = deriveDensityCaps(afterState);
      const expected = deriveRenderLots(afterState, caps.densityCaps);

      expect(afterState.economy).toEqual(modeState.economy);
      expect(after).toEqual(expected);
    }
  }, 30_000);
});
