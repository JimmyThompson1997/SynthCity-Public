import { cachedTilesWithinManhattan, orthogonalNeighbors } from './math';
import { MARKET_CITY_RULES } from './rules';
import { derivePower, hasFacilityRoadAccess, type MarketPowerResult } from './spatial';
import { deriveWaterService } from './water';
import type {
  MarketCityStateV2,
  MarketFacility,
  MarketPassengerRailResult,
  MarketRailComponent,
  MarketRailPathResult,
  MarketRailServiceState,
  MarketRailShuttleLeg,
  MarketRailStationOperation,
  MarketRailTopologyResult,
  MarketWaterResult,
} from './types';

export const MARKET_TRAIN_STATION_NO_ROAD_REASON = 'No road access within 3 tiles.';
export const MARKET_TRAIN_STATION_NO_RAIL_REASON = 'No rail component adjacent to the station footprint.';
export const MARKET_TRAIN_STATION_NO_POWER_REASON = 'No allocated power capacity.';
export const MARKET_TRAIN_STATION_NO_WATER_REASON = 'No allocated water service.';

const DIRECTIONS = Object.freeze([
  { bit: 1, opposite: 4, dx: 0, dy: -1 },
  { bit: 2, opposite: 8, dx: 1, dy: 0 },
  { bit: 4, opposite: 1, dx: 0, dy: 1 },
  { bit: 8, opposite: 2, dx: -1, dy: 0 },
] as const);

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNumberArrays(left: readonly number[], right: readonly number[]): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return left.length - right.length;
}

function directionForDelta(dx: number, dy: number): { bit: number; opposite: number } | undefined {
  return DIRECTIONS.find((direction) => direction.dx === dx && direction.dy === dy);
}

/**
 * Validate a player-drawn ordered Rail route and derive only the edges explicitly
 * present in that gesture. Adjacent Rail cells never acquire implicit links.
 */
export function deriveRailPath(size: number, orderedPath: readonly number[]): MarketRailPathResult {
  if (!Number.isInteger(size) || size <= 0) return { ok: false, reason: 'Rail map size must be a positive integer.' };
  if (orderedPath.length === 0) return { ok: false, reason: 'Rail path must include at least one tile.' };

  const tileIds = [...orderedPath];
  const masks = new Map<number, number>();
  for (const tileId of tileIds) {
    if (!Number.isSafeInteger(tileId) || tileId < 0 || tileId >= size * size) {
      return { ok: false, reason: `Rail tile ${String(tileId)} is outside the map.` };
    }
    if (masks.has(tileId)) return { ok: false, reason: 'Rail path cannot visit a tile more than once.' };
    masks.set(tileId, 0);
  }

  for (let index = 0; index + 1 < tileIds.length; index += 1) {
    const from = tileIds[index]!;
    const to = tileIds[index + 1]!;
    const fromX = from % size;
    const fromY = Math.floor(from / size);
    const toX = to % size;
    const toY = Math.floor(to / size);
    const direction = directionForDelta(toX - fromX, toY - fromY);
    if (direction === undefined) {
      return { ok: false, reason: 'Rail path must use ordered unique cardinally adjacent tiles.' };
    }
    masks.set(from, (masks.get(from) ?? 0) | direction.bit);
    masks.set(to, (masks.get(to) ?? 0) | direction.opposite);
  }

  return {
    ok: true,
    tileIds,
    tiles: tileIds.map((tileId) => ({ tileId, connectionMask: masks.get(tileId) ?? 0 })),
  };
}

/**
 * Road art must respect the exact gesture that placed it: two adjacent
 * parallel strokes are not automatically an intersection.
 */
export function deriveRoadPath(size: number, orderedPath: readonly number[]): MarketRailPathResult {
  if (!Number.isInteger(size) || size <= 0) return { ok: false, reason: 'Road map size must be a positive integer.' };
  if (orderedPath.length === 0) return { ok: false, reason: 'Road path must include at least one tile.' };

  const tileIds = [...orderedPath];
  const masks = new Map<number, number>();
  for (const tileId of tileIds) {
    if (!Number.isSafeInteger(tileId) || tileId < 0 || tileId >= size * size) {
      return { ok: false, reason: `Road tile ${String(tileId)} is outside the map.` };
    }
    if (masks.has(tileId)) return { ok: false, reason: 'Road path cannot visit a tile more than once.' };
    masks.set(tileId, 0);
  }

  for (let index = 0; index + 1 < tileIds.length; index += 1) {
    const from = tileIds[index]!;
    const to = tileIds[index + 1]!;
    const fromX = from % size;
    const fromY = Math.floor(from / size);
    const toX = to % size;
    const toY = Math.floor(to / size);
    const direction = directionForDelta(toX - fromX, toY - fromY);
    if (direction === undefined) return { ok: false, reason: 'Road path must use ordered unique cardinally adjacent tiles.' };
    masks.set(from, (masks.get(from) ?? 0) | direction.bit);
    masks.set(to, (masks.get(to) ?? 0) | direction.opposite);
  }

  return {
    ok: true,
    tileIds,
    tiles: tileIds.map((tileId) => ({ tileId, connectionMask: masks.get(tileId) ?? 0 })),
  };
}

