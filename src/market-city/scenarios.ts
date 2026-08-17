import { applyWorldCommand } from './commands';
import { coordinateToIndex, orthogonalNeighbors } from './math';
import { deriveDensityCaps, derivePower, hasFacilityRoadAccess } from './spatial';
import { stepMonth } from './simulation';
import { deriveWaterService } from './water';
import {
  createMarketCityState,
  hashDeterministicState,
  type MarketCityTerrainFixture,
} from './state';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketCityStateV2,
  type MarketCityWorldCommand,
  type MarketPowerPlantKind,
  type MarketSectorValues,
  type MarketTerrainMaterial,
  type MarketZoneKind,
} from './types';

export const MARKET_MAP_FIXTURE_IDS = [
  'flat-48',
  'coast-ridge-48',
  'river-blocks-48',
  'dense-core-48',
  'firebreak-48',
  'mixed-energy-48',
] as const;

export type MarketMapFixtureId = (typeof MARKET_MAP_FIXTURE_IDS)[number];

export const MARKET_SCENARIO_CHECKPOINTS = [0, 1, 3, 12, 120, 300, 900, 1_200] as const;

export interface MarketScenarioCommandRecord {
  label: string;
  command: MarketCityWorldCommand;
  changedTileIds: number[];
}

export interface MarketScenarioBuild {
  id: string;
  mapFixture: MarketMapFixtureId;
  state: MarketCityStateV2;
  commands: MarketScenarioCommandRecord[];
}

export interface MarketScenarioCheckpoint {
  month: number;
  hash: string;
  stocks: MarketSectorValues;
  population: number;
  treasury: number;
  collapsedTotal: number;
}

export interface MarketScenarioSummary {
  month: number;
  hash: string;
  stocks: MarketSectorValues;
  population: number;
  treasury: number;
  revenue: number;
  operatingExpense: number;
  net: number;
  occupiedLots: number;
  burningLots: number;
  collapsedTotal: number;
  maximumPollution: number;
}

interface ScenarioContext extends MarketScenarioBuild {}

const TILE_COUNT = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;

export function scenarioTile(x: number, y: number): number {
  return coordinateToIndex(x, y, MARKET_CITY_MAP_SIZE);
}

function tileArrays(): {
  water: boolean[];
  elevation: number[];
  material: MarketTerrainMaterial[];
  trees: number[];
} {
  return {
    water: Array<boolean>(TILE_COUNT).fill(false),
    elevation: Array<number>(TILE_COUNT).fill(0),
    material: Array<MarketTerrainMaterial>(TILE_COUNT).fill('grass'),
    trees: Array<number>(TILE_COUNT).fill(0),
  };
}

function terrainFixture(id: MarketMapFixtureId): MarketCityTerrainFixture {
  const terrain = tileArrays();

  for (let y = 0; y < MARKET_CITY_MAP_SIZE; y += 1) {
    for (let x = 0; x < MARKET_CITY_MAP_SIZE; x += 1) {
      const tile = scenarioTile(x, y);
      if (id === 'coast-ridge-48') {
        const coast = 4 + Math.round(1.5 * Math.sin(y / 5));
        terrain.water[tile] = x <= coast;
        terrain.material[tile] = x <= coast + 2 ? 'sand' : x >= 27 ? 'rock' : 'grass';
        terrain.elevation[tile] = x <= coast ? -1 : Math.max(0, Math.round(9 - Math.abs(x - 32) * 0.55));
        terrain.trees[tile] = x > coast + 3 && x < 25 && (x * 17 + y * 31) % 9 === 0 ? 2 : 0;
      } else if (id === 'river-blocks-48') {
        const riverCenter = 23 + Math.round(3 * Math.sin(y / 6));
        const bridgeRow = y === 11 || y === 24 || y === 37;
        terrain.water[tile] = !bridgeRow && Math.abs(x - riverCenter) <= 1;
        terrain.material[tile] = terrain.water[tile] ? 'sand' : Math.abs(x - riverCenter) <= 3 ? 'earth' : 'grass';
        terrain.elevation[tile] = terrain.water[tile] ? -1 : Math.min(4, Math.floor(Math.abs(x - riverCenter) / 8));
        terrain.trees[tile] = !terrain.water[tile] && Math.abs(x - riverCenter) >= 4 && (x + y * 5) % 11 === 0 ? 1 : 0;
      } else if (id === 'dense-core-48') {
        const distance = Math.max(Math.abs(x - 24), Math.abs(y - 24));
        terrain.material[tile] = distance <= 9 ? 'earth' : distance >= 20 ? 'rock' : 'grass';
        terrain.elevation[tile] = Math.max(0, 4 - Math.floor(distance / 6));
      } else if (id === 'firebreak-48') {
        const firebreak = x === 16 || x === 32 || y === 16 || y === 32;
        terrain.material[tile] = firebreak ? 'earth' : 'grass';
        terrain.trees[tile] = firebreak ? 0 : (x * 7 + y * 13) % 17 === 0 ? 1 : 0;
      } else if (id === 'mixed-energy-48') {
        terrain.material[tile] = x < 12 ? 'rock' : x > 36 ? 'sand' : 'grass';
        terrain.elevation[tile] = x < 12 ? 3 : x > 36 ? 1 : 0;
        terrain.trees[tile] = x >= 12 && x <= 36 && (x * 3 + y * 5) % 19 === 0 ? 1 : 0;
      }
    }
  }

  return terrain;
}

