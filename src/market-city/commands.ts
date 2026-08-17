import { MARKET_CITY_RULES, isPowerPlant } from './rules';
import { protectedFireTiles } from './fire';
import { cloneMarketCityState, validateMarketCityState } from './state';
import { deriveAvenueRibbon } from './avenue';
import { hasRciPhysicalOccupant } from './spatial';
import { derivePassengerRailService, deriveRailPath, deriveRoadPath } from './transport';
import { deriveUtilities } from './utilities';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketCityCommandResult,
  type MarketCityStateV2,
  type MarketCityWorldCommand,
  type MarketFacility,
  type MarketFacilityKind,
} from './types';

const TILE_COUNT = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;
const FACILITY_KINDS = new Set<MarketFacilityKind>([
  'coal-power-plant',
  'gas-power-plant',
  'nuclear-power-plant',
  'wind-turbine',
  'solar-plant',
  'fire-station',
  'police-station',
  'train-station',
  'subway-station',
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
  'subway-station',
]);
const TERRAIN_MATERIALS = new Set(['grass', 'earth', 'sand', 'rock']);

export type MarketZoneTileDisposition = 'place' | 'same-zone' | 'blocked-zone' | 'blocked-occupied' | 'blocked-water' | 'blocked-fire';

export interface MarketZoneTileOutcome {
  tileId: number;
  disposition: MarketZoneTileDisposition;
}

function reject(state: MarketCityStateV2, reason: string): MarketCityCommandResult {
  return { ok: false, state, changedTileIds: [], reason };
}

function accept(state: MarketCityStateV2, changedTileIds: Iterable<number>): MarketCityCommandResult {
  // Persist a stable derived pair. Power and Water use the prior service state
  // to break allocation ties, so one pass can be a transitional allocation
  // after a topology edit; the second pass is the canonical state that a save
  // and the next command will derive from again.
  let utilities = deriveUtilities(state);
  state.environment.powered = utilities.power.powered;
  state.environment.watered = utilities.water.watered;
  state.services.water = utilities.water.service;
  utilities = deriveUtilities(state);
  state.environment.powered = utilities.power.powered;
  state.environment.watered = utilities.water.watered;
  state.services.water = utilities.water.service;
  const trainStationCount = state.map.facilities.reduce(
    (count, facility) => count + (facility.kind === 'train-station' ? 1 : 0),
    0,
  );
  if (trainStationCount >= 2 && state.map.rails.some(Boolean)) {
    state.services.rail = derivePassengerRailService(state, utilities.power, utilities.water).service;
  } else if (state.services.rail.totalRidership !== 0
    || state.services.rail.stationUsage.length > 0) {
    state.services.rail = {
      totalRidership: 0,
      tileUsage: Array<number>(TILE_COUNT).fill(0),
      stationUsage: [],
    };
  }
  return { ok: true, state, changedTileIds: [...new Set(changedTileIds)].sort((left, right) => left - right) };
}

function commandTiles(tileIds: readonly number[]): number[] | string {
  if (tileIds.length === 0) return 'Command must include at least one tile.';
  const result = [...new Set(tileIds)].sort((left, right) => left - right);
  for (const tile of result) {
    if (!Number.isSafeInteger(tile) || tile < 0 || tile >= TILE_COUNT) return `Tile ${String(tile)} is outside the map.`;
  }
  return result;
}

function facilityDimensions(kind: MarketFacilityKind): readonly [number, number] {
  if (isPowerPlant(kind)) return MARKET_CITY_RULES.plants[kind].footprint;
  if (kind === 'water-tower') return [2, 2];
  if (kind === 'coastal-water-pump') return [3, 3];
  if (kind === 'water-treatment-plant') return [4, 3];
  if (kind === 'train-station') return [2, 2];
  return [1, 1];
}

function facilityFootprint(kind: MarketFacilityKind, anchor: number): number[] | string {
  if (!Number.isSafeInteger(anchor) || anchor < 0 || anchor >= TILE_COUNT) return 'Facility anchor is outside the map.';
  const [width, height] = facilityDimensions(kind);
  const anchorX = anchor % MARKET_CITY_MAP_SIZE;
  const anchorY = Math.floor(anchor / MARKET_CITY_MAP_SIZE);
  if (anchorX + width > MARKET_CITY_MAP_SIZE || anchorY + height > MARKET_CITY_MAP_SIZE) {
    return 'Facility footprint is outside the map.';
  }
  const result: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) result.push((anchorY + y) * MARKET_CITY_MAP_SIZE + anchorX + x);
  }
  return result;
}

