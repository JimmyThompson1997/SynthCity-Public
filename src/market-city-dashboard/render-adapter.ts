import {
  deriveRenderLots,
  deriveRenderRubble,
} from '../market-city/appearance';
import { deriveFireStationStatus } from '../market-city/fire';
import { deriveCrimeBalance } from '../market-city/crime';
import { MARKET_CITY_RULES } from '../market-city/rules';
import {
  crimeHeightModifier,
  deriveDensityCaps,
  deriveFireStationOperations,
  derivePoliceCoverage,
  derivePoliceStationOperations,
  derivePoliceStationStatus,
  derivePotentialFireCoverage,
  deriveRoadAccess,
} from '../market-city/spatial';
import { deriveMarketDesirability } from '../market-city/simulation';
import { derivePassengerRailService } from '../market-city/transport';
import { deriveUtilities } from '../market-city/utilities';
import { deriveLandfillFillStage, deriveLandfillOperations, type MarketLandfillOperations } from '../market-city/waste';
import {
  MARKET_CITY_MAP_SIZE,
  type MarketCityStateV2,
  type MarketFacilityKind,
  type MarketFireHistoryEntry,
  type MarketFireIncident,
  type MarketPowerPlantOperation,
  type MarketPowerComponentMetrics,
  type MarketRailServiceState,
  type MarketRailShuttleLeg,
  type MarketRailTopologyResult,
  type MarketRenderLot,
  type MarketRenderRubble,
  type MarketTerrainMaterial,
  type MarketWaterComponentMetrics,
  type MarketWaterFacilityOperation,
  type MarketLandfillFillStage,
  type MarketWasteServiceState,
} from '../market-city/types';

const TILE_COUNT = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;
const VERTEX_WIDTH = MARKET_CITY_MAP_SIZE + 1;
const RENDERER_BASELINE_HEIGHT = 2 as const;
const RENDERER_WATER_SURFACE_HEIGHT = 1 as const;

export type SquareGridTerrainSurface = 'land' | 'water';
export type SquareGridTerrainMaterial = 'grass-light' | 'grass-dark' | 'dry-ground' | 'snow';
export type SquareGridZoneKind = 'residential' | 'commercial' | 'industrial';
export type SquareGridNetworkKind = 'road' | 'avenue' | 'rail' | 'subway' | 'power-line' | 'water-pipe';
export type SquareGridNetworkFamily = 'road' | 'rail' | 'subway' | 'power' | 'water';

/**
 * Visual palette adapter for the retained terrain art. Each market material
 * keeps one distinct renderer asset without gaining an economic effect.
 */
export const MARKET_TO_RENDERER_TERRAIN_MATERIAL = Object.freeze({
  grass: 'grass-light',
  earth: 'grass-dark',
  sand: 'dry-ground',
  rock: 'snow',
} satisfies Record<MarketTerrainMaterial, SquareGridTerrainMaterial>);

export interface SquareGridMarketTerrainView {
  baselineHeight: typeof RENDERER_BASELINE_HEIGHT;
  waterSurfaceHeight: typeof RENDERER_WATER_SURFACE_HEIGHT;
  vertexHeights: number[];
  surfaces: SquareGridTerrainSurface[];
  materials: SquareGridTerrainMaterial[];
  treeLevels: number[];
}

export interface SquareGridMarketZoneView {
  kind: SquareGridZoneKind;
}

/** Everything the Public Safety tray needs to show the force and its budget. */
export interface MarketRendererCrimeView {
  share: number;
  targetShare: number;
  funding: number;
  maximumFunding: number;
  fundingStepCost: number;
  monthlyCost: number;
  operationalStations: number;
  heightModifier: number;
  targetHeightModifier: number;
  derelictTileIds: number[];
}

export interface SquareGridMarketFacilityView {
  id: string;
  kind: MarketFacilityKind;
  anchor: { x: number; y: number };
  footprint: number[];
  operational: boolean | null;
  inactiveReason: string | null;
  roadAccess: boolean | null;
  railAccess: boolean | null;
  componentId: string | null;
  attachmentTileIds: number[];
  ridership: number;
  powerAccess: boolean | null;
  waterAccess: boolean | null;
  pipeAccess: boolean | null;
  shoreline: boolean | null;
  waterComponentId: string | null;
  waterAttachmentTileIds: number[];
  rawCapacity: number;
  treatmentCapacity: number;
}

export interface SquareGridMarketGameplayView {
  /** Renderer compatibility values in basis points (0..10,000). */
  density: number[];
  wealth: number[];
  pollution: number[];
  congestion: number[];
  roadAccess: boolean[];
  powered: boolean[];
  watered: boolean[];
}