/** Construct a deterministic blank world for a named real-map fixture. */
export function createMarketMapFixture(id: MarketMapFixtureId, seed = 1): MarketCityStateV2 {
  return createMarketCityState({
    cityId: `scenario:${id}:${seed}`,
    cityName: id,
    mayorName: 'Scenario Harness',
    seed,
    createdAt: '2026-08-11T00:00:00.000Z',
  }, terrainFixture(id));
}

function context(id: string, mapFixture: MarketMapFixtureId, seed: number): ScenarioContext {
  const state = createMarketMapFixture(mapFixture, seed);
  state.clock.paused = false;
  return { id, mapFixture, state, commands: [] };
}

function execute(
  scenario: ScenarioContext,
  label: string,
  command: MarketCityWorldCommand,
): void {
  const result = applyWorldCommand(scenario.state, command);
  if (!result.ok) throw new Error(`${scenario.id}: ${label} failed: ${result.reason ?? 'unknown reason'}`);
  scenario.state = result.state;
  scenario.commands.push({ label, command, changedTileIds: result.changedTileIds });
}

function horizontalTiles(y: number, fromX: number, toX: number): number[] {
  const result: number[] = [];
  for (let x = fromX; x <= toX; x += 1) result.push(scenarioTile(x, y));
  return result;
}

function verticalTiles(x: number, fromY: number, toY: number): number[] {
  const result: number[] = [];
  for (let y = fromY; y <= toY; y += 1) result.push(scenarioTile(x, y));
  return result;
}

function rectangleTiles(fromX: number, fromY: number, toX: number, toY: number): number[] {
  const result: number[] = [];
  for (let y = fromY; y <= toY; y += 1) {
    for (let x = fromX; x <= toX; x += 1) result.push(scenarioTile(x, y));
  }
  return result;
}

function withoutTiles(tiles: readonly number[], omitted: ReadonlySet<number>): number[] {
  return tiles.filter((tile) => !omitted.has(tile));
}

function isCoveredByPipe(
  tile: number,
  pipes: ReadonlySet<number>,
): boolean {
  const x = tile % MARKET_CITY_MAP_SIZE;
  const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
  for (const pipe of pipes) {
    const distance = Math.abs(pipe % MARKET_CITY_MAP_SIZE - x)
      + Math.abs(Math.floor(pipe / MARKET_CITY_MAP_SIZE) - y);
    if (distance <= 7) return true;
  }
  return false;
}

function connectDryPipe(
  state: MarketCityStateV2,
  pipes: Set<number>,
  target: number,
): void {
  const predecessor = Array<number>(TILE_COUNT).fill(-2);
  const queue = [...pipes].sort((left, right) => left - right);
  for (const tile of queue) predecessor[tile] = -1;

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const current = queue[cursor]!;
    if (current === target) break;
    for (const neighbor of orthogonalNeighbors(current, MARKET_CITY_MAP_SIZE)) {
      if (predecessor[neighbor] !== -2 || state.map.terrain.water[neighbor]) continue;
      predecessor[neighbor] = current;
      queue.push(neighbor);
    }
  }
  if (predecessor[target] === -2) {
    throw new Error(`Water scenario fixture could not connect dry tile ${target}.`);
  }
  for (let tile = target; tile !== -1; tile = predecessor[tile]!) pipes.add(tile);
}

