import { clamp, indexToCoordinate } from './math';
import { deriveBuildingHeights } from './appearance';
import { deriveIncidentSuppression, fireIncidentAtTile } from './fire';
import { MARKET_CITY_RULES, MARKET_ZONE_KINDS } from './rules';
import { deriveMarketDesirability } from './simulation';
import { deriveRailTopology } from './transport';
import { deriveUtilities } from './utilities';
import { deriveLandfillFillStage, deriveLandfillOperations } from './waste';
import {
  deriveDensityCaps,
  deriveFireStationOperations,
  deriveRoadAccess,
  hasFacilityRoadAccess,
  isRoadSurface,
} from './spatial';
import type {
  MarketCityStateV2,
  MarketSectorValues,
  MarketTileInspection,
  MarketView,
} from './types';

export { hashDeterministicState } from './state';

function sectorStocks(state: MarketCityStateV2): MarketSectorValues {
  const stocks: MarketSectorValues = { R: 0, C: 0, I: 0 };
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    const zone = state.map.zones[tile];
    if (zone !== null && zone !== undefined) stocks[zone] += state.economy.density[tile] ?? 0;
  }
  return stocks;
}

/** Current RCI gaps and infrastructure readouts. These values never drive growth. */
export function deriveMarketView(state: MarketCityStateV2): MarketView {
  const stocks = sectorStocks(state);
  const utilities = deriveUtilities(state);
  const power = utilities.power;
  const water = utilities.water;
  const roadAccess = deriveRoadAccess(state);
  const { densityCaps } = deriveDensityCaps(state);
  const availableCapacity: MarketSectorValues = { R: 0, C: 0, I: 0 };

  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    const zone = state.map.zones[tile];
    if (zone === null || zone === undefined
      || !roadAccess[tile]
      || !power.powered[tile]
      || !water.watered[tile]) continue;
    availableCapacity[zone] += densityCaps[tile] ?? 0;
  }

  const view = {} as Pick<MarketView, 'R' | 'C' | 'I'>;
  for (const sector of MARKET_ZONE_KINDS) {
    const have = stocks[sector];
    const want = state.market.demand[sector];
    const gap = want - have;
    view[sector] = {
      have,
      want,
      gap,
      bar: clamp(gap / Math.max(want, have, 0.01), -1, 1),
      margin: state.market.margin[sector],
      availableCapacity: availableCapacity[sector],
    };
  }

  return {
    ...view,
    population: stocks.R * MARKET_CITY_RULES.peoplePerDensity,
    powerLoad: power.load,
    powerAllocatedLoad: power.allocatedLoad,
    powerUnservedLoad: power.unservedLoad,
    livePowerCapacity: power.liveCapacity,
    powerHeadroom: power.headroom,
    powerConstrainedComponentCount: power.constrainedComponentCount,
  };
}