function facilityAt(state: MarketCityStateV2, tile: number): MarketFacility | undefined {
  return state.map.facilities.find((facility) => facility.tiles.includes(tile));
}

function isOccupied(state: MarketCityStateV2, tile: number): boolean {
  return state.map.zones[tile] !== null
    || state.map.roads[tile] === true
    || state.map.avenueLanes[tile] === true
    || state.map.rails[tile] === true
    || state.map.powerLines[tile] === true
    || state.map.landfillZones[tile] === true
    || facilityAt(state, tile) !== undefined;
}

function zoningBlocksPhysicalPlacement(state: MarketCityStateV2, tile: number): boolean {
  // Empty zoning is a reversible land-use permission, not a built occupant.
  // A real surface placement may consume it. Developed R/C/I and landfill
  // storage remain protected until the player intentionally clears them.
  if (state.map.zones[tile] !== null && (state.economy.density[tile] ?? 0) > 0) return true;
  return state.map.landfillZones[tile] === true
    && (state.services.waste.storedByTile[tile] ?? 0) > 0;
}

function surfacePlacementConflicts(state: MarketCityStateV2, tile: number): boolean {
  return zoningBlocksPhysicalPlacement(state, tile)
    || state.map.roads[tile] === true
    || state.map.avenueLanes[tile] === true
    || state.map.rails[tile] === true
    || state.map.powerLines[tile] === true
    || facilityAt(state, tile) !== undefined;
}

function clearEmptyZoningForPhysicalPlacement(state: MarketCityStateV2, tiles: readonly number[]): void {
  for (const tile of tiles) {
    if (state.map.zones[tile] !== null) {
      state.map.zones[tile] = null;
      state.economy.density[tile] = 0;
      state.economy.wealth[tile] = 0;
    }
    if (state.map.landfillZones[tile] === true) {
      state.map.landfillZones[tile] = false;
      state.services.waste.storedByTile[tile] = 0;
    }
  }
}

function validateLandTiles(state: MarketCityStateV2, tiles: readonly number[]): string | undefined {
  if (tiles.some((tile) => state.map.terrain.water[tile] === true)) return 'Command cannot build on water.';
  return undefined;
}

function zeroTileState(state: MarketCityStateV2, tile: number): void {
  state.economy.density[tile] = 0;
  state.economy.wealth[tile] = 0;
  state.environment.pollution[tile] = 0;
  state.environment.congestion[tile] = 0;
  state.environment.roadAccess[tile] = false;
  state.environment.powered[tile] = false;
  state.environment.watered[tile] = false;
  state.services.rail.tileUsage[tile] = 0;
  state.fire.char[tile] = 0;
}

function mutableSurfaceTiles(state: MarketCityStateV2, tiles: readonly number[]): number[] | string {
  const locked = protectedFireTiles(state);
  const mutable = tiles.filter((tile) => !locked.has(tile));
  return mutable.length > 0 ? mutable : 'Burning buildings and rubble are locked until recovery completes.';
}

/**
 * Shared placement policy for the canonical command and dashboard preview.
 * New R/C/I zoning is bare-land-only: a physical surface occupant blocks it,
 * while underground pipes remain compatible with a developable lot.
 */
export function classifyZoneTileOutcomes(
  state: MarketCityStateV2,
  zone: 'R' | 'C' | 'I',
  tileIds: readonly number[],
): MarketZoneTileOutcome[] {
  const locked = protectedFireTiles(state);
  return tileIds.map((tileId) => {
    if (locked.has(tileId)) return { tileId, disposition: 'blocked-fire' };
    if (state.map.terrain.water[tileId] === true) return { tileId, disposition: 'blocked-water' };
    if (state.map.landfillZones[tileId] === true) return { tileId, disposition: 'blocked-zone' };
    const existing = state.map.zones[tileId];
    if (existing === zone) return { tileId, disposition: 'same-zone' };
    if (existing !== null) return { tileId, disposition: 'blocked-zone' };
    if (hasRciPhysicalOccupant(state, tileId)) return { tileId, disposition: 'blocked-occupied' };
    return { tileId, disposition: 'place' };
  });
}