/** Add canonical, zero-cost Water scaffolding to scenarios whose subject is not Water. */
function provisionScenarioWater(scenario: ScenarioContext): void {
  const plant = scenario.state.map.facilities.find(({ kind }) => (
    kind === 'coal-power-plant'
      || kind === 'gas-power-plant'
      || kind === 'nuclear-power-plant'
      || kind === 'wind-turbine'
      || kind === 'solar-plant'
  ));
  if (plant === undefined) return;
  // Thermal scenarios now need a powered water source before they can start.
  // Seed that source with a zero-road, zero-water Wind Turbine without
  // changing the scenario's player command sequence or road/line accounting.
  if (derivePower(scenario.state).liveCapacity === 0) {
    const conductive = new Set<number>([
      ...scenario.state.map.powerLines.flatMap((line, tile) => line ? [tile] : []),
      ...scenario.state.map.facilities.flatMap(({ tiles }) => tiles),
    ]);
    let placed = false;
    for (let tile = 0; tile < TILE_COUNT && !placed; tile += 1) {
      if (scenario.state.map.terrain.water[tile]
        || scenario.state.map.zones[tile] !== null
        || scenario.state.map.roads[tile]
        || scenario.state.map.avenueLanes[tile]
        || scenario.state.map.rails[tile]
        || scenario.state.map.powerLines[tile]
        || scenario.state.map.landfillZones[tile]
        || scenario.state.map.facilities.some(({ tiles }) => tiles.includes(tile))) continue;
      if (!orthogonalNeighbors(tile, MARKET_CITY_MAP_SIZE).some((neighbor) => conductive.has(neighbor))) continue;
      scenario.state.map.facilities.push({
        id: 'scenario-water-bootstrap', kind: 'wind-turbine', anchor: tile, tiles: [tile],
      });
      placed = true;
    }
    if (!placed) throw new Error(`${scenario.id}: could not place renewable Water bootstrap.`);
  }
  const occupied = new Set(scenario.state.map.facilities.flatMap(({ tiles }) => tiles));
  const candidates: number[] = [];
  for (let y = 0; y + 1 < MARKET_CITY_MAP_SIZE; y += 1) {
    for (let x = 0; x + 1 < MARKET_CITY_MAP_SIZE; x += 1) candidates.push(scenarioTile(x, y));
  }
  candidates.sort((left, right) => {
    const distance = (value: number): number => (
      Math.abs(value % MARKET_CITY_MAP_SIZE - plant.anchor % MARKET_CITY_MAP_SIZE)
      + Math.abs(Math.floor(value / MARKET_CITY_MAP_SIZE) - Math.floor(plant.anchor / MARKET_CITY_MAP_SIZE))
    );
    return distance(left) - distance(right) || left - right;
  });

  let tower = scenario.state.map.facilities.find(({ id }) => id === 'scenario-water-tower');
  if (tower === undefined) for (const anchor of candidates) {
    const x = anchor % MARKET_CITY_MAP_SIZE;
    const y = Math.floor(anchor / MARKET_CITY_MAP_SIZE);
    const tiles = [anchor, scenarioTile(x + 1, y), scenarioTile(x, y + 1), scenarioTile(x + 1, y + 1)];
    if (tiles.some((tile) => (
      scenario.state.map.terrain.water[tile]
      || occupied.has(tile)
      || scenario.state.map.zones[tile] !== null
      || scenario.state.map.roads[tile]
      || scenario.state.map.avenueLanes[tile]
      || scenario.state.map.rails[tile]
      || scenario.state.map.powerLines[tile]
      || scenario.state.map.landfillZones[tile]
    ))) continue;
    const candidate = { id: 'scenario-water-tower', kind: 'water-tower' as const, anchor, tiles };
    scenario.state.map.facilities.push(candidate);
    const power = derivePower(scenario.state);
    const livePower = candidate.tiles.some((tile) => {
      const componentId = power.componentByTile[tile];
      return componentId !== null
        && power.components.some((component) => component.id === componentId && component.capacity > 0);
    });
    if (livePower && hasFacilityRoadAccess(scenario.state, candidate)) {
      tower = candidate;
      break;
    }
    scenario.state.map.facilities.pop();
  }
  if (tower === undefined) throw new Error(`${scenario.id}: could not place deterministic Water fixture.`);

  const pipes = new Set<number>();
  scenario.state.map.waterPipes.forEach((pipe, tile) => { if (pipe) pipes.add(tile); });
  for (const tile of tower.tiles) pipes.add(tile);
  for (;;) {
    let uncovered = -1;
    for (let tile = 0; tile < TILE_COUNT; tile += 1) {
      if (scenario.state.map.zones[tile] !== null && !isCoveredByPipe(tile, pipes)) {
        uncovered = tile;
        break;
      }
    }
    if (uncovered < 0) break;
    connectDryPipe(scenario.state, pipes, uncovered);
  }
  for (const tile of pipes) scenario.state.map.waterPipes[tile] = true;
  const water = deriveWaterService(scenario.state);
  scenario.state.environment.watered = water.watered;
  scenario.state.services.water = water.service;
}