function connectedRailNeighbors(state: MarketCityStateV2, tileId: number): number[] {
  const size = state.map.size;
  const x = tileId % size;
  const y = Math.floor(tileId / size);
  const mask = state.map.railConnectionMasks[tileId] ?? 0;
  const result: number[] = [];
  for (const direction of DIRECTIONS) {
    if ((mask & direction.bit) === 0) continue;
    const neighborX = x + direction.dx;
    const neighborY = y + direction.dy;
    if (neighborX < 0 || neighborX >= size || neighborY < 0 || neighborY >= size) continue;
    const neighbor = neighborY * size + neighborX;
    if (state.map.rails[neighbor] !== true) continue;
    if (((state.map.railConnectionMasks[neighbor] ?? 0) & direction.opposite) === 0) continue;
    result.push(neighbor);
  }
  return result.sort((left, right) => left - right);
}

function deriveComponents(state: MarketCityStateV2): {
  components: MarketRailComponent[];
  componentByTile: Array<string | null>;
} {
  const components: MarketRailComponent[] = [];
  const componentByTile = Array<string | null>(state.map.rails.length).fill(null);
  const visited = new Set<number>();
  for (let tileId = 0; tileId < state.map.rails.length; tileId += 1) {
    if (state.map.rails[tileId] !== true || visited.has(tileId)) continue;
    const pending = [tileId];
    const tileIds: number[] = [];
    visited.add(tileId);
    while (pending.length > 0) {
      const current = pending.shift()!;
      tileIds.push(current);
      for (const neighbor of connectedRailNeighbors(state, current)) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    tileIds.sort((left, right) => left - right);
    const id = `rail:${tileIds[0]}`;
    for (const member of tileIds) componentByTile[member] = id;
    components.push({ id, tileIds });
  }
  return { components, componentByTile };
}

function stationCatchment(state: MarketCityStateV2, facility: MarketFacility): { residents: number; jobs: number } {
  const catchment = new Set<number>();
  for (const footprintTile of facility.tiles) {
    for (const candidate of cachedTilesWithinManhattan(footprintTile, 6, state.map.size)) catchment.add(candidate);
  }
  let residents = 0;
  let jobs = 0;
  for (const tileId of catchment) {
    const density = state.economy.density[tileId] ?? 0;
    if (state.map.zones[tileId] === 'R') residents += density * MARKET_CITY_RULES.peoplePerDensity;
    else if (state.map.zones[tileId] === 'C' || state.map.zones[tileId] === 'I') {
      jobs += density * MARKET_CITY_RULES.peoplePerDensity;
    }
  }
  return { residents, jobs };
}

function stationInactiveReason(
  roadAccess: boolean,
  railAccess: boolean,
  powerAccess: boolean,
  waterAccess: boolean,
): string | null {
  const reasons = [
    !roadAccess ? MARKET_TRAIN_STATION_NO_ROAD_REASON : null,
    !railAccess ? MARKET_TRAIN_STATION_NO_RAIL_REASON : null,
    !powerAccess ? MARKET_TRAIN_STATION_NO_POWER_REASON : null,
    !waterAccess ? MARKET_TRAIN_STATION_NO_WATER_REASON : null,
  ].filter((reason): reason is string => reason !== null);
  return reasons.length === 0 ? null : reasons.join(' ');
}

function deriveStationOperations(
  state: MarketCityStateV2,
  components: readonly MarketRailComponent[],
  componentByTile: readonly (string | null)[],
  power: MarketPowerResult,
  water: MarketWaterResult,
): MarketRailStationOperation[] {
  const componentOrder = new Map(components.map((component, index) => [component.id, index]));
  return state.map.facilities
    .filter((facility) => facility.kind === 'train-station')
    .sort((left, right) => compareStrings(left.id, right.id))
    .map((facility) => {
      const footprint = new Set(facility.tiles);
      const touched = new Set<number>();
      for (const footprintTile of facility.tiles) {
        for (const neighbor of orthogonalNeighbors(footprintTile, state.map.size)) {
          if (!footprint.has(neighbor) && state.map.rails[neighbor] === true) touched.add(neighbor);
        }
      }
      const touchedRailTileIds = [...touched].sort((left, right) => left - right);
      const candidateComponentIds = [...new Set(touchedRailTileIds
        .map((tileId) => componentByTile[tileId] ?? null)
        .filter((id): id is string => id !== null))]
        .sort((left, right) => (componentOrder.get(left) ?? Number.MAX_SAFE_INTEGER)
          - (componentOrder.get(right) ?? Number.MAX_SAFE_INTEGER));
      const componentId = candidateComponentIds[0] ?? null;
      const attachmentTileIds = componentId === null
        ? []
        : touchedRailTileIds.filter((tileId) => componentByTile[tileId] === componentId);
      const roadAccess = hasFacilityRoadAccess(state, facility);
      const railAccess = componentId !== null;
      const powerAccess = facility.tiles.every((tile) => power.powered[tile] === true);
      const waterAccess = facility.tiles.every((tile) => water.watered[tile] === true);
      const waterCoverageTile = facility.tiles.find((tile) => water.coverageByTile[tile] !== null);
      const waterComponentId = waterCoverageTile === undefined ? null : water.coverageByTile[waterCoverageTile] ?? null;
      const { residents, jobs } = stationCatchment(state, facility);
      return {
        stationId: facility.id,
        anchor: facility.anchor,
        tileIds: [...facility.tiles],
        roadAccess,
        railAccess,
        powerAccess,
        waterAccess,
        touchedRailTileIds,
        attachmentTileIds,
        componentId,
        waterComponentId,
        operational: roadAccess && railAccess && powerAccess && waterAccess,
        inactiveReason: stationInactiveReason(roadAccess, railAccess, powerAccess, waterAccess),
        residents,
        jobs,
        ridership: 0,
      };
    });
}

function shortestPathBetweenTiles(
  state: MarketCityStateV2,
  source: number,
  target: number,
): number[] | null {
  if (source === target) return [source];
  const distance = new Map<number, number>([[target, 0]]);
  const pending = [target];
  while (pending.length > 0) {
    const current = pending.shift()!;
    const nextDistance = (distance.get(current) ?? 0) + 1;
    for (const neighbor of connectedRailNeighbors(state, current)) {
      if (distance.has(neighbor)) continue;
      distance.set(neighbor, nextDistance);
      pending.push(neighbor);
    }
  }
  if (!distance.has(source)) return null;
  const path = [source];
  let current = source;
  while (current !== target) {
    const currentDistance = distance.get(current)!;
    const next = connectedRailNeighbors(state, current)
      .filter((neighbor) => distance.get(neighbor) === currentDistance - 1)
      .sort((left, right) => left - right)[0];
    if (next === undefined) return null;
    path.push(next);
    current = next;
  }
  return path;
}

function shortestStationPath(
  state: MarketCityStateV2,
  left: MarketRailStationOperation,
  right: MarketRailStationOperation,
): number[] | null {
  let best: number[] | null = null;
  for (const source of left.attachmentTileIds) {
    for (const target of right.attachmentTileIds) {
      if (source === target) continue;
      const candidate = shortestPathBetweenTiles(state, source, target);
      if (candidate === null || candidate.length < 2) continue;
      if (best === null
        || candidate.length < best.length
        || (candidate.length === best.length && compareNumberArrays(candidate, best) < 0)) best = candidate;
    }
  }
  return best;
}

interface CandidateLeg extends MarketRailShuttleLeg {}

function deriveShuttleLegs(
  state: MarketCityStateV2,
  components: readonly MarketRailComponent[],
  stations: readonly MarketRailStationOperation[],
): MarketRailShuttleLeg[] {
  const result: MarketRailShuttleLeg[] = [];
  for (const component of components) {
    const componentStations = stations
      .filter((station) => station.operational && station.componentId === component.id)
      .sort((left, right) => compareStrings(left.stationId, right.stationId));
    if (componentStations.length < 2) continue;
    const candidates: CandidateLeg[] = [];
    for (let leftIndex = 0; leftIndex < componentStations.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < componentStations.length; rightIndex += 1) {
        const left = componentStations[leftIndex]!;
        const right = componentStations[rightIndex]!;
        const pathTileIds = shortestStationPath(state, left, right);
        if (pathTileIds === null || pathTileIds.length < 2) continue;
        const ridership = Math.floor(
          Math.min(left.residents, right.jobs) + Math.min(right.residents, left.jobs),
        );
        candidates.push({
          id: `rail-leg:${component.id}:${left.stationId}:${right.stationId}`,
          componentId: component.id,
          stationAId: left.stationId,
          stationBId: right.stationId,
          pathTileIds,
          pathLength: pathTileIds.length - 1,
          ridership,
        });
      }
    }
    candidates.sort((left, right) => left.pathLength - right.pathLength
      || compareStrings(left.stationAId, right.stationAId)
      || compareStrings(left.stationBId, right.stationBId)
      || compareNumberArrays(left.pathTileIds, right.pathTileIds));

    const parent = new Map(componentStations.map((station) => [station.stationId, station.stationId]));
    const find = (id: string): string => {
      let root = id;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let current = id;
      while (parent.get(current) !== current) {
        const next = parent.get(current)!;
        parent.set(current, root);
        current = next;
      }
      return root;
    };
    for (const candidate of candidates) {
      const leftRoot = find(candidate.stationAId);
      const rightRoot = find(candidate.stationBId);
      if (leftRoot === rightRoot) continue;
      parent.set(rightRoot, leftRoot);
      result.push(candidate);
      if (result.filter((leg) => leg.componentId === component.id).length === componentStations.length - 1) break;
    }
  }
  return result;
}