function zonePlacementRefusal(outcomes: readonly MarketZoneTileOutcome[]): string {
  if (outcomes.some(({ disposition }) => disposition === 'blocked-occupied')) {
    return 'Zoning cannot be placed on an occupied surface tile.';
  }
  if (outcomes.some(({ disposition }) => disposition === 'blocked-zone')) {
    return 'Existing zoning must be removed with Dezone before its sector can change.';
  }
  if (outcomes.some(({ disposition }) => disposition === 'blocked-water')) {
    return 'Zoning cannot be placed on water.';
  }
  return 'Burning buildings and rubble are locked until recovery completes.';
}

const TOPOLOGY_DIRECTIONS = Object.freeze([
  { bit: 1, opposite: 4, dx: 0, dy: -1 },
  { bit: 2, opposite: 8, dx: 1, dy: 0 },
  { bit: 4, opposite: 1, dx: 0, dy: 1 },
  { bit: 8, opposite: 2, dx: -1, dy: 0 },
] as const);

function clearTopologyTile(layer: boolean[], masks: number[], tile: number): number[] {
  const changed: number[] = [];
  const x = tile % MARKET_CITY_MAP_SIZE;
  const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
  for (const direction of TOPOLOGY_DIRECTIONS) {
    const neighborX = x + direction.dx;
    const neighborY = y + direction.dy;
    if (neighborX < 0 || neighborX >= MARKET_CITY_MAP_SIZE || neighborY < 0 || neighborY >= MARKET_CITY_MAP_SIZE) {
      continue;
    }
    const neighbor = neighborY * MARKET_CITY_MAP_SIZE + neighborX;
    const previous = masks[neighbor] ?? 0;
    const next = previous & ~direction.opposite;
    if (next !== previous) {
      masks[neighbor] = next;
      changed.push(neighbor);
    }
  }
  if (layer[tile] || masks[tile] !== 0) changed.push(tile);
  layer[tile] = false;
  masks[tile] = 0;
  return changed;
}

function containsStoredWaste(state: MarketCityStateV2, tiles: readonly number[]): boolean {
  return tiles.some((tile) => (state.services.waste.storedByTile[tile] ?? 0) > 0);
}

function clearOccupants(
  state: MarketCityStateV2,
  tiles: readonly number[],
  options: { clearZoning?: boolean } = {},
): number[] {
  const clearZoning = options.clearZoning ?? true;
  const affected = new Set(tiles);
  const removedFacilities = state.map.facilities.filter((facility) => facility.tiles.some((tile) => affected.has(tile)));
  for (const facility of removedFacilities) for (const tile of facility.tiles) affected.add(tile);
  if (removedFacilities.length > 0) {
    const removedIds = new Set(removedFacilities.map((facility) => facility.id));
    state.map.facilities = state.map.facilities.filter((facility) => !removedIds.has(facility.id));
  }
  const railServiceChanged = removedFacilities.some(({ kind }) => kind === 'train-station')
    || [...affected].some((tile) => state.map.rails[tile] === true);
  const topologyChanged = new Set<number>();
  for (const tile of affected) {
    if (clearZoning) {
      state.map.zones[tile] = null;
      state.map.landfillZones[tile] = false;
    }
    for (const changed of clearTopologyTile(state.map.roads, state.map.roadConnectionMasks, tile)) topologyChanged.add(changed);
    state.map.roads[tile] = false;
    for (const changed of clearTopologyTile(state.map.avenueLanes, state.map.avenueTravelMasks, tile)) topologyChanged.add(changed);
    for (const changed of clearTopologyTile(state.map.avenueLanes, state.map.avenuePairMasks, tile)) topologyChanged.add(changed);
    for (const changed of clearTopologyTile(state.map.avenueLanes, state.map.avenueMedianMasks, tile)) topologyChanged.add(changed);
    for (const changed of clearTopologyTile(state.map.rails, state.map.railConnectionMasks, tile)) topologyChanged.add(changed);
    state.map.powerLines[tile] = false;
    zeroTileState(state, tile);
  }
  if (railServiceChanged) {
    state.services.rail.totalRidership = 0;
    state.services.rail.tileUsage.fill(0);
    state.services.rail.stationUsage = [];
  }
  return [...new Set([...affected, ...topologyChanged])].sort((left, right) => left - right);
}