/**
 * Isolate non-waste scenario probes from the citywide unmanaged-waste
 * pollution term without adding a route or capacity effect. The landfill is
 * deliberately road-served because collection now requires direct contact.
 */
function provisionScenarioWaste(scenario: ScenarioContext): void {
  for (let tile = TILE_COUNT - 1; tile >= 0; tile -= 1) {
    if (scenario.state.map.terrain.water[tile]
      || scenario.state.map.zones[tile] !== null
      || scenario.state.map.roads[tile]
      || scenario.state.map.avenueLanes[tile]
      || scenario.state.map.rails[tile]
      || scenario.state.map.powerLines[tile]
      || scenario.state.map.landfillZones[tile]
      || scenario.state.map.facilities.some((facility) => facility.tiles.includes(tile))) continue;
    const road = orthogonalNeighbors(tile, MARKET_CITY_MAP_SIZE).find((neighbor) => (
      !scenario.state.map.terrain.water[neighbor]
      && scenario.state.map.zones[neighbor] === null
      && !scenario.state.map.roads[neighbor]
      && !scenario.state.map.avenueLanes[neighbor]
      && !scenario.state.map.rails[neighbor]
      && !scenario.state.map.powerLines[neighbor]
      && !scenario.state.map.landfillZones[neighbor]
      && !scenario.state.map.facilities.some((facility) => facility.tiles.includes(neighbor))
    ));
    if (road === undefined) continue;
    execute(scenario, 'place comparison landfill', { type: 'zone-landfill', tileIds: [tile] });
    execute(scenario, 'place comparison landfill access road', { type: 'place-road', tileIds: [road] });
    return;
  }
  throw new Error(`${scenario.id}: could not place deterministic waste fixture.`);
}

function placeBootstrapInfrastructure(scenario: ScenarioContext): void {
  execute(scenario, 'place coal plant', {
    type: 'place-facility',
    kind: 'coal-power-plant',
    anchor: scenarioTile(2, 2),
  });
  execute(scenario, 'place access road north', {
    type: 'place-road',
    tileIds: horizontalTiles(5, 0, 22),
  });
  execute(scenario, 'place access road south', {
    type: 'place-road',
    tileIds: horizontalTiles(11, 0, 22),
  });
  execute(scenario, 'place conductive feeder', {
    type: 'place-power-line',
    tileIds: horizontalTiles(4, 4, 20),
  });
}

function bootstrapZoneTiles(sector: MarketZoneKind): number[] {
  switch (sector) {
    case 'R': return rectangleTiles(2, 6, 8, 10);
    case 'C': return rectangleTiles(9, 6, 14, 10);
    case 'I': return rectangleTiles(15, 6, 20, 10);
  }
}

function zoneBootstrapSectors(scenario: ScenarioContext, sectors: readonly MarketZoneKind[]): void {
  for (const sector of sectors) {
    execute(scenario, `zone ${sector}`, { type: 'zone', zone: sector, tileIds: bootstrapZoneTiles(sector) });
  }
}

export function buildNoBootstrapScenario(): MarketScenarioBuild {
  const scenario = context('no-bootstrap', 'flat-48', 10_001);
  execute(scenario, 'place north road', { type: 'place-road', tileIds: horizontalTiles(5, 0, 22) });
  execute(scenario, 'place south road', { type: 'place-road', tileIds: horizontalTiles(11, 0, 22) });
  zoneBootstrapSectors(scenario, ['R', 'C', 'I']);
  return scenario;
}

