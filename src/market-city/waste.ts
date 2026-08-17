import { MARKET_CITY_RULES } from './rules';
import { orthogonalNeighbors } from './math';
import type {
  MarketCityStateV2,
  MarketLandfillFillStage,
  MarketWasteServiceState,
} from './types';

/**
 * Visual stages are deliberately derived from the persisted store, not saved
 * separately. That keeps every rendering client on the same exact thresholds.
 */
export function deriveLandfillFillStage(storedTenths: number): MarketLandfillFillStage {
  if (!Number.isSafeInteger(storedTenths) || storedTenths < 0
    || storedTenths > MARKET_CITY_RULES.waste.cellStorageCapacity) {
    throw new RangeError('Landfill stored waste must be a safe integer within the configured capacity.');
  }
  if (storedTenths === 0) return 'empty';
  if (storedTenths < 2_500) return 'scattered';
  if (storedTenths < 5_000) return 'low';
  if (storedTenths < 7_500) return 'medium';
  if (storedTenths < MARKET_CITY_RULES.waste.cellStorageCapacity) return 'high';
  return 'full';
}

export interface MarketWasteSettlement {
  readonly service: MarketWasteServiceState;
  readonly pollutionAddition: number;
}

/** One cardinally connected landfill area and its derived operating capacity. */
export interface MarketLandfillComponentOperation {
  readonly id: string;
  readonly tileIds: number[];
  readonly roadConnected: boolean;
  readonly storedTenths: number;
  readonly capacityTenths: number;
  readonly freeCapacityTenths: number;
  readonly usableMonthlyIntakeTenths: number;
}

export interface MarketLandfillOperations {
  readonly componentByTile: Array<string | null>;
  readonly components: MarketLandfillComponentOperation[];
}

function safeAdd(left: number, right: number, field: string): number {
  const total = left + right;
  if (!Number.isSafeInteger(total)) throw new RangeError(`Waste ${field} exceeds the safe integer range.`);
  return total;
}

/**
 * Landfill zones join only over cardinal edges.  A single direct cardinal
 * touch to either a Road or Avenue operates the entire contiguous area.
 * The result is derived from the map and ledger, never persisted.
 */
export function deriveLandfillOperations(state: MarketCityStateV2): MarketLandfillOperations {
  const componentByTile = Array<string | null>(state.map.size * state.map.size).fill(null);
  const components: MarketLandfillComponentOperation[] = [];

  for (let seed = 0; seed < state.map.landfillZones.length; seed += 1) {
    if (state.map.landfillZones[seed] !== true || componentByTile[seed] !== null) continue;
    const queue = [seed];
    const tileIds: number[] = [];
    componentByTile[seed] = '';
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const tile = queue[cursor]!;
      tileIds.push(tile);
      for (const neighbor of orthogonalNeighbors(tile, state.map.size)) {
        if (state.map.landfillZones[neighbor] !== true || componentByTile[neighbor] !== null) continue;
        componentByTile[neighbor] = '';
        queue.push(neighbor);
      }
    }
    tileIds.sort((left, right) => left - right);
    const id = `landfill:${tileIds[0]}`;
    tileIds.forEach((tile) => { componentByTile[tile] = id; });
    const roadConnected = tileIds.some((tile) => orthogonalNeighbors(tile, state.map.size)
      .some((neighbor) => state.map.roads[neighbor] === true || state.map.avenueLanes[neighbor] === true));
    const storedTenths = tileIds.reduce((total, tile) => total + (state.services.waste.storedByTile[tile] ?? 0), 0);
    const capacityTenths = tileIds.length * MARKET_CITY_RULES.waste.cellStorageCapacity;
    const freeCapacityTenths = capacityTenths - storedTenths;
    const usableMonthlyIntakeTenths = roadConnected
      ? tileIds.reduce((total, tile) => total + Math.min(
        MARKET_CITY_RULES.waste.cellMonthlyIntake,
        MARKET_CITY_RULES.waste.cellStorageCapacity - (state.services.waste.storedByTile[tile] ?? 0),
      ), 0)
      : 0;
    components.push({
      id,
      tileIds,
      roadConnected,
      storedTenths,
      capacityTenths,
      freeCapacityTenths,
      usableMonthlyIntakeTenths,
    });
  }

  return { componentByTile, components };
}

/**
 * Settle one month of citywide collection from the opening developed density.
 * There are intentionally no producer stocks, routes, or truck simulation.
 */
export function settleWaste(state: MarketCityStateV2): MarketWasteSettlement {
  let generatedFloat = 0;
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    const zone = state.map.zones[tile];
    if (zone === null || zone === undefined) continue;
    const density = state.economy.density[tile] ?? 0;
    if (density <= 0) continue;
    generatedFloat += density * MARKET_CITY_RULES.waste.generation[zone];
  }
  const generated = Math.floor(generatedFloat + Number.EPSILON);
  const storedByTile = [...state.services.waste.storedByTile];
  let remaining = generated;

  for (const component of deriveLandfillOperations(state).components) {
    if (!component.roadConnected || remaining === 0) continue;
    for (const tile of component.tileIds) {
      if (remaining === 0) break;
      const stored = storedByTile[tile] ?? 0;
      const space = MARKET_CITY_RULES.waste.cellStorageCapacity - stored;
      const accepted = Math.min(remaining, MARKET_CITY_RULES.waste.cellMonthlyIntake, space);
      if (accepted <= 0) continue;
      storedByTile[tile] = stored + accepted;
      remaining -= accepted;
    }
  }

  const landfilled = generated - remaining;
  const prior = state.services.waste;
  const service: MarketWasteServiceState = {
    generatedThisMonth: generated,
    generatedLifetime: safeAdd(prior.generatedLifetime, generated, 'generatedLifetime'),
    landfilledThisMonth: landfilled,
    landfilledLifetime: safeAdd(prior.landfilledLifetime, landfilled, 'landfilledLifetime'),
    unmanagedThisMonth: remaining,
    unmanagedLifetime: safeAdd(prior.unmanagedLifetime, remaining, 'unmanagedLifetime'),
    storedByTile,
  };
  const pollutionAddition = generated === 0
    ? 0
    : MARKET_CITY_RULES.waste.maximumUnmanagedPollution * remaining / generated;
  return { service, pollutionAddition };
}

/** Internal invariant helper shared by simulation's fast-path check. */
export function isWasteServiceEmpty(service: MarketWasteServiceState): boolean {
  return service.generatedThisMonth === 0
    && service.generatedLifetime === 0
    && service.landfilledThisMonth === 0
    && service.landfilledLifetime === 0
    && service.unmanagedThisMonth === 0
    && service.unmanagedLifetime === 0
    && service.storedByTile.every((stored) => stored === 0);
}