function occupancyFingerprint(state: MarketCityStateV2): string {
  let hash = 0x811c9dc5;
  const facilityByTile = new Map<number, string>();
  for (const facility of state.map.facilities) {
    for (const tile of facility.tiles) facilityByTile.set(tile, `${facility.kind}:${facility.anchor}`);
  }
  const occupancy: string[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    const facility = facilityByTile.get(tile);
    if (facility !== undefined) occupancy.push(`${tile}=F:${facility}`);
    else if (state.map.zones[tile] !== null) occupancy.push(`${tile}=Z:${state.map.zones[tile]}`);
    else if (state.map.roads[tile] === true) occupancy.push(`${tile}=R:${state.map.roadConnectionMasks[tile]}`);
    else if (state.map.avenueLanes[tile] === true) occupancy.push(`${tile}=A:${state.map.avenueTravelMasks[tile]}:${state.map.avenuePairMasks[tile]}`);
    else if (state.map.rails[tile] === true) occupancy.push(`${tile}=T:${state.map.railConnectionMasks[tile]}`);
    else if (state.map.powerLines[tile] === true) occupancy.push(`${tile}=P`);
    else if (state.map.landfillZones[tile] === true) occupancy.push(`${tile}=L`);
    else if (state.map.terrain.water[tile] === true) occupancy.push(`${tile}=W`);
  }
  const text = occupancy.join('|');
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function applyZone(state: MarketCityStateV2, command: Extract<MarketCityWorldCommand, { type: 'zone' }>): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  if (command.zone !== 'R' && command.zone !== 'C' && command.zone !== 'I') return reject(state, 'Zone kind is not supported.');
  const outcomes = classifyZoneTileOutcomes(state, command.zone, tiles);
  const mutable = outcomes
    .filter(({ disposition }) => disposition === 'place')
    .map(({ tileId }) => tileId);
  if (mutable.length === 0 && outcomes.some(({ disposition }) => disposition.startsWith('blocked-'))) {
    return reject(state, zonePlacementRefusal(outcomes));
  }
  if (mutable.length === 0) return accept(state, []);
  const next = cloneMarketCityState(state);
  for (const tile of mutable) next.map.zones[tile] = command.zone;
  return accept(next, mutable);
}

function applyDezone(state: MarketCityStateV2, command: Extract<MarketCityWorldCommand, { type: 'dezone' }>): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  if (containsStoredWaste(state, tiles)) return reject(state, 'Landfill contains garbage.');
  const locked = protectedFireTiles(state);
  const mutable = tiles.filter((tile) => !locked.has(tile) && (
    state.map.landfillZones[tile] === true || state.map.zones[tile] !== null
  ));
  if (mutable.length === 0 && tiles.every((tile) => locked.has(tile))) {
    return reject(state, 'Burning buildings and rubble are locked until recovery completes.');
  }
  if (mutable.length === 0) return accept(state, []);
  const next = cloneMarketCityState(state);
  for (const tile of mutable) {
    if (next.map.landfillZones[tile] === true) {
      next.map.zones[tile] = null;
      next.map.landfillZones[tile] = false;
      zeroTileState(next, tile);
      continue;
    }
    // An R/C/I permission may overlay infrastructure. Clear the permission's
    // economic residue without resetting the live state of the underlying
    // physical tile (network, facility, or utility).
    next.map.zones[tile] = null;
    next.economy.density[tile] = 0;
    next.economy.wealth[tile] = 0;
  }
  return accept(next, mutable);
}

function applyLandfillZone(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'zone-landfill' }>,
): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  if (tiles.some((tile) => protectedFireTiles(state).has(tile))) {
    return reject(state, 'Landfill footprint overlaps a burning building or rubble.');
  }
  const landError = validateLandTiles(state, tiles);
  if (landError !== undefined) return reject(state, landError);
  if (tiles.some((tile) => isOccupied(state, tile) && state.map.landfillZones[tile] !== true)) {
    return reject(state, 'Landfill footprint conflicts with another occupant.');
  }
  const next = cloneMarketCityState(state);
  const changed: number[] = [];
  for (const tile of tiles) {
    if (next.map.landfillZones[tile] !== true) {
      next.map.landfillZones[tile] = true;
      zeroTileState(next, tile);
      changed.push(tile);
    }
  }
  return accept(next, changed);
}