export function buildResidentialBootstrapScenario(): MarketScenarioBuild {
  const scenario = context('residential-bootstrap', 'flat-48', 10_002);
  placeBootstrapInfrastructure(scenario);
  zoneBootstrapSectors(scenario, ['R', 'C', 'I']);
  provisionScenarioWater(scenario);
  return scenario;
}

export function buildCiFirstScenario(sector: 'C' | 'I'): {
  beforeResidential: MarketCityStateV2;
  afterResidential: MarketCityStateV2;
  commands: MarketScenarioCommandRecord[];
} {
  const scenario = context(`${sector.toLowerCase()}-first`, 'flat-48', sector === 'C' ? 10_003 : 10_004);
  placeBootstrapInfrastructure(scenario);
  zoneBootstrapSectors(scenario, [sector]);
  provisionScenarioWater(scenario);
  const beforeResidential = scenario.state;
  scenario.state = stepFor(beforeResidential, 12);
  zoneBootstrapSectors(scenario, ['R']);
  provisionScenarioWater(scenario);
  return { beforeResidential, afterResidential: scenario.state, commands: scenario.commands };
}

function buildAmpleGrid(scenario: ScenarioContext): void {
  execute(scenario, 'place coal plant', {
    type: 'place-facility',
    kind: 'coal-power-plant',
    anchor: scenarioTile(1, 1),
  });
  for (const y of [4, 11, 18]) {
    execute(scenario, `place horizontal road y${y}`, {
      type: 'place-road',
      tileIds: horizontalTiles(y, 0, 35),
    });
  }
  for (const x of [12, 23]) {
    const tiles = verticalTiles(x, 5, 17).filter((tile) => !scenario.state.map.roads[tile]);
    execute(scenario, `place vertical road x${x}`, { type: 'place-road', tileIds: tiles });
  }
  execute(scenario, 'place skyline feeder', {
    type: 'place-power-line',
    tileIds: horizontalTiles(3, 3, 33),
  });

  const stationTiles = new Set<number>();
  for (const y of [8, 15]) {
    for (const x of [7, 18, 29]) stationTiles.add(scenarioTile(x, y));
  }
  const zoneRows = [...Array(13).keys()].map((offset) => offset + 5)
    .filter((y) => !scenario.state.map.roads[scenarioTile(1, y)]);
  const sectors: ReadonlyArray<readonly [MarketZoneKind, number, number]> = [
    ['R', 2, 11],
    ['C', 13, 22],
    ['I', 24, 33],
  ];
  for (const [sector, fromX, toX] of sectors) {
    const tiles = zoneRows.flatMap((y) => horizontalTiles(y, fromX, toX));
    execute(scenario, `zone ample ${sector}`, {
      type: 'zone',
      zone: sector,
      tileIds: withoutTiles(tiles, stationTiles),
    });
  }
  for (const anchor of stationTiles) {
    execute(scenario, `place fire station ${anchor}`, {
      type: 'place-facility',
      kind: 'fire-station',
      anchor,
    });
  }
  provisionScenarioWater(scenario);
}

export function buildOneCoalEquilibriumScenario(): MarketScenarioBuild {
  const scenario = context('one-coal-equilibrium', 'dense-core-48', 10_005);
  scenario.state.clock.fireDifficulty = 'easy';
  // This scenario is an analytic high-capacity market fixture, not a founding
  // city: keep its historical R=C=I=40 target available under the Level-1
  // gameplay default.
  scenario.state.market.verticalDevelopmentLevel = 10;
  buildAmpleGrid(scenario);
  return scenario;
}

export function buildLandShortageScenario(): MarketScenarioBuild {
  const scenario = context('land-shortage', 'flat-48', 10_006);
  placeBootstrapInfrastructure(scenario);
  execute(scenario, 'zone one R lot', { type: 'zone', zone: 'R', tileIds: [scenarioTile(6, 6)] });
  execute(scenario, 'zone one C lot', { type: 'zone', zone: 'C', tileIds: [scenarioTile(9, 6)] });
  execute(scenario, 'zone one I lot', { type: 'zone', zone: 'I', tileIds: [scenarioTile(15, 6)] });
  provisionScenarioWater(scenario);
  return scenario;
}

export function releaseSlurpCapacity(state: MarketCityStateV2): {
  state: MarketCityStateV2;
  releasedTileIds: number[];
} {
  const candidates = rectangleTiles(2, 6, 8, 10)
    .filter((tile) => state.map.zones[tile] === null);
  const result = applyWorldCommand(state, { type: 'zone', zone: 'R', tileIds: candidates });
  if (!result.ok) throw new Error(`cap release failed: ${result.reason ?? 'unknown reason'}`);
  return { state: result.state, releasedTileIds: result.changedTileIds };
}