export interface SquareGridMarketLandfillView {
  tileId: number;
  componentId: string;
  componentTileCount: number;
  roadConnected: boolean;
  componentStoredTenths: number;
  componentCapacityTenths: number;
  componentFreeCapacityTenths: number;
  usableMonthlyIntakeTenths: number;
  storedTenths: number;
  capacityTenths: number;
  fillBasisPoints: number;
  fillPercent: number;
  stage: MarketLandfillFillStage;
}

/**
 * The structural subset consumed by the existing square-grid world renderer,
 * plus the frozen market appearance fields used by its RCI building layer.
 */
export interface SquareGridMarketRendererState {
  cityId: string;
  seed: number;
  month: number;
  paused: boolean;
  width: typeof MARKET_CITY_MAP_SIZE;
  height: typeof MARKET_CITY_MAP_SIZE;
  terrain: SquareGridMarketTerrainView;
  networks: Record<SquareGridNetworkKind, boolean[]>;
  networkConnections: Record<SquareGridNetworkFamily, number[]>;
  /** Canonical, world-relative N=1/E=2/S=4/W=8 direction masks. */
  avenueTravelMasks: number[];
  avenuePairMasks: number[];
  avenueMedianMasks: number[];
  ordinaryRoadConnectionMasks: number[];
  railTopology: MarketRailTopologyResult;
  railService: MarketRailServiceState;
  railShuttleLegs: MarketRailShuttleLeg[];
  zones: Array<SquareGridMarketZoneView | null>;
  landfillZones: boolean[];
  landfills: SquareGridMarketLandfillView[];
  waste: MarketWasteServiceState;
  facilities: SquareGridMarketFacilityView[];
  gameplay: SquareGridMarketGameplayView;
  marketDensityCaps: number[];
  marketHeightCaps: number[];
  marketVerticalDevelopmentLevel: number;
  marketPowerComponentByTile: Array<string | null>;
  marketPowerComponents: MarketPowerComponentMetrics[];
  marketWaterComponentByTile: Array<string | null>;
  marketWaterComponents: MarketWaterComponentMetrics[];
  waterCoverage: Array<string | null>;
  marketDesirability: number[];
  marketRenderedHeights: number[];
  marketRenderLots: MarketRenderLot[];
  marketRenderRubble: MarketRenderRubble[];
  firePotentialCoverage: number[];
  fireStationOperations: ReturnType<typeof deriveFireStationOperations>;
  crime: MarketRendererCrimeView;
  policeCoverage: boolean[];
  policeStationOperations: ReturnType<typeof derivePoliceStationOperations>;
  fireIncidents: MarketFireIncident[];
  fireHistory: MarketFireHistoryEntry[];
}

function tileIndex(x: number, y: number): number {
  return y * MARKET_CITY_MAP_SIZE + x;
}

/**
 * A grid vertex uses every tile touching that corner (one at map corners,
 * two on edges, four inside). Elevation is relative to the retained visual
 * baseline, so a completely flat canonical map remains at renderer height 2.
 */
function deriveVertexHeights(elevation: readonly number[]): number[] {
  const heights = Array<number>(VERTEX_WIDTH * VERTEX_WIDTH).fill(RENDERER_BASELINE_HEIGHT);
  for (let vertexY = 0; vertexY <= MARKET_CITY_MAP_SIZE; vertexY += 1) {
    for (let vertexX = 0; vertexX <= MARKET_CITY_MAP_SIZE; vertexX += 1) {
      let total = 0;
      let adjacent = 0;
      for (const offsetY of [-1, 0] as const) {
        const tileY = vertexY + offsetY;
        if (tileY < 0 || tileY >= MARKET_CITY_MAP_SIZE) continue;
        for (const offsetX of [-1, 0] as const) {
          const tileX = vertexX + offsetX;
          if (tileX < 0 || tileX >= MARKET_CITY_MAP_SIZE) continue;
          total += elevation[tileIndex(tileX, tileY)] ?? 0;
          adjacent += 1;
        }
      }
      heights[vertexY * VERTEX_WIDTH + vertexX] = RENDERER_BASELINE_HEIGHT
        + (adjacent === 0 ? 0 : total / adjacent);
    }
  }
  return heights;
}

