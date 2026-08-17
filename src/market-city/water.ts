import { orthogonalNeighbors } from './math';
import { MARKET_CITY_RULES } from './rules';
import { deriveUtilities } from './utilities';
import {
  hasFacilityRoadAccess,
  type MarketPowerResult,
} from './spatial';
import type {
  MarketCityStateV2,
  MarketFacility,
  MarketWaterComponentMetrics,
  MarketWaterFacilityKind,
  MarketWaterFacilityOperation,
  MarketWaterResult,
  MarketThermalPlantWaterOperation,
} from './types';

const WATER_FACILITY_KINDS = new Set<MarketWaterFacilityKind>([
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
]);
const EPSILON = 1e-12;

export interface ThermalPlantWaterCandidate {
  id: string;
  anchor: number;
  tileIds: readonly number[];
  demand: number;
}

function isWaterFacility(facility: MarketFacility): facility is MarketFacility & { kind: MarketWaterFacilityKind } {
  return WATER_FACILITY_KINDS.has(facility.kind as MarketWaterFacilityKind);
}

function componentNumber(id: string): number {
  return Number(id.slice('water:'.length));
}

function compareComponentIds(left: string, right: string): number {
  return componentNumber(left) - componentNumber(right) || left.localeCompare(right);
}

function derivePipeTopology(state: MarketCityStateV2): {
  componentByTile: Array<string | null>;
  connectionMasks: number[];
  componentTiles: Map<string, number[]>;
} {
  const count = state.map.waterPipes.length;
  const componentByTile = Array<string | null>(count).fill(null);
  const connectionMasks = Array<number>(count).fill(0);
  const componentTiles = new Map<string, number[]>();

  for (let tile = 0; tile < count; tile += 1) {
    if (!state.map.waterPipes[tile]) continue;
    const x = tile % state.map.size;
    const y = Math.floor(tile / state.map.size);
    if (y > 0 && state.map.waterPipes[tile - state.map.size]) connectionMasks[tile]! |= 1;
    if (x + 1 < state.map.size && state.map.waterPipes[tile + 1]) connectionMasks[tile]! |= 2;
    if (y + 1 < state.map.size && state.map.waterPipes[tile + state.map.size]) connectionMasks[tile]! |= 4;
    if (x > 0 && state.map.waterPipes[tile - 1]) connectionMasks[tile]! |= 8;
  }

  const seen = Array<boolean>(count).fill(false);
  for (let start = 0; start < count; start += 1) {
    if (!state.map.waterPipes[start] || seen[start]) continue;
    const queue = [start];
    const members: number[] = [];
    seen[start] = true;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      members.push(current);
      for (const neighbor of orthogonalNeighbors(current, state.map.size)) {
        if (!state.map.waterPipes[neighbor] || seen[neighbor]) continue;
        seen[neighbor] = true;
        queue.push(neighbor);
      }
    }
    members.sort((left, right) => left - right);
    const id = `water:${members[0]}`;
    for (const tile of members) componentByTile[tile] = id;
    componentTiles.set(id, members);
  }
  return { componentByTile, connectionMasks, componentTiles };
}

function attachedPipeTiles(
  state: MarketCityStateV2,
  facility: MarketFacility,
): number[] {
  const footprint = new Set(facility.tiles);
  const attached = new Set<number>();
  for (const tile of facility.tiles) {
    if (state.map.waterPipes[tile]) attached.add(tile);
    for (const neighbor of orthogonalNeighbors(tile, state.map.size)) {
      if (!footprint.has(neighbor) && state.map.waterPipes[neighbor]) attached.add(neighbor);
    }
  }
  return [...attached].sort((left, right) => left - right);
}

function touchesShoreline(state: MarketCityStateV2, facility: MarketFacility): boolean {
  const footprint = new Set(facility.tiles);
  return facility.tiles.some((tile) => orthogonalNeighbors(tile, state.map.size)
    .some((neighbor) => !footprint.has(neighbor) && state.map.terrain.water[neighbor] === true));
}

function powerAccessForFacility(
  facility: MarketFacility,
  power: MarketPowerResult,
): boolean {
  const componentIds = new Set(
    facility.tiles.map((tile) => power.componentByTile[tile]).filter((id): id is string => id !== null),
  );
  return power.components.some(({ id, capacity }) => componentIds.has(id) && capacity > 0);
}

