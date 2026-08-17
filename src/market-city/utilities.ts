import { MARKET_CITY_RULES } from './rules';
import {
  derivePowerForLivePlants,
  hasFacilityRoadAccess,
  powerPlantFacilities,
  type MarketPowerResult,
} from './spatial';
import { deriveWaterServiceForPower, type ThermalPlantWaterCandidate } from './water';
import type {
  MarketCityStateV2,
  MarketPowerPlantOperation,
  MarketWaterResult,
} from './types';

export interface MarketUtilityResult {
  power: MarketPowerResult;
  water: MarketWaterResult;
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function withPlantOperations(
  state: MarketCityStateV2,
  plants: ReturnType<typeof powerPlantFacilities>,
  power: MarketPowerResult,
  water: MarketWaterResult,
  livePlantIds: readonly string[],
): MarketUtilityResult {
  const liveIdSet = new Set(livePlantIds);
  const waterByPlantId = new Map(water.thermalPlants.map((plant) => [plant.id, plant]));
  const plantOperations = plants.map<MarketPowerPlantOperation>((facility) => {
    const rule = MARKET_CITY_RULES.plants[facility.kind];
    const reservation = waterByPlantId.get(facility.id);
    const roadAccess = rule.requiresRoad ? hasFacilityRoadAccess(state, facility) : null;
    const waterAccess = rule.waterDemand > 0 ? reservation?.waterAccess ?? false : null;
    const operational = liveIdSet.has(facility.id);
    const inactiveReason = operational
      ? null
      : roadAccess === false
        ? `No road access within ${MARKET_CITY_RULES.roadReach} tiles.`
        : waterAccess === false
          ? 'No allocated water service.'
          : 'Utility requirements are not met.';
    return {
      id: facility.id,
      kind: facility.kind,
      anchor: facility.anchor,
      tileIds: [...facility.tiles],
      roadRequired: rule.requiresRoad,
      waterDemand: rule.waterDemand,
      roadAccess,
      waterAccess,
      waterComponentId: reservation?.componentId ?? null,
      operational,
      inactiveReason,
    };
  });
  return { power: { ...power, plantOperations }, water };
}

/**
 * Resolve the mutual power/water dependency without storing a transient game
 * state. Renewables seed the network; every iteration can only enable another
 * thermal generator or a water source, so the finite facility bound is exact.
 */
export function deriveUtilities(state: MarketCityStateV2): MarketUtilityResult {
  const plants = powerPlantFacilities(state)
    .slice()
    .sort((left, right) => left.anchor - right.anchor || left.id.localeCompare(right.id));
  const renewableIds = plants
    .filter((facility) => {
      const rule = MARKET_CITY_RULES.plants[facility.kind];
      return !rule.requiresRoad && rule.waterDemand === 0;
    })
    .map((facility) => facility.id);
  const thermalCandidates: ThermalPlantWaterCandidate[] = plants
    // Cooling access and road access are separate player-facing gates. A
    // roadless thermal plant can have its all-or-nothing water reservation,
    // but cannot contribute generation until *both* requirements are true.
    // This lets repairing one prerequisite clear only its corresponding map
    // marker while retaining the normal component-local allocation order.
    .filter((facility) => MARKET_CITY_RULES.plants[facility.kind].waterDemand > 0)
    .map((facility) => ({
      id: facility.id,
      anchor: facility.anchor,
      tileIds: [...facility.tiles],
      demand: MARKET_CITY_RULES.plants[facility.kind].waterDemand,
    }));

  let livePlantIds = [...renewableIds];
  const maximumPasses = plants.length + state.map.facilities.filter((facility) => (
    facility.kind === 'water-tower'
      || facility.kind === 'coastal-water-pump'
      || facility.kind === 'water-treatment-plant'
  )).length + 1;

  for (let pass = 0; pass < maximumPasses; pass += 1) {
    const power = derivePowerForLivePlants(state, livePlantIds);
    const water = deriveWaterServiceForPower(state, power, thermalCandidates);
    const cooledThermals = water.thermalPlants
      .filter((plant) => plant.waterAccess)
      .map((plant) => plant.id)
      .sort((left, right) => left.localeCompare(right));
    const nextLivePlantIds = [...renewableIds, ...cooledThermals]
      .sort((left, right) => left.localeCompare(right));
    const canonicalLiveIds = [...livePlantIds].sort((left, right) => left.localeCompare(right));
    if (!sameIds(nextLivePlantIds, canonicalLiveIds)) {
      // With no water source waiting only on newly added thermal capacity, its
      // operations, topology, and allocation cannot change in the final-power
      // pass. Reuse the fully derived water result rather than rebuilding a
      // large pipe graph solely to observe that same allocation.
      const canActivateAnotherWaterSource = water.facilities.some((facility) => (
        !facility.operational
        && !facility.powerAccess
        && facility.roadAccess
        && facility.pipeAccess
        && facility.shoreline
      ));
      if (!canActivateAnotherWaterSource) {
        const finalPower = derivePowerForLivePlants(state, nextLivePlantIds);
        return withPlantOperations(state, plants, finalPower, water, nextLivePlantIds);
      }
      livePlantIds = nextLivePlantIds;
      continue;
    }
    return withPlantOperations(state, plants, power, water, nextLivePlantIds);
  }

  throw new Error(`Market utility resolver did not converge within ${maximumPasses} passes.`);
}