/** Existing renderer mask convention: north=1, east=2, south=4, west=8. */
function deriveOrthogonalConnectionMasks(layer: readonly boolean[]): number[] {
  const masks = Array<number>(TILE_COUNT).fill(0);
  for (let id = 0; id < TILE_COUNT; id += 1) {
    if (layer[id] !== true) continue;
    const x = id % MARKET_CITY_MAP_SIZE;
    const y = Math.floor(id / MARKET_CITY_MAP_SIZE);
    let mask = 0;
    if (y > 0 && layer[id - MARKET_CITY_MAP_SIZE] === true) mask |= 1;
    if (x + 1 < MARKET_CITY_MAP_SIZE && layer[id + 1] === true) mask |= 2;
    if (y + 1 < MARKET_CITY_MAP_SIZE && layer[id + MARKET_CITY_MAP_SIZE] === true) mask |= 4;
    if (x > 0 && layer[id - 1] === true) mask |= 8;
    masks[id] = mask;
  }
  return masks;
}

function emptyBooleanLayer(): boolean[] {
  return Array<boolean>(TILE_COUNT).fill(false);
}

function emptyMaskLayer(): number[] {
  return Array<number>(TILE_COUNT).fill(0);
}

function rendererZone(kind: MarketCityStateV2['map']['zones'][number]): SquareGridMarketZoneView | null {
  if (kind === null) return null;
  return { kind: kind === 'R' ? 'residential' : kind === 'C' ? 'commercial' : 'industrial' };
}

function rendererCrime(state: MarketCityStateV2): MarketRendererCrimeView {
  const balance = deriveCrimeBalance(state);
  const rules = MARKET_CITY_RULES.police;
  const derelictTileIds: number[] = [];
  state.crime.derelict.forEach((blighted, tile) => { if (blighted) derelictTileIds.push(tile); });
  return {
    share: state.crime.share,
    targetShare: balance.targetShare,
    funding: state.crime.funding,
    maximumFunding: rules.maximumFunding,
    fundingStepCost: rules.fundingMonthlyExpense,
    // Budget only bills while a force is actually running, exactly as it only
    // buys suppression then. The tray shows the real number, not the intent.
    monthlyCost: balance.operationalStations > 0
      ? state.crime.funding * rules.fundingMonthlyExpense
      : 0,
    operationalStations: balance.operationalStations,
    heightModifier: crimeHeightModifier(state.crime.share),
    targetHeightModifier: crimeHeightModifier(balance.targetShare),
    derelictTileIds,
  };
}

function rendererFacilities(
  state: MarketCityStateV2,
  railTopology: MarketRailTopologyResult,
  waterFacilities: readonly MarketWaterFacilityOperation[],
  powerPlants: readonly MarketPowerPlantOperation[],
): SquareGridMarketFacilityView[] {
  return state.map.facilities.map((facility) => {
    const status = facility.kind === 'fire-station'
      ? deriveFireStationStatus(state, facility)
      : facility.kind === 'police-station'
        ? derivePoliceStationStatus(state, facility)
        : null;
    const railStation = facility.kind === 'train-station'
      ? railTopology.stations.find((station) => station.stationId === facility.id) ?? null
      : null;
    const waterFacility = waterFacilities.find((operation) => operation.id === facility.id) ?? null;
    const powerPlant = powerPlants.find((operation) => operation.id === facility.id) ?? null;
    return {
      id: facility.id,
      kind: facility.kind,
      anchor: {
        x: facility.anchor % MARKET_CITY_MAP_SIZE,
        y: Math.floor(facility.anchor / MARKET_CITY_MAP_SIZE),
      },
      footprint: [...facility.tiles],
      operational: status?.operational ?? railStation?.operational ?? waterFacility?.operational ?? powerPlant?.operational ?? null,
      inactiveReason: status?.inactiveReason ?? railStation?.inactiveReason ?? waterFacility?.inactiveReason ?? powerPlant?.inactiveReason ?? null,
      roadAccess: railStation?.roadAccess ?? waterFacility?.roadAccess ?? powerPlant?.roadAccess ?? null,
      railAccess: railStation?.railAccess ?? null,
      componentId: railStation?.componentId ?? null,
      attachmentTileIds: [...(railStation?.attachmentTileIds ?? [])],
      ridership: railStation?.ridership ?? 0,
      powerAccess: railStation?.powerAccess ?? waterFacility?.powerAccess ?? null,
      waterAccess: railStation?.waterAccess ?? powerPlant?.waterAccess ?? null,
      pipeAccess: waterFacility?.pipeAccess ?? null,
      shoreline: waterFacility?.shoreline ?? null,
      waterComponentId: railStation?.waterComponentId ?? waterFacility?.componentId ?? powerPlant?.waterComponentId ?? null,
      waterAttachmentTileIds: [...(waterFacility?.attachmentTileIds ?? [])],
      rawCapacity: waterFacility?.rawCapacity ?? 0,
      treatmentCapacity: waterFacility?.treatmentCapacity ?? 0,
    };
  });
}