function applyNetwork(
  state: MarketCityStateV2,
  tileIds: readonly number[],
  network: 'road' | 'power-line',
): MarketCityCommandResult {
  const tiles = commandTiles(tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  const mutable = mutableSurfaceTiles(state, tiles);
  if (typeof mutable === 'string') return reject(state, mutable);
  const landError = validateLandTiles(state, mutable);
  if (landError !== undefined) return reject(state, landError);
  for (const tile of mutable) {
    const conflict = network === 'road'
      ? zoningBlocksPhysicalPlacement(state, tile)
        || facilityAt(state, tile) !== undefined
      : zoningBlocksPhysicalPlacement(state, tile)
        || state.map.avenueLanes[tile] === true
        || (state.map.roads[tile] === true && state.map.rails[tile] === true)
        || facilityAt(state, tile) !== undefined;
    if (conflict) {
      return reject(state, `${network === 'road' ? 'Road' : 'Power line'} footprint conflicts with another occupant.`);
    }
  }
  const next = cloneMarketCityState(state);
  clearEmptyZoningForPhysicalPlacement(next, mutable);
  for (const tile of mutable) {
    if (network === 'road') next.map.roads[tile] = true;
    else next.map.powerLines[tile] = true;
  }
  return accept(next, mutable);
}

function applyRoad(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'place-road' }>,
): MarketCityCommandResult {
  const planned = 'path' in command
    ? deriveRoadPath(state.map.size, command.path)
    : (() => {
        const tileIds = commandTiles(command.tileIds);
        return typeof tileIds === 'string'
          ? { ok: false as const, reason: tileIds }
          : { ok: true as const, tileIds, tiles: tileIds.map((tileId) => ({ tileId, connectionMask: 0 })) };
      })();
  if (!planned.ok) return reject(state, planned.reason);
  const mutable = mutableSurfaceTiles(state, planned.tileIds);
  if (typeof mutable === 'string') return reject(state, mutable);
  const landError = validateLandTiles(state, mutable);
  if (landError !== undefined) return reject(state, landError);
  for (const tile of mutable) {
    const conflict = zoningBlocksPhysicalPlacement(state, tile)
      || facilityAt(state, tile) !== undefined;
    if (conflict) return reject(state, 'Road footprint conflicts with another occupant.');
  }

  const next = cloneMarketCityState(state);
  clearEmptyZoningForPhysicalPlacement(next, mutable);
  const mutableTiles = new Set(mutable);
  for (const roadTile of planned.tiles) {
    if (!mutableTiles.has(roadTile.tileId)) continue;
    next.map.roads[roadTile.tileId] = true;
    const x = roadTile.tileId % state.map.size;
    const y = Math.floor(roadTile.tileId / state.map.size);
    const retainedMask = TOPOLOGY_DIRECTIONS.reduce((mask, direction) => {
      if ((roadTile.connectionMask & direction.bit) === 0) return mask;
      const neighborX = x + direction.dx;
      const neighborY = y + direction.dy;
      if (neighborX < 0 || neighborX >= state.map.size || neighborY < 0 || neighborY >= state.map.size) return mask;
      const neighbor = neighborY * state.map.size + neighborX;
      return mutableTiles.has(neighbor) ? mask | direction.bit : mask;
    }, 0);
    next.map.roadConnectionMasks[roadTile.tileId] = (next.map.roadConnectionMasks[roadTile.tileId] ?? 0)
      | retainedMask;
  }
  return accept(next, mutable);
}

function applyAvenue(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'place-avenue' }>,
): MarketCityCommandResult {
  const ribbon = deriveAvenueRibbon(state.map.size, command.path, command.expansionSide);
  if (!ribbon.ok) return reject(state, ribbon.reason);
  if (ribbon.footprint.some((tile) => protectedFireTiles(state).has(tile))) {
    return reject(state, 'Avenue footprint overlaps a burning building or rubble.');
  }
  const landError = validateLandTiles(state, ribbon.footprint);
  if (landError !== undefined) return reject(state, landError);
  for (const tile of ribbon.footprint) {
    const conflict = zoningBlocksPhysicalPlacement(state, tile)
      || state.map.powerLines[tile] === true
      || facilityAt(state, tile) !== undefined;
    if (conflict) return reject(state, 'Avenue footprint conflicts with another occupant.');
  }

  const next = cloneMarketCityState(state);
  clearEmptyZoningForPhysicalPlacement(next, ribbon.footprint);
  for (const lane of ribbon.lanes) {
    const established = next.map.avenueLanes[lane.tileId] === true;
    next.map.avenueLanes[lane.tileId] = true;
    next.map.avenueTravelMasks[lane.tileId] = (next.map.avenueTravelMasks[lane.tileId] ?? 0)
      | lane.travelMask;
    next.map.avenuePairMasks[lane.tileId] = (next.map.avenuePairMasks[lane.tileId] ?? 0)
      | lane.pairMask;
    // Median paint is owned by the first Avenue that occupied this tile.
    // A crossing may connect through it, but must not repaint the old avenue.
    if (!established) next.map.avenueMedianMasks[lane.tileId] = lane.pairMask;
  }
  return accept(next, ribbon.footprint);
}