export function buildPollutionRelocationScenario(): MarketScenarioBuild & {
  dirtyResidential: number[];
  cleanResidential: number[];
} {
  const scenario = context('pollution-relocation', 'dense-core-48', 10_007);
  execute(scenario, 'place dirty coal plant', {
    type: 'place-facility', kind: 'coal-power-plant', anchor: scenarioTile(2, 18),
  });
  for (const y of [17, 23, 25, 31]) {
    execute(scenario, `place road y${y}`, { type: 'place-road', tileIds: horizontalTiles(y, 0, 42) });
  }
  execute(scenario, 'place northern power spine', {
    type: 'place-power-line', tileIds: horizontalTiles(16, 2, 39),
  });
  execute(scenario, 'place central industrial feeder north', {
    type: 'place-power-line', tileIds: verticalTiles(20, 18, 22),
  });
  execute(scenario, 'place central industrial feeder south', {
    type: 'place-power-line', tileIds: [scenarioTile(20, 24)],
  });

  const dirtyResidential = rectangleTiles(7, 18, 11, 22);
  const cleanResidential = rectangleTiles(35, 18, 39, 22);
  execute(scenario, 'zone dirty residential district', {
    type: 'zone', zone: 'R', tileIds: dirtyResidential,
  });
  execute(scenario, 'zone clean residential district', {
    type: 'zone', zone: 'R', tileIds: cleanResidential,
  });
  // Keep the load that drives coal emissions outside both residential
  // desirability radii. The residential districts then differ by pollution,
  // not by developed versus inaccessible empty industrial neighbors.
  execute(scenario, 'zone central industrial emissions district', {
    type: 'zone', zone: 'I', tileIds: rectangleTiles(20, 26, 24, 30),
  });
  execute(scenario, 'place dirty-side station', {
    type: 'place-facility', kind: 'fire-station', anchor: scenarioTile(6, 22),
  });
  execute(scenario, 'place clean-side station', {
    type: 'place-facility', kind: 'fire-station', anchor: scenarioTile(34, 22),
  });
  provisionScenarioWater(scenario);
  return { ...scenario, dirtyResidential, cleanResidential };
}

function plantFootprint(kind: MarketPowerPlantKind): readonly [number, number] {
  switch (kind) {
    case 'coal-power-plant':
    case 'gas-power-plant': return [2, 3];
    case 'nuclear-power-plant': return [3, 3];
    case 'wind-turbine': return [1, 1];
    case 'solar-plant': return [4, 2];
  }
}

export function buildPlantComparisonScenario(kind: MarketPowerPlantKind): MarketScenarioBuild & {
  roadTileCount: number;
  powerLineTileCount: number;
} {
  const scenario = context(`plant-comparison:${kind}`, 'mixed-energy-48', 20_000 + kind.length);
  execute(scenario, `place ${kind}`, { type: 'place-facility', kind, anchor: scenarioTile(2, 2) });
  const roads = horizontalTiles(5, 0, 14);
  execute(scenario, 'place plant access road', { type: 'place-road', tileIds: roads });
  const [width] = plantFootprint(kind);
  const lines = [
    ...horizontalTiles(2, 2 + width, 10),
    scenarioTile(10, 3),
    scenarioTile(10, 4),
  ];
  execute(scenario, 'place comparison feeder', { type: 'place-power-line', tileIds: lines });
  const zones = rectangleTiles(8, 6, 12, 8);
  execute(scenario, 'zone comparison load', { type: 'zone', zone: 'R', tileIds: zones });

  // This probe begins with an existing load so the very first environmental
  // transition exposes the per-plant pollution multiplier.
  for (const tile of zones) {
    scenario.state.economy.density[tile] = 0.1;
    scenario.state.economy.wealth[tile] = 18_000;
  }
  provisionScenarioWater(scenario);
  provisionScenarioWaste(scenario);
  return {
    ...scenario,
    roadTileCount: scenario.state.map.roads.filter(Boolean).length,
    powerLineTileCount: scenario.state.map.powerLines.filter(Boolean).length,
  };
}