function cloneRailTopology(topology: MarketRailTopologyResult): MarketRailTopologyResult {
  return {
    componentByTile: [...topology.componentByTile],
    components: topology.components.map((component) => ({ ...component, tileIds: [...component.tileIds] })),
    stations: topology.stations.map((station) => ({
      ...station,
      tileIds: [...station.tileIds],
      touchedRailTileIds: [...station.touchedRailTileIds],
      attachmentTileIds: [...station.attachmentTileIds],
    })),
    shuttleLegs: topology.shuttleLegs.map((leg) => ({ ...leg, pathTileIds: [...leg.pathTileIds] })),
  };
}

function cloneRailService(service: MarketRailServiceState): MarketRailServiceState {
  return {
    totalRidership: service.totalRidership,
    tileUsage: [...service.tileUsage],
    stationUsage: service.stationUsage.map((station) => ({ ...station })),
  };
}

function cloneWasteService(service: MarketWasteServiceState): MarketWasteServiceState {
  return {
    generatedThisMonth: service.generatedThisMonth,
    generatedLifetime: service.generatedLifetime,
    landfilledThisMonth: service.landfilledThisMonth,
    landfilledLifetime: service.landfilledLifetime,
    unmanagedThisMonth: service.unmanagedThisMonth,
    unmanagedLifetime: service.unmanagedLifetime,
    storedByTile: [...service.storedByTile],
  };
}

function rendererLandfills(
  state: MarketCityStateV2,
  operations: MarketLandfillOperations,
): SquareGridMarketLandfillView[] {
  const capacityTenths = MARKET_CITY_RULES.waste.cellStorageCapacity;
  const result: SquareGridMarketLandfillView[] = [];
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (state.map.landfillZones[tile] !== true) continue;
    const componentId = operations.componentByTile[tile];
    const component = componentId === null || componentId === undefined
      ? undefined
      : operations.components.find(({ id }) => id === componentId);
    if (component === undefined) throw new Error(`Landfill tile ${tile} has no derived component.`);
    const storedTenths = state.services.waste.storedByTile[tile] ?? 0;
    result.push({
      tileId: tile,
      componentId: component.id,
      componentTileCount: component.tileIds.length,
      roadConnected: component.roadConnected,
      componentStoredTenths: component.storedTenths,
      componentCapacityTenths: component.capacityTenths,
      componentFreeCapacityTenths: component.freeCapacityTenths,
      usableMonthlyIntakeTenths: component.usableMonthlyIntakeTenths,
      storedTenths,
      capacityTenths,
      fillBasisPoints: Math.round(storedTenths / capacityTenths * 10_000),
      fillPercent: storedTenths / capacityTenths * 100,
      stage: deriveLandfillFillStage(storedTenths),
    });
  }
  return result;
}

function cloneRenderLots(lots: readonly MarketRenderLot[]): MarketRenderLot[] {
  return lots.map((lot) => ({
    ...lot,
    tileIds: [...lot.tileIds],
    color: [...lot.color] as [number, number, number],
  }));
}

function cloneIncidents(incidents: readonly MarketFireIncident[]): MarketFireIncident[] {
  return incidents.map((incident) => ({
    ...incident,
    tileIds: [...incident.tileIds],
    structure: { ...incident.structure, color: [...incident.structure.color] },
  }));
}

/**
 * One-way, immutable adapter from canonical simulation state to renderer data.
 * No renderer edit can alias back into the city or influence a later month.
 */