function applyRail(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'place-rail' }>,
): MarketCityCommandResult {
  const plan = deriveRailPath(state.map.size, command.path);
  if (!plan.ok) return reject(state, plan.reason);
  const locked = protectedFireTiles(state);
  if (plan.tileIds.some((tile) => locked.has(tile))) {
    return reject(state, 'Rail footprint overlaps a burning building or rubble.');
  }
  const landError = validateLandTiles(state, plan.tileIds);
  if (landError !== undefined) return reject(state, landError);
  for (const tile of plan.tileIds) {
    const conflict = zoningBlocksPhysicalPlacement(state, tile)
      || facilityAt(state, tile) !== undefined;
    if (conflict) return reject(state, 'Rail footprint conflicts with another occupant.');
  }

  const next = cloneMarketCityState(state);
  clearEmptyZoningForPhysicalPlacement(next, plan.tileIds);
  for (const railTile of plan.tiles) {
    next.map.rails[railTile.tileId] = true;
    next.map.railConnectionMasks[railTile.tileId] = (next.map.railConnectionMasks[railTile.tileId] ?? 0)
      | railTile.connectionMask;
  }
  return accept(next, plan.tileIds);
}

function applySubway(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'place-subway' }>,
): MarketCityCommandResult {
  const path = command.path.length === 1
    ? (() => {
        const tiles = commandTiles(command.path);
        return typeof tiles === 'string'
          ? { ok: false as const, reason: tiles }
          : { ok: true as const, tileIds: tiles, tiles: tiles.map((tileId) => ({ tileId, connectionMask: 0 })) };
      })()
    : deriveRailPath(state.map.size, command.path);
  if (!path.ok) return reject(state, path.reason);
  const next = cloneMarketCityState(state);
  for (const subwayTile of path.tiles) {
    next.map.subways[subwayTile.tileId] = true;
    next.map.subwayConnectionMasks[subwayTile.tileId] = (next.map.subwayConnectionMasks[subwayTile.tileId] ?? 0)
      | subwayTile.connectionMask;
  }
  return accept(next, path.tileIds);
}

function applyFacility(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'place-facility' }>,
): MarketCityCommandResult {
  if (!FACILITY_KINDS.has(command.kind)) {
    return reject(state, 'Facility kind is not active yet.');
  }
  const kind = command.kind;
  const footprint = facilityFootprint(kind, command.anchor);
  if (typeof footprint === 'string') return reject(state, footprint);
  if (footprint.some((tile) => protectedFireTiles(state).has(tile))) {
    return reject(state, 'Facility footprint overlaps a burning building or rubble.');
  }
  const landError = validateLandTiles(state, footprint);
  if (landError !== undefined) return reject(state, landError);
  if (kind === 'subway-station' && state.map.subways[command.anchor] !== true) {
    return reject(state, 'Subway Station requires a Subway Tunnel directly below its entrance.');
  }
  if (kind === 'coastal-water-pump') {
    const footprintSet = new Set(footprint);
    const touchesWater = footprint.some((tile) => {
      const x = tile % MARKET_CITY_MAP_SIZE;
      const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
      return [
        y > 0 ? tile - MARKET_CITY_MAP_SIZE : -1,
        x + 1 < MARKET_CITY_MAP_SIZE ? tile + 1 : -1,
        y + 1 < MARKET_CITY_MAP_SIZE ? tile + MARKET_CITY_MAP_SIZE : -1,
        x > 0 ? tile - 1 : -1,
      ].some((neighbor) => neighbor >= 0
        && !footprintSet.has(neighbor)
        && state.map.terrain.water[neighbor] === true);
    });
    if (!touchesWater) return reject(state, 'Coastal water pump footprint must touch shoreline surface water.');
  }
  if (footprint.some((tile) => surfacePlacementConflicts(state, tile))) return reject(state, 'Facility footprint conflicts with another occupant.');
  const next = cloneMarketCityState(state);
  clearEmptyZoningForPhysicalPlacement(next, footprint);
  const id = `facility:${kind}:${command.anchor}:${occupancyFingerprint(state)}`;
  next.map.facilities.push({ id, kind, anchor: command.anchor, tiles: footprint });
  return accept(next, footprint);
}