function deriveInternal(
  state: MarketCityStateV2,
  power: MarketPowerResult = derivePower(state),
  water: MarketWaterResult = deriveWaterService(state, power),
): MarketPassengerRailResult {
  if (!state.map.rails.some(Boolean)
    && !state.map.facilities.some((facility) => facility.kind === 'train-station')) {
    return {
      topology: {
        componentByTile: Array<string | null>(state.map.rails.length).fill(null),
        components: [],
        stations: [],
        shuttleLegs: [],
      },
      service: {
        totalRidership: 0,
        tileUsage: Array<number>(state.map.rails.length).fill(0),
        stationUsage: [],
      },
    };
  }
  const { components, componentByTile } = deriveComponents(state);
  const baseStations = deriveStationOperations(state, components, componentByTile, power, water);
  const shuttleLegs = deriveShuttleLegs(state, components, baseStations);
  const ridershipByStation = new Map<string, number>();
  const tileUsage = Array<number>(state.map.rails.length).fill(0);
  let totalRidership = 0;
  for (const leg of shuttleLegs) {
    totalRidership += leg.ridership;
    ridershipByStation.set(leg.stationAId, (ridershipByStation.get(leg.stationAId) ?? 0) + leg.ridership);
    ridershipByStation.set(leg.stationBId, (ridershipByStation.get(leg.stationBId) ?? 0) + leg.ridership);
    for (const tileId of leg.pathTileIds) tileUsage[tileId] = (tileUsage[tileId] ?? 0) + leg.ridership;
  }
  const stations = baseStations.map((station) => ({
    ...station,
    ridership: ridershipByStation.get(station.stationId) ?? 0,
  }));
  const service: MarketRailServiceState = {
    totalRidership,
    tileUsage,
    stationUsage: stations
      .filter((station) => station.ridership > 0)
      .map((station) => ({ stationId: station.stationId, ridership: station.ridership })),
  };
  const topology: MarketRailTopologyResult = {
    componentByTile,
    components,
    stations,
    shuttleLegs,
  };
  return { topology, service };
}

/** Pure derived graph used by inspectors and runtime shuttle animation. */
export function deriveRailTopology(
  state: MarketCityStateV2,
  power?: MarketPowerResult,
  water?: MarketWaterResult,
): MarketRailTopologyResult {
  return deriveInternal(state, power, water).topology;
}

/** Operational/inspection projection for every Train Station, sorted by station ID. */
export function deriveRailStationOperations(
  state: MarketCityStateV2,
  power?: MarketPowerResult,
  water?: MarketWaterResult,
): MarketRailStationOperation[] {
  return deriveInternal(state, power, water).topology.stations;
}

/** Pure canonical passenger metrics; shuttle animation progress is intentionally absent. */
export function derivePassengerRailService(
  state: MarketCityStateV2,
  power?: MarketPowerResult,
  water?: MarketWaterResult,
): MarketPassengerRailResult {
  return deriveInternal(state, power, water);
}