function deriveFacilityOperations(
  state: MarketCityStateV2,
  power: MarketPowerResult,
  componentByTile: readonly (string | null)[],
): MarketWaterFacilityOperation[] {
  return state.map.facilities
    .filter(isWaterFacility)
    .map((facility) => {
      const allAttachments = attachedPipeTiles(state, facility);
      const attachedComponentIds = [...new Set(
        allAttachments.map((tile) => componentByTile[tile]).filter((id): id is string => id !== null),
      )].sort(compareComponentIds);
      const componentId = attachedComponentIds[0] ?? null;
      const attachmentTileIds = componentId === null
        ? []
        : allAttachments.filter((tile) => componentByTile[tile] === componentId);
      const roadAccess = hasFacilityRoadAccess(state, facility);
      const powerAccess = powerAccessForFacility(facility, power);
      const pipeAccess = componentId !== null;
      const shoreline = facility.kind !== 'coastal-water-pump' || touchesShoreline(state, facility);
      const operational = roadAccess && powerAccess && pipeAccess && shoreline;
      const rule = MARKET_CITY_RULES.water.facilities[facility.kind];
      const inactiveReason = operational
        ? null
        : !roadAccess
          ? `No road access within ${MARKET_CITY_RULES.roadReach} tiles.`
          : !powerAccess
            ? 'No live power component connection.'
            : !pipeAccess
              ? 'No attached water pipe.'
              : 'Coastal pump footprint must touch surface water.';
      return {
        id: facility.id,
        kind: facility.kind,
        anchor: facility.anchor,
        tileIds: [...facility.tiles],
        roadAccess,
        powerAccess,
        pipeAccess,
        shoreline,
        attachmentTileIds,
        componentId,
        operational,
        inactiveReason,
        rawCapacity: rule.rawCapacity,
        treatmentCapacity: rule.treatmentCapacity,
      };
    })
    .sort((left, right) => left.anchor - right.anchor || left.id.localeCompare(right.id));
}

/**
 * Allocate a Water topology's fixed source capacity to the current city
 * density.  Topology, facility gates, and source coverage are structural; a
 * fire settlement can only change consumers and their demand.  Keeping that
 * distinction explicit lets the simulation reconcile closing demand without
 * rebuilding an identical pipe graph.
 */