function applyPaintTerrain(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'paint-terrain' }>,
): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  const mutable = mutableSurfaceTiles(state, tiles);
  if (typeof mutable === 'string') return reject(state, mutable);
  if (command.material === undefined && command.water === undefined) {
    return reject(state, 'Terrain paint must specify material or water.');
  }
  if (command.material !== undefined && !TERRAIN_MATERIALS.has(command.material)) {
    return reject(state, 'Terrain material is not supported.');
  }
  if (command.water !== undefined && typeof command.water !== 'boolean') return reject(state, 'Terrain water must be a boolean.');
  if (command.water === true && mutable.some((tile) => state.map.waterPipes[tile] === true)) {
    return reject(state, 'Terrain water cannot cover an underground water pipe.');
  }
  if (command.water === true && containsStoredWaste(state, mutable)) {
    return reject(state, 'Landfill contains garbage.');
  }
  const next = cloneMarketCityState(state);
  for (const tile of mutable) {
    if (command.material !== undefined) next.map.terrain.material[tile] = command.material;
    if (command.water !== undefined) next.map.terrain.water[tile] = command.water;
  }
  const flooded = mutable.filter((tile) => next.map.terrain.water[tile] === true);
  for (const tile of flooded) next.map.terrain.trees[tile] = 0;
  const changed = flooded.length === 0 ? mutable : [...new Set([...mutable, ...clearOccupants(next, flooded)])];
  return accept(next, changed);
}

function applyTreeAdjustment(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'adjust-trees' }>,
): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  const mutable = mutableSurfaceTiles(state, tiles);
  if (typeof mutable === 'string') return reject(state, mutable);
  if (command.delta !== -1 && command.delta !== 1) return reject(state, 'Tree cover must change by exactly one level.');
  const next = cloneMarketCityState(state);
  const changed: number[] = [];
  for (const tile of mutable) {
    const current = next.map.terrain.trees[tile] ?? 0;
    const level = next.map.terrain.water[tile] === true
      ? 0
      : Math.max(0, Math.min(4, current + command.delta));
    if (level !== current) changed.push(tile);
    next.map.terrain.trees[tile] = level;
  }
  return accept(next, changed);
}

function applyElevation(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'set-elevation' }>,
): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  const mutable = mutableSurfaceTiles(state, tiles);
  if (typeof mutable === 'string') return reject(state, mutable);
  if (!Number.isFinite(command.elevation)) return reject(state, 'Elevation must be a finite number.');
  const next = cloneMarketCityState(state);
  for (const tile of mutable) next.map.terrain.elevation[tile] = command.elevation;
  return accept(next, mutable);
}

function applyElevationAdjustment(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'adjust-elevation' }>,
): MarketCityCommandResult {
  const tiles = commandTiles(command.tileIds);
  if (typeof tiles === 'string') return reject(state, tiles);
  const mutable = mutableSurfaceTiles(state, tiles);
  if (typeof mutable === 'string') return reject(state, mutable);
  if (!Number.isFinite(command.delta)) return reject(state, 'Elevation delta must be a finite number.');
  if (mutable.some((tile) => !Number.isFinite((state.map.terrain.elevation[tile] ?? 0) + command.delta))) {
    return reject(state, 'Elevation adjustment must produce finite values.');
  }
  const next = cloneMarketCityState(state);
  for (const tile of mutable) next.map.terrain.elevation[tile] = (next.map.terrain.elevation[tile] ?? 0) + command.delta;
  return accept(next, mutable);
}

/**
 * Set the citywide force budget.
 *
 * This only moves the TARGET rate. The share itself drifts toward it a little
 * each month, so a mayor cannot buy their way out of blight in one cheque --
 * which is the point of the whole controller.
 */
function applyCrimeFunding(
  state: MarketCityStateV2,
  command: Extract<MarketCityWorldCommand, { type: 'set-crime-funding' }>,
): MarketCityCommandResult {
  const { funding } = command;
  const maximum = MARKET_CITY_RULES.police.maximumFunding;
  if (!Number.isInteger(funding) || funding < 0 || funding > maximum) {
    return reject(state, `Police funding must be a whole step from 0 to ${maximum}.`);
  }
  if (funding === state.crime.funding) return accept(cloneMarketCityState(state), []);
  const next = cloneMarketCityState(state);
  next.crime.funding = funding;
  return accept(next, []);
}