export function buildPowerSeveranceScenario(): MarketScenarioBuild & {
  severTile: number;
  representativeZoneTile: number;
} {
  const scenario = context('power-severance', 'river-blocks-48', 10_008);
  execute(scenario, 'place coal plant', {
    type: 'place-facility', kind: 'coal-power-plant', anchor: scenarioTile(2, 2),
  });
  execute(scenario, 'place access road', {
    type: 'place-road', tileIds: horizontalTiles(5, 0, 15),
  });
  execute(scenario, 'place single feeder', {
    type: 'place-power-line', tileIds: horizontalTiles(4, 4, 10),
  });
  const zoneTiles = rectangleTiles(10, 6, 13, 8);
  execute(scenario, 'zone feeder-dependent residential', {
    type: 'zone', zone: 'R', tileIds: zoneTiles,
  });
  provisionScenarioWater(scenario);
  return {
    ...scenario,
    severTile: scenarioTile(7, 4),
    representativeZoneTile: scenarioTile(10, 6),
  };
}

export function severScenarioPower(state: MarketCityStateV2, severTile: number): MarketCityStateV2 {
  const result = applyWorldCommand(state, { type: 'demolish', tileIds: [severTile] });
  if (!result.ok) throw new Error(`power severance failed: ${result.reason ?? 'unknown reason'}`);
  return result.state;
}

export function repairPowerSeverance(state: MarketCityStateV2, severTile: number): MarketCityStateV2 {
  const result = applyWorldCommand(state, { type: 'place-power-line', tileIds: [severTile] });
  if (!result.ok) throw new Error(`power repair failed: ${result.reason ?? 'unknown reason'}`);
  return result.state;
}

export function buildFireCoverageScenario(fireCount: 1 | 4): MarketScenarioBuild & {
  fireTileIds: number[];
} {
  const scenario = context(`fire-coverage:${fireCount}`, 'firebreak-48', 10_009);
  scenario.state.clock.fireDifficulty = 'hard';
  execute(scenario, 'place fire coverage coal plant', {
    type: 'place-facility', kind: 'coal-power-plant', anchor: scenarioTile(16, 20),
  });
  execute(scenario, 'place fire coverage service road', {
    type: 'place-road', tileIds: horizontalTiles(24, 14, 21),
  });
  execute(scenario, 'place fire coverage feeder', {
    type: 'place-power-line',
    tileIds: [
      ...horizontalTiles(22, 18, 23),
      scenarioTile(23, 23),
      scenarioTile(23, 24),
    ],
  });
  execute(scenario, 'place central fire station', {
    type: 'place-facility', kind: 'fire-station', anchor: scenarioTile(24, 24),
  });
  // A station now needs power as well as a road, and environment.powered is
  // only written by stepMonth. This fixture is read before it steps, so the
  // field has to be persisted here or the station reads as dark.
  scenario.state.environment.powered = derivePower(scenario.state).powered;
  const candidates = [
    scenarioTile(24, 22),
    scenarioTile(26, 24),
    scenarioTile(24, 26),
    scenarioTile(22, 24),
  ];
  const fireTileIds = candidates.slice(0, fireCount);
  execute(scenario, 'zone seeded fire cells', { type: 'zone', zone: 'I', tileIds: fireTileIds });
  for (const tile of fireTileIds) {
    scenario.state.economy.density[tile] = 1;
    scenario.state.economy.wealth[tile] = 18_000;
    const zone = scenario.state.map.zones[tile]!;
    const incident = {
      id: `fire-m1-t${tile}`,
      status: 'burning' as const,
      tileIds: [tile],
      zone,
      startedMonth: 1,
      structure: {
        footprint: '1x1' as const,
        originTile: tile,
        height: 1,
        roof: 'flat' as const,
        roofHeight: 1,
        roofOrientation: 0,
        detail: null,
        color: [238, 178, 80] as [number, number, number],
        landmark: false,
      },
      intensity: 0.65,
      damage: 7.5,
      age: 6,
      rubbleMonthsRemaining: 0,
    };
    scenario.state.fire.incidents.push(incident);
    scenario.state.fire.history.push({
      sequence: scenario.state.fire.history.length + 1,
      month: 1,
      incidentId: incident.id,
      event: 'ignited',
      tileIds: [tile],
      zone,
      intensity: incident.intensity,
      damage: incident.damage,
      rubbleMonthsRemaining: 0,
    });
  }
  scenario.state.clock.month = 1;
  provisionScenarioWater(scenario);
  return { ...scenario, fireTileIds };
}