function allocateWaterService(
  state: MarketCityStateV2,
  componentByTile: readonly (string | null)[],
  connectionMasks: readonly number[],
  facilities: readonly MarketWaterFacilityOperation[],
  coverageByTile: readonly (string | null)[],
  structuralComponents: readonly MarketWaterComponentMetrics[],
  thermalCandidates: readonly ThermalPlantWaterCandidate[],
): MarketWaterResult {
  const count = state.map.waterPipes.length;
  const components = structuralComponents
    .map(({ id, rawCapacity, treatmentCapacity, usableCapacity }) => ({
      id,
      rawCapacity,
      treatmentCapacity,
      usableCapacity,
      demand: 0,
      allocated: 0,
    }))
    .sort((left, right) => compareComponentIds(left.id, right.id));
  const thermalPlants = thermalCandidates.map<MarketThermalPlantWaterOperation>((plant) => ({
    id: plant.id,
    anchor: plant.anchor,
    tileIds: [...plant.tileIds],
    demand: plant.demand,
    componentId: null,
    waterAccess: false,
  }));
  const thermalById = new Map(thermalPlants.map((plant) => [plant.id, plant]));

  const consumersByComponent = new Map<string, Array<{
    tile: number;
    tiles: number[];
    demand: number;
    previouslyWatered: boolean;
    thermalPlantId?: string;
  }>>();
  for (let tile = 0; tile < count; tile += 1) {
    const zone = state.map.zones[tile] ?? null;
    const componentId = coverageByTile[tile] ?? null;
    if (zone === null || componentId === null) continue;
    const consumers = consumersByComponent.get(componentId) ?? [];
    consumers.push({
      tile,
      tiles: [tile],
      demand: (state.economy.density[tile] ?? 0) * MARKET_CITY_RULES.water.demand[zone],
      previouslyWatered: state.environment.watered[tile] ?? false,
    });
    consumersByComponent.set(componentId, consumers);
  }
  for (const facility of state.map.facilities) {
    if (facility.kind !== 'train-station') continue;
    const coverageTile = facility.tiles.find((tile) => coverageByTile[tile] !== null);
    const componentId = coverageTile === undefined ? null : coverageByTile[coverageTile] ?? null;
    if (componentId === null) continue;
    const consumers = consumersByComponent.get(componentId) ?? [];
    consumers.push({
      tile: facility.anchor,
      tiles: [...facility.tiles],
      demand: MARKET_CITY_RULES.transit.trainStationWaterDemand,
      previouslyWatered: facility.tiles.every((tile) => state.environment.watered[tile] === true),
    });
    consumersByComponent.set(componentId, consumers);
  }
  for (const plant of thermalPlants) {
    const coverageTile = plant.tileIds.find((tile) => coverageByTile[tile] !== null);
    const componentId = coverageTile === undefined ? null : coverageByTile[coverageTile] ?? null;
    plant.componentId = componentId;
    if (componentId === null) continue;
    const consumers = consumersByComponent.get(componentId) ?? [];
    consumers.push({
      tile: plant.anchor,
      tiles: [...plant.tileIds],
      demand: plant.demand,
      previouslyWatered: plant.tileIds.every((tile) => state.environment.watered[tile] === true),
      thermalPlantId: plant.id,
    });
    consumersByComponent.set(componentId, consumers);
  }

  const watered = Array<boolean>(count).fill(false);
  for (const component of components) {
    const consumers = consumersByComponent.get(component.id) ?? [];
    component.demand = consumers.reduce((total, consumer) => total + consumer.demand, 0);
    let remaining = component.usableCapacity;
    const positive = consumers
      .filter(({ demand }) => demand > EPSILON)
      .sort((left, right) => (
        Number(right.previouslyWatered) - Number(left.previouslyWatered)
        || left.tile - right.tile
      ));
    for (const consumer of positive) {
      if (consumer.demand > remaining + EPSILON) continue;
      for (const tile of consumer.tiles) watered[tile] = true;
      if (consumer.thermalPlantId !== undefined) thermalById.get(consumer.thermalPlantId)!.waterAccess = true;
      component.allocated += consumer.demand;
      remaining = Math.max(0, remaining - consumer.demand);
    }
    if (remaining > EPSILON) {
      for (const consumer of consumers) {
        if (consumer.demand <= EPSILON) for (const tile of consumer.tiles) watered[tile] = true;
      }
    }
    // Demand is totaled in canonical consumer order, while allocation follows
    // the previous-service queue. When every fractional consumer fits those
    // different addition orders can differ in the final binary ulp; clamp the
    // reported aggregate so a fully served component is exactly coherent.
    component.allocated = Math.min(component.allocated, component.demand, component.usableCapacity);
  }

  const clonedComponents = components.map((component) => ({ ...component }));
  return {
    componentByTile: [...componentByTile],
    connectionMasks: [...connectionMasks],
    components: clonedComponents,
    facilities: facilities.map((facility) => ({
      ...facility,
      tileIds: [...facility.tileIds],
      attachmentTileIds: [...facility.attachmentTileIds],
    })),
    thermalPlants: thermalPlants.map((plant) => ({ ...plant, tileIds: [...plant.tileIds] })),
    coverageByTile: [...coverageByTile],
    watered,
    service: {
      componentByTile: [...componentByTile],
      components: clonedComponents.map((component) => ({ ...component })),
      totalDemand: clonedComponents.reduce((total, component) => total + component.demand, 0),
      totalAllocated: clonedComponents.reduce((total, component) => total + component.allocated, 0),
    },
  };
}

/**
 * Derive deterministic, component-local Water service without mutating the city.
 * Pipe topology is always exposed; only components containing an operational raw
 * source cover consumers. Coverage selects nearest pipe, then canonical component.
 */