/** Explain every market-relevant value for one simulation cell. */
export function deriveTileInspection(state: MarketCityStateV2, tileId: number): MarketTileInspection {
  const { x, y } = indexToCoordinate(tileId, state.map.size);
  const roadAccess = deriveRoadAccess(state);
  const utilities = deriveUtilities(state);
  const power = utilities.power;
  const water = utilities.water;
  const { densityCaps, heightCaps } = deriveDensityCaps(state);
  const desirability = deriveMarketDesirability(state);
  const renderedHeights = deriveBuildingHeights(state, densityCaps);
  const zone = state.map.zones[tileId] ?? null;
  const served = zone !== null
    && roadAccess[tileId]
    && power.powered[tileId]
    && water.watered[tileId];
  const incident = fireIncidentAtTile(state, tileId);
  const targetDensity = zone === null || !served || incident?.status === 'rubble'
    ? 0
    : (densityCaps[tileId] ?? 0) * clamp(
      ((desirability[tileId] ?? 0) - state.market.margin[zone]) / MARKET_CITY_RULES.marketShape,
      0,
      1,
    );
  const density = state.economy.density[tileId] ?? 0;
  const suppression = incident?.status === 'burning'
    ? deriveIncidentSuppression(state).get(incident.id) ?? 0
    : 0;
  const facility = state.map.facilities.find(({ tiles }) => tiles.includes(tileId));
  const railTopology = deriveRailTopology(state);
  const stationStatus = facility?.kind === 'train-station'
    ? railTopology.stations.find(({ stationId }) => stationId === facility.id) ?? null
    : null;
  const waterFacilityStatus = facility === undefined
    ? null
    : water.facilities.find(({ id }) => id === facility.id) ?? null;
  const facilityStatus = facility?.kind === 'fire-station'
    ? deriveFireStationOperations(state, power.powered).find(({ id }) => id === facility.id) ?? null
    : stationStatus ?? waterFacilityStatus;
  const powerComponentId = power.componentByTile[tileId] ?? null;
  const powerComponent = powerComponentId === null
    ? undefined
    : power.components.find(({ id }) => id === powerComponentId);
  const waterComponentId = water.componentByTile[tileId] ?? null;
  const waterCoverageComponentId = water.coverageByTile[tileId] ?? null;
  const effectiveWaterComponentId = waterComponentId ?? waterCoverageComponentId;
  const waterComponent = effectiveWaterComponentId === null
    ? undefined
    : water.components.find(({ id }) => id === effectiveWaterComponentId);
  const landfillZone = state.map.landfillZones[tileId] ?? false;
  const landfillStoredTenths = state.services.waste.storedByTile[tileId] ?? 0;
  const landfillCapacityTenths = MARKET_CITY_RULES.waste.cellStorageCapacity;
  const landfillOperations = deriveLandfillOperations(state);
  const landfillComponentId = landfillOperations.componentByTile[tileId] ?? null;
  const landfillComponent = landfillComponentId === null
    ? undefined
    : landfillOperations.components.find(({ id }) => id === landfillComponentId);

  return {
    tileId,
    x,
    y,
    zone,
    density,
    targetDensity,
    desirability: desirability[tileId] ?? 0,
    densityCap: densityCaps[tileId] ?? 0,
    heightCap: heightCaps[tileId] ?? 0,
    renderedHeight: incident?.status === 'burning'
      ? incident.structure.height
      : incident?.status === 'rubble'
        ? 0
        : renderedHeights[tileId] ?? 0,
    road: state.map.roads[tileId] ?? false,
    avenueLane: state.map.avenueLanes[tileId] ?? false,
    avenueTravelMask: state.map.avenueTravelMasks[tileId] ?? 0,
    avenuePairMask: state.map.avenuePairMasks[tileId] ?? 0,
    roadSurface: isRoadSurface(state, tileId),
    rail: state.map.rails[tileId] ?? false,
    railConnectionMask: state.map.railConnectionMasks[tileId] ?? 0,
    railComponentId: railTopology.componentByTile[tileId] ?? null,
    railRidership: state.services.rail.tileUsage[tileId] ?? 0,
    subway: state.map.subways[tileId] ?? false,
    subwayConnectionMask: state.map.subwayConnectionMasks[tileId] ?? 0,
    stationRailComponentId: stationStatus?.componentId ?? null,
    stationRailAttachmentTileIds: [...(stationStatus?.attachmentTileIds ?? [])],
    stationRidership: stationStatus?.ridership ?? 0,
    powerLine: state.map.powerLines[tileId] ?? false,
    waterPipe: state.map.waterPipes[tileId] ?? false,
    waterConnectionMask: water.connectionMasks[tileId] ?? 0,
    waterComponentId,
    waterCoverageComponentId,
    watered: water.watered[tileId] ?? false,
    waterComponentRawCapacity: waterComponent?.rawCapacity ?? 0,
    waterComponentTreatmentCapacity: waterComponent?.treatmentCapacity ?? 0,
    waterComponentUsableCapacity: waterComponent?.usableCapacity ?? 0,
    waterComponentDemand: waterComponent?.demand ?? 0,
    waterComponentAllocated: waterComponent?.allocated ?? 0,
    waterComponentRemaining: Math.max(
      0,
      (waterComponent?.usableCapacity ?? 0) - (waterComponent?.allocated ?? 0),
    ),
    facilityWaterComponentId: waterFacilityStatus?.componentId ?? null,
    facilityWaterAttachmentTileIds: [...(waterFacilityStatus?.attachmentTileIds ?? [])],
    landfillZone,
    landfillStoredTenths,
    landfillCapacityTenths,
    landfillFillBasisPoints: Math.round(landfillStoredTenths / landfillCapacityTenths * 10_000),
    landfillFillPercent: landfillStoredTenths / landfillCapacityTenths * 100,
    landfillStage: landfillZone ? deriveLandfillFillStage(landfillStoredTenths) : null,
    landfillComponentId,
    landfillComponentTileCount: landfillComponent?.tileIds.length ?? 0,
    landfillRoadConnected: landfillComponent?.roadConnected ?? null,
    landfillComponentStoredTenths: landfillComponent?.storedTenths ?? 0,
    landfillComponentCapacityTenths: landfillComponent?.capacityTenths ?? 0,
    landfillComponentFreeCapacityTenths: landfillComponent?.freeCapacityTenths ?? 0,
    landfillComponentUsableMonthlyIntakeTenths: landfillComponent?.usableMonthlyIntakeTenths ?? 0,
    wasteGeneratedThisMonth: state.services.waste.generatedThisMonth,
    wasteGeneratedLifetime: state.services.waste.generatedLifetime,
    wasteLandfilledThisMonth: state.services.waste.landfilledThisMonth,
    wasteLandfilledLifetime: state.services.waste.landfilledLifetime,
    wasteUnmanagedThisMonth: state.services.waste.unmanagedThisMonth,
    wasteUnmanagedLifetime: state.services.waste.unmanagedLifetime,
    facility: facility === undefined
      ? null
      : { id: facility.id, kind: facility.kind, anchor: facility.anchor },
    facilityOperational: facilityStatus?.operational ?? null,
    facilityInactiveReason: facilityStatus?.inactiveReason ?? null,
    roadAccess: facility === undefined
      ? roadAccess[tileId] ?? false
      : hasFacilityRoadAccess(state, facility),
    powered: power.powered[tileId] ?? false,
    powerComponentId,
    powerComponentCapacity: powerComponent?.capacity ?? 0,
    powerComponentDemand: powerComponent?.demand ?? 0,
    powerComponentAllocated: powerComponent?.allocated ?? 0,
    powerComponentRemaining: powerComponent?.remaining ?? 0,
    powerComponentConstrained: powerComponent?.constrained ?? false,
    wealth: state.economy.wealth[tileId] ?? 0,
    pollution: state.environment.pollution[tileId] ?? 0,
    congestion: state.environment.congestion[tileId] ?? 0,
    fireIntensity: incident?.intensity ?? 0,
    fireDamage: incident?.damage ?? 0,
    char: state.fire.char[tileId] ?? 0,
    fireIncidentId: incident?.id ?? null,
    fireStatus: incident?.status ?? null,
    fireAge: incident?.age ?? 0,
    fireStartedMonth: incident?.startedMonth ?? null,
    fireSuppression: suppression,
    rubbleMonthsRemaining: incident?.rubbleMonthsRemaining ?? 0,
    fireLocked: incident !== undefined,
  };
}