export function toSquareGridRendererState(state: MarketCityStateV2): SquareGridMarketRendererState {
  if (state.map.size !== MARKET_CITY_MAP_SIZE) {
    throw new RangeError(`Square-grid rendering requires a ${MARKET_CITY_MAP_SIZE}x${MARKET_CITY_MAP_SIZE} market city.`);
  }

  const road = [...state.map.roads];
  const avenue = [...state.map.avenueLanes];
  const rail = [...state.map.rails];
  const powerLine = [...state.map.powerLines];
  const utilities = deriveUtilities(state);
  const currentPower = utilities.power;
  const currentWater = utilities.water;
  const passengerRail = derivePassengerRailService(state, currentPower, currentWater);
  const railTopology = cloneRailTopology(passengerRail.topology);
  const railService = cloneRailService(passengerRail.service);
  const currentRoadAccess = deriveRoadAccess(state);
  const densityCaps = deriveDensityCaps(state);
  const desirability = deriveMarketDesirability(state);
  const renderLots = deriveRenderLots(state, densityCaps.densityCaps);
  const renderRubble = deriveRenderRubble(state);
  const landfills = rendererLandfills(state, deriveLandfillOperations(state));
  const renderedHeights = Array<number>(TILE_COUNT).fill(0);
  for (const lot of renderLots) {
    for (const tile of lot.tileIds) renderedHeights[tile] = lot.height;
  }

  return {
    cityId: state.identity.cityId,
    seed: state.identity.seed,
    month: state.clock.month,
    paused: state.clock.paused,
    width: MARKET_CITY_MAP_SIZE,
    height: MARKET_CITY_MAP_SIZE,
    terrain: {
      baselineHeight: RENDERER_BASELINE_HEIGHT,
      waterSurfaceHeight: RENDERER_WATER_SURFACE_HEIGHT,
      vertexHeights: deriveVertexHeights(state.map.terrain.elevation),
      surfaces: state.map.terrain.water.map((water) => water ? 'water' : 'land'),
      materials: state.map.terrain.material.map((material) => MARKET_TO_RENDERER_TERRAIN_MATERIAL[material]),
      treeLevels: [...state.map.terrain.trees],
    },
    networks: {
      road,
      avenue,
      rail,
      subway: [...state.map.subways],
      'power-line': powerLine,
      'water-pipe': [...state.map.waterPipes],
    },
    networkConnections: {
      road: [...state.map.roadConnectionMasks],
      rail: [...state.map.railConnectionMasks],
      subway: [...state.map.subwayConnectionMasks],
      power: deriveOrthogonalConnectionMasks(powerLine),
      water: [...currentWater.connectionMasks],
    },
    avenueTravelMasks: [...state.map.avenueTravelMasks],
    avenuePairMasks: [...state.map.avenuePairMasks],
    avenueMedianMasks: [...state.map.avenueMedianMasks],
    ordinaryRoadConnectionMasks: [...state.map.roadConnectionMasks],
    railTopology,
    railService,
    railShuttleLegs: railTopology.shuttleLegs.map((leg) => ({ ...leg, pathTileIds: [...leg.pathTileIds] })),
    zones: state.map.zones.map(rendererZone),
    landfillZones: [...state.map.landfillZones],
    landfills,
    waste: cloneWasteService(state.services.waste),
    facilities: rendererFacilities(state, railTopology, currentWater.facilities, currentPower.plantOperations),
    gameplay: {
      density: state.economy.density.map((value) => value * 10_000),
      wealth: state.economy.wealth.map((value) => value / MARKET_CITY_RULES.maximumIncome * 10_000),
      pollution: state.environment.pollution.map((value) => value * 100),
      congestion: state.environment.congestion.map((value) => value * 10_000),
      roadAccess: currentRoadAccess,
      powered: [...currentPower.powered],
      watered: [...currentWater.watered],
    },
    marketDensityCaps: [...densityCaps.densityCaps],
    marketHeightCaps: [...densityCaps.heightCaps],
    marketVerticalDevelopmentLevel: state.market.verticalDevelopmentLevel,
    marketPowerComponentByTile: [...currentPower.componentByTile],
    marketPowerComponents: currentPower.components.map((component) => ({
      ...component,
      livePlantIds: [...component.livePlantIds],
    })),
    marketWaterComponentByTile: [...currentWater.componentByTile],
    marketWaterComponents: currentWater.components.map((component) => ({ ...component })),
    waterCoverage: [...currentWater.coverageByTile],
    marketDesirability: [...desirability],
    marketRenderedHeights: renderedHeights,
    marketRenderLots: cloneRenderLots(renderLots),
    marketRenderRubble: renderRubble.map((rubble) => ({
      ...rubble,
      tileIds: [...rubble.tileIds],
      structure: { ...rubble.structure, color: [...rubble.structure.color] },
    })),
    firePotentialCoverage: derivePotentialFireCoverage(state),
    crime: rendererCrime(state),
    policeCoverage: derivePoliceCoverage(state),
    policeStationOperations: derivePoliceStationOperations(state, currentPower.powered).map((station) => ({
      ...station,
      tileIds: [...station.tileIds],
    })),
    fireStationOperations: deriveFireStationOperations(state, currentPower.powered).map((station) => ({
      ...station,
      tileIds: [...station.tileIds],
    })),
    fireIncidents: cloneIncidents(state.fire.incidents),
    fireHistory: state.fire.history.map((entry) => ({ ...entry, tileIds: [...entry.tileIds] })),
  };
}