export function deriveWaterServiceForPower(
  state: MarketCityStateV2,
  openingPower: MarketPowerResult,
  thermalCandidates: readonly ThermalPlantWaterCandidate[] = [],
): MarketWaterResult {
  const count = state.map.waterPipes.length;
  const hasPipes = state.map.waterPipes.some(Boolean);
  const hasWaterFacilities = state.map.facilities.some(isWaterFacility);
  // The overwhelmingly common pre-Water and dry-city path must not derive a
  // second power graph merely to prove that no pipe or facility can consume
  // it. This remains a fully canonical empty service result, not a cache.
  if (!hasPipes && !hasWaterFacilities) {
    return {
      componentByTile: Array<string | null>(count).fill(null),
      connectionMasks: Array<number>(count).fill(0),
      components: [],
      facilities: [],
      thermalPlants: thermalCandidates.map((plant) => ({
        id: plant.id, anchor: plant.anchor, tileIds: [...plant.tileIds], demand: plant.demand,
        componentId: null, waterAccess: false,
      })),
      coverageByTile: Array<string | null>(count).fill(null),
      watered: Array<boolean>(count).fill(false),
      service: {
        componentByTile: Array<string | null>(count).fill(null),
        components: [],
        totalDemand: 0,
        totalAllocated: 0,
      },
    };
  }
  const { componentByTile, connectionMasks, componentTiles } = derivePipeTopology(state);
  const facilities = hasWaterFacilities
    ? deriveFacilityOperations(state, openingPower, componentByTile)
    : [];
  const operationsByComponent = new Map<string, MarketWaterFacilityOperation[]>();
  for (const operation of facilities) {
    if (!operation.operational || operation.componentId === null) continue;
    const entries = operationsByComponent.get(operation.componentId) ?? [];
    entries.push(operation);
    operationsByComponent.set(operation.componentId, entries);
  }

  const componentIds = [...componentTiles.keys()].sort(compareComponentIds);
  const mutableMetrics = new Map<string, MarketWaterComponentMetrics>();
  for (const id of componentIds) {
    const operations = operationsByComponent.get(id) ?? [];
    const rawCapacity = operations.reduce((total, operation) => total + operation.rawCapacity, 0);
    const treatmentCapacity = operations.reduce((total, operation) => total + operation.treatmentCapacity, 0);
    mutableMetrics.set(id, {
      id,
      rawCapacity,
      treatmentCapacity,
      usableCapacity: rawCapacity + Math.min(rawCapacity, treatmentCapacity),
      demand: 0,
      allocated: 0,
    });
  }

  const coverageByTile = Array<string | null>(count).fill(null);
  const coverageDistance = Array<number>(count).fill(Number.POSITIVE_INFINITY);
  const coverageQueue: Array<{ tile: number; distance: number; componentId: string }> = [];
  for (const id of componentIds) {
    if ((mutableMetrics.get(id)?.rawCapacity ?? 0) <= 0) continue;
    for (const pipeTile of componentTiles.get(id) ?? []) {
      const priorId = coverageByTile[pipeTile] ?? null;
      if (coverageDistance[pipeTile] === 0
        && priorId !== null
        && compareComponentIds(priorId, id) <= 0) continue;
      coverageDistance[pipeTile] = 0;
      coverageByTile[pipeTile] = id;
      coverageQueue.push({ tile: pipeTile, distance: 0, componentId: id });
    }
  }
  for (let cursor = 0; cursor < coverageQueue.length; cursor += 1) {
    const current = coverageQueue[cursor]!;
    if (coverageDistance[current.tile] !== current.distance
      || coverageByTile[current.tile] !== current.componentId
      || current.distance >= MARKET_CITY_RULES.water.coverageRadius) continue;
    const nextDistance = current.distance + 1;
    for (const neighbor of orthogonalNeighbors(current.tile, state.map.size)) {
      const priorId = coverageByTile[neighbor] ?? null;
      if (nextDistance > coverageDistance[neighbor]!
        || (nextDistance === coverageDistance[neighbor]
          && priorId !== null
          && compareComponentIds(current.componentId, priorId) >= 0)) continue;
      coverageDistance[neighbor] = nextDistance;
      coverageByTile[neighbor] = current.componentId;
      coverageQueue.push({ tile: neighbor, distance: nextDistance, componentId: current.componentId });
    }
  }

  return allocateWaterService(
    state,
    componentByTile,
    connectionMasks,
    facilities,
    coverageByTile,
    componentIds.map((id) => mutableMetrics.get(id)!),
    thermalCandidates,
  );
}

/** Canonical water status, including thermal cooling reservations. */
export function deriveWaterService(
  state: MarketCityStateV2,
  _openingPower?: MarketPowerResult,
): MarketWaterResult {
  return deriveUtilities(state).water;
}

/**
 * Reconcile consumer demand after a simulation phase that cannot mutate roads,
 * pipes, facilities, or power topology.  The result is byte-for-byte
 * equivalent to deriving Water service from scratch for the same state.
 */
export function reconcileWaterService(
  state: MarketCityStateV2,
  topology: MarketWaterResult,
): MarketWaterResult {
  return allocateWaterService(
    state,
    topology.componentByTile,
    topology.connectionMasks,
    topology.facilities,
    topology.coverageByTile,
    topology.components,
    topology.thermalPlants,
  );
}