export function sectorStocks(state: MarketCityStateV2): MarketSectorValues {
  const stocks: MarketSectorValues = { R: 0, C: 0, I: 0 };
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    const sector = state.map.zones[tile];
    if (sector !== null && sector !== undefined) stocks[sector] += state.economy.density[tile] ?? 0;
  }
  return stocks;
}

function stepFor(initial: MarketCityStateV2, months: number): MarketCityStateV2 {
  let state = initial;
  for (let month = 0; month < months; month += 1) state = stepMonth(state);
  return state;
}

export function runDeterministicCheckpointTrace(initial: MarketCityStateV2): MarketScenarioCheckpoint[] {
  const checkpoints = new Set<number>(MARKET_SCENARIO_CHECKPOINTS);
  const result: MarketScenarioCheckpoint[] = [];
  let state = initial;
  for (let month = 0; month <= MARKET_SCENARIO_CHECKPOINTS.at(-1)!; month += 1) {
    if (checkpoints.has(month)) {
      const stocks = sectorStocks(state);
      result.push({
        month,
        hash: hashDeterministicState(state),
        stocks,
        population: stocks.R * 100,
        treasury: state.economy.treasury,
        collapsedTotal: state.fire.collapsedTotal,
      });
    }
    if (month < MARKET_SCENARIO_CHECKPOINTS.at(-1)!) state = stepMonth(state);
  }
  return result;
}

export function summarizeScenarioState(state: MarketCityStateV2): MarketScenarioSummary {
  const stocks = sectorStocks(state);
  return {
    month: state.clock.month,
    hash: hashDeterministicState(state),
    stocks,
    population: stocks.R * 100,
    treasury: state.economy.treasury,
    revenue: state.economy.lastRevenue,
    operatingExpense: state.economy.lastOperatingExpense,
    net: state.economy.lastNet,
    occupiedLots: state.economy.density.filter((density) => density > 0).length,
    burningLots: state.fire.incidents.filter((incident) => incident.status === 'burning').length,
    collapsedTotal: state.fire.collapsedTotal,
    maximumPollution: Math.max(...state.environment.pollution),
  };
}

/** Runtime invariant check used by the CLI proof and soak tests. */
export function assertScenarioStateIsValid(state: MarketCityStateV2): void {
  const arrays = [
    state.economy.density,
    state.economy.wealth,
    state.environment.pollution,
    state.environment.congestion,
    state.fire.char,
  ];
  for (const values of arrays) {
    if (values.length !== TILE_COUNT) throw new Error(`scenario field has ${values.length} tiles, expected ${TILE_COUNT}`);
    if (values.some((value) => !Number.isFinite(value))) throw new Error('scenario state contains a non-finite tile value');
  }
  if (state.fire.incidents.some((incident) => (
    !Number.isFinite(incident.intensity)
    || !Number.isFinite(incident.damage)
    || !Number.isFinite(incident.age)
    || !Number.isFinite(incident.rubbleMonthsRemaining)
  ))) throw new Error('scenario state contains a non-finite fire incident');
  const aggregates = [
    state.economy.treasury,
    state.economy.lastRevenue,
    state.economy.lastOperatingExpense,
    state.economy.lastNet,
    ...Object.values(state.market.demand),
    ...Object.values(state.market.margin),
  ];
  if (aggregates.some((value) => !Number.isFinite(value))) throw new Error('scenario state contains a non-finite aggregate');
  if (state.economy.density.some((value) => value < -1e-12)) throw new Error('scenario density is negative');
  if (state.economy.wealth.some((value) => value < -1e-12)) throw new Error('scenario wealth is negative');
  if (state.environment.pollution.some((value) => value < -1e-12 || value > 100 + 1e-12)) {
    throw new Error('scenario pollution is outside 0..100');
  }
  if (state.environment.congestion.some((value) => value < -1e-12 || value > 1 + 1e-12)) {
    throw new Error('scenario congestion is outside 0..1');
  }

  const { densityCaps } = deriveDensityCaps(state);
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (state.map.zones[tile] === null && state.economy.density[tile]! > 1e-12) {
      throw new Error(`un-zoned tile ${tile} contains density`);
    }
    if (state.map.zones[tile] !== null && state.economy.density[tile]! > densityCaps[tile]! + 1e-9) {
      throw new Error(`tile ${tile} density exceeds its cap`);
    }
  }
}