function resetElevation(state: MarketCityStateV2): MarketCityCommandResult {
  const next = cloneMarketCityState(state);
  const locked = protectedFireTiles(state);
  const changed: number[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (locked.has(tile)) continue;
    if (next.map.terrain.elevation[tile] !== 0) changed.push(tile);
    next.map.terrain.elevation[tile] = 0;
  }
  return accept(next, changed);
}

export function applyWorldCommand(state: MarketCityStateV2, command: MarketCityWorldCommand): MarketCityCommandResult {
  validateMarketCityState(state);
  switch (command.type) {
    case 'zone': return applyZone(state, command);
    case 'dezone': return applyDezone(state, command);
    case 'demolish': {
      const tiles = commandTiles(command.tileIds);
      if (typeof tiles === 'string') return reject(state, tiles);
      if (command.layer !== undefined && command.layer !== 'surface' && command.layer !== 'underground') {
        return reject(state, 'Demolition layer is not supported.');
      }
      if (command.layer === 'underground') {
        const next = cloneMarketCityState(state);
        const changed = tiles.filter((tile) => next.map.waterPipes[tile] === true || next.map.subways[tile] === true);
        for (const tile of changed) {
          next.map.waterPipes[tile] = false;
          next.map.subways[tile] = false;
          next.map.subwayConnectionMasks[tile] = 0;
        }
        for (const tile of changed) {
          const x = tile % MARKET_CITY_MAP_SIZE;
          const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
          const neighbors = [y > 0 ? tile - MARKET_CITY_MAP_SIZE : -1, x + 1 < MARKET_CITY_MAP_SIZE ? tile + 1 : -1, y + 1 < MARKET_CITY_MAP_SIZE ? tile + MARKET_CITY_MAP_SIZE : -1, x > 0 ? tile - 1 : -1];
          for (const neighbor of neighbors) {
            if (neighbor < 0 || !next.map.subways[neighbor]) continue;
            next.map.subwayConnectionMasks[neighbor] = 0;
          }
        }
        // Reconstruct reciprocal masks from remaining neighbors after a cut.
        for (let tile = 0; tile < TILE_COUNT; tile += 1) {
          if (!next.map.subways[tile]) continue;
          const x = tile % MARKET_CITY_MAP_SIZE;
          const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
          let mask = 0;
          if (y > 0 && next.map.subways[tile - MARKET_CITY_MAP_SIZE]) mask |= 1;
          if (x + 1 < MARKET_CITY_MAP_SIZE && next.map.subways[tile + 1]) mask |= 2;
          if (y + 1 < MARKET_CITY_MAP_SIZE && next.map.subways[tile + MARKET_CITY_MAP_SIZE]) mask |= 4;
          if (x > 0 && next.map.subways[tile - 1]) mask |= 8;
          next.map.subwayConnectionMasks[tile] = mask;
        }
        return accept(next, changed);
      }
      const mutable = mutableSurfaceTiles(state, tiles);
      if (typeof mutable === 'string') return reject(state, mutable);
      if (containsStoredWaste(state, mutable)) return reject(state, 'Landfill contains garbage.');
      const next = cloneMarketCityState(state);
      return accept(next, clearOccupants(next, mutable, { clearZoning: false }));
    }
    case 'place-road': return applyRoad(state, command);
    case 'place-avenue': return applyAvenue(state, command);
    case 'place-rail': return applyRail(state, command);
    case 'place-subway': return applySubway(state, command);
    case 'place-power-line': return applyNetwork(state, command.tileIds, 'power-line');
    case 'place-water-pipe': {
      const tiles = commandTiles(command.tileIds);
      if (typeof tiles === 'string') return reject(state, tiles);
      if (tiles.some((tile) => state.map.terrain.water[tile] === true)) {
        return reject(state, 'Water pipes require dry land.');
      }
      const next = cloneMarketCityState(state);
      for (const tile of tiles) next.map.waterPipes[tile] = true;
      return accept(next, tiles);
    }
    case 'zone-landfill': return applyLandfillZone(state, command);
    case 'place-facility': return applyFacility(state, command);
    case 'paint-terrain': return applyPaintTerrain(state, command);
    case 'adjust-trees': return applyTreeAdjustment(state, command);
    case 'set-elevation': return applyElevation(state, command);
    case 'adjust-elevation': return applyElevationAdjustment(state, command);
    case 'set-crime-funding': return applyCrimeFunding(state, command);
    case 'reset-elevation': return resetElevation(state);
  }
}
