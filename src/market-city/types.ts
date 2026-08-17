export const MARKET_CITY_SCHEMA_VERSION_V1 = 1 as const;
export const MARKET_CITY_RULES_VERSION_V1 = 'claude-market-1.0.0' as const;
export const MARKET_CITY_RULES_VERSION_V2_ARRAY_FIRE = 'claude-market-2.0.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_WATER = 'claude-market-2.1.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_WASTE = 'claude-market-2.2.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT = 'claude-market-2.3.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS = 'claude-market-2.4.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT = 'claude-market-2.5.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_SUBWAY = 'claude-market-2.6.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY = 'claude-market-2.7.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS = 'claude-market-2.8.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE = 'claude-market-2.9.0' as const;
export const MARKET_CITY_SCHEMA_VERSION = 2 as const;
export const MARKET_CITY_RULES_VERSION_PRE_CRIME = 'claude-market-2.10.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES = 'claude-market-2.11.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING = 'claude-market-2.12.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING = 'claude-market-2.13.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING = 'claude-market-2.14.0' as const;
export const MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES = 'claude-market-2.15.0' as const;
export const MARKET_CITY_RULES_VERSION = 'claude-market-2.16.0' as const;
export const MARKET_CITY_MAP_SIZE = 48 as const;

export type MarketZoneKind = 'R' | 'C' | 'I';
export type MarketFireDifficulty = 'easy' | 'normal' | 'hard';
export type MarketPlaybackSpeed = 0 | 1 | 2 | 3;
export type MarketTerrainMaterial = 'grass' | 'earth' | 'sand' | 'rock';
export type MarketFacilityKindV1 =
  | 'coal-power-plant'
  | 'gas-power-plant'
  | 'nuclear-power-plant'
  | 'wind-turbine'
  | 'solar-plant'
  | 'fire-station';

export type MarketPowerPlantKind = Exclude<MarketFacilityKindV1, 'fire-station'>;

export type MarketFacilityKind =
  | MarketFacilityKindV1
  | 'police-station'
  | 'water-tower'
  | 'coastal-water-pump'
  | 'water-treatment-plant'
  | 'train-station'
  | 'subway-station';

export interface MarketCityIdentity {
  cityId: string;
  cityName: string;
  mayorName: string;
  seed: number;
  createdAt: string;
}

export interface MarketCityClock {
  month: number;
  paused: boolean;
  speed: MarketPlaybackSpeed;
  fireDifficulty: MarketFireDifficulty;
}

export interface MarketCityTerrain {
  water: boolean[];
  elevation: number[];
  material: MarketTerrainMaterial[];
  trees: number[];
}

export interface MarketFacilityV1 {
  id: string;
  kind: MarketFacilityKindV1;
  anchor: number;
  tiles: number[];
}

export interface MarketFacility extends Omit<MarketFacilityV1, 'kind'> {
  kind: MarketFacilityKind;
}

export interface MarketCityMapV1 {
  size: typeof MARKET_CITY_MAP_SIZE;
  terrain: MarketCityTerrain;
  zones: Array<MarketZoneKind | null>;
  roads: boolean[];
  /** Explicit player-drawn road links. Adjacent asphalt is not implicitly connected. */
  roadConnectionMasks: number[];
  powerLines: boolean[];
  facilities: MarketFacilityV1[];
}

export interface MarketCityMap extends Omit<MarketCityMapV1, 'facilities'> {
  avenueLanes: boolean[];
  avenueTravelMasks: number[];
  avenuePairMasks: number[];
  /** Yellow median edges painted when each lane was originally built. */
  avenueMedianMasks: number[];
  rails: boolean[];
  railConnectionMasks: number[];
  subways: boolean[];
  subwayConnectionMasks: number[];
  waterPipes: boolean[];
  landfillZones: boolean[];
  facilities: MarketFacility[];
}

export interface MarketCityEconomy {
  density: number[];
  wealth: number[];
  treasury: number;
  lastRevenue: number;
  lastOperatingExpense: number;
  lastNet: number;
}

export interface MarketCityEnvironment {
  pollution: number[];
  congestion: number[];
  roadAccess: boolean[];
  powered: boolean[];
  watered: boolean[];
}

export type MarketCityEnvironmentV1 = Omit<MarketCityEnvironment, 'watered'>;

export interface MarketWaterComponentMetrics {
  id: string;
  rawCapacity: number;
  treatmentCapacity: number;
  usableCapacity: number;
  demand: number;
  allocated: number;
}

export interface MarketWaterServiceState {
  componentByTile: Array<string | null>;
  components: MarketWaterComponentMetrics[];
  totalDemand: number;
  totalAllocated: number;
}

export type MarketWaterFacilityKind = Extract<
  MarketFacilityKind,
  'water-tower' | 'coastal-water-pump' | 'water-treatment-plant'
>;

export interface MarketWaterFacilityOperation {
  id: string;
  kind: MarketWaterFacilityKind;
  anchor: number;
  tileIds: number[];
  roadAccess: boolean;
  powerAccess: boolean;
  pipeAccess: boolean;
  shoreline: boolean;
  attachmentTileIds: number[];
  componentId: string | null;
  operational: boolean;
  inactiveReason: string | null;
  rawCapacity: number;
  treatmentCapacity: number;
}

/** Water reservation assigned to one thermal plant by the canonical utility pass. */
export interface MarketThermalPlantWaterOperation {
  id: string;
  anchor: number;
  tileIds: number[];
  demand: number;
  componentId: string | null;
  waterAccess: boolean;
}

/** Derived power-facility status; never persisted in a city save. */
export interface MarketPowerPlantOperation {
  id: string;
  kind: MarketPowerPlantKind;
  anchor: number;
  tileIds: number[];
  roadRequired: boolean;
  waterDemand: number;
  roadAccess: boolean | null;
  waterAccess: boolean | null;
  waterComponentId: string | null;
  operational: boolean;
  inactiveReason: string | null;
}

export interface MarketWaterResult {
  componentByTile: Array<string | null>;
  connectionMasks: number[];
  components: MarketWaterComponentMetrics[];
  facilities: MarketWaterFacilityOperation[];
  thermalPlants: MarketThermalPlantWaterOperation[];
  coverageByTile: Array<string | null>;
  watered: boolean[];
  service: MarketWaterServiceState;
}

export interface MarketRailStationUsage {
  stationId: string;
  ridership: number;
}

export interface MarketRailServiceState {
  totalRidership: number;
  tileUsage: number[];
  stationUsage: MarketRailStationUsage[];
}

export interface MarketRailPathTile {
  tileId: number;
  connectionMask: number;
}

export type MarketRailPathResult =
  | { ok: true; tileIds: number[]; tiles: MarketRailPathTile[] }
  | { ok: false; reason: string };

export interface MarketRailComponent {
  id: string;
  tileIds: number[];
}

export interface MarketRailStationOperation {
  stationId: string;
  anchor: number;
  tileIds: number[];
  roadAccess: boolean;
  railAccess: boolean;
  powerAccess: boolean;
  waterAccess: boolean;
  touchedRailTileIds: number[];
  attachmentTileIds: number[];
  componentId: string | null;
  waterComponentId: string | null;
  operational: boolean;
  inactiveReason: string | null;
  residents: number;
  jobs: number;
  ridership: number;
}

export interface MarketRailShuttleLeg {
  id: string;
  componentId: string;
  stationAId: string;
  stationBId: string;
  pathTileIds: number[];
  pathLength: number;
  ridership: number;
}

export interface MarketRailTopologyResult {
  componentByTile: Array<string | null>;
  components: MarketRailComponent[];
  stations: MarketRailStationOperation[];
  shuttleLegs: MarketRailShuttleLeg[];
}

export interface MarketPassengerRailResult {
  topology: MarketRailTopologyResult;
  service: MarketRailServiceState;
}

export interface MarketWasteServiceState {
  generatedThisMonth: number;
  generatedLifetime: number;
  landfilledThisMonth: number;
  landfilledLifetime: number;
  unmanagedThisMonth: number;
  unmanagedLifetime: number;
  storedByTile: number[];
}

export interface MarketCityServices {
  water: MarketWaterServiceState;
  rail: MarketRailServiceState;
  waste: MarketWasteServiceState;
}

export type MarketFireIncidentStatus = 'burning' | 'rubble';
export type MarketFireHistoryEvent =
  | 'ignited'
  | 'burning'
  | 'suppressed'
  | 'collapsed'
  | 'rubble-cleared';

export interface MarketBuildingStructure {
  footprint: MarketLotFootprint;
  originTile: number;
  height: number;
  roof: MarketRoofKind;
  roofHeight: number;
  roofOrientation: number;
  detail: MarketBuildingDetail;
  color: [number, number, number];
  landmark: boolean;
}

export interface MarketFireIncident {
  id: string;
  status: MarketFireIncidentStatus;
  tileIds: number[];
  zone: MarketZoneKind;
  startedMonth: number;
  structure: MarketBuildingStructure;
  intensity: number;
  damage: number;
  age: number;
  rubbleMonthsRemaining: number;
}

export interface MarketFireHistoryEntry {
  sequence: number;
  month: number;
  incidentId: string;
  event: MarketFireHistoryEvent;
  tileIds: number[];
  zone: MarketZoneKind;
  intensity: number;
  damage: number;
  rubbleMonthsRemaining: number;
}

export interface MarketCityFire {
  incidents: MarketFireIncident[];
  char: number[];
  collapsedTotal: number;
  suppressedTotal: number;
  history: MarketFireHistoryEntry[];
}

export interface MarketCityArrayFire {
  intensity: number[];
  damage: number[];
  age: number[];
  char: number[];
  collapsedTotal: number;
}

export interface MarketSectorValues {
  R: number;
  C: number;
  I: number;
}

export interface MarketCityMarket {
  demand: MarketSectorValues;
  margin: MarketSectorValues;
  /** Global player-controlled base story cap, persisted as an integer from 1 through 10. */
  verticalDevelopmentLevel: number;
}

export interface MarketCityCrime {
  /** Per-tile derelict flag. A derelict is a live building in a bad state. */
  derelict: boolean[];
  /** Live citywide derelict share, 0..1. This is the displayed crime rate. */
  share: number;
  /** Where the share is heading under current funding. */
  targetShare: number;
  /** Player-set force funding, in multiples of the base station allotment. */
  funding: number;
  tippedTotal: number;
  recoveredTotal: number;
}

export interface MarketCityStateV2 {
  schemaVersion: typeof MARKET_CITY_SCHEMA_VERSION;
  rulesVersion: typeof MARKET_CITY_RULES_VERSION;
  identity: MarketCityIdentity;
  clock: MarketCityClock;
  map: MarketCityMap;
  economy: MarketCityEconomy;
  environment: MarketCityEnvironment;
  fire: MarketCityFire;
  crime: MarketCityCrime;
  market: MarketCityMarket;
  services: MarketCityServices;
}

export interface MarketCityStateV1 {
  schemaVersion: typeof MARKET_CITY_SCHEMA_VERSION_V1;
  rulesVersion: typeof MARKET_CITY_RULES_VERSION_V1;
  identity: MarketCityIdentity;
  clock: MarketCityClock;
  map: MarketCityMapV1;
  economy: MarketCityEconomy;
  environment: MarketCityEnvironmentV1;
  fire: MarketCityArrayFire;
  market: MarketCityMarket;
}

export type MarketCityState = MarketCityStateV2;

export type MarketCityPaintTerrainCommand =
  | { type: 'paint-terrain'; tileIds: number[]; material: MarketTerrainMaterial; water?: boolean }
  | { type: 'paint-terrain'; tileIds: number[]; material?: MarketTerrainMaterial; water: boolean };

export type MarketCityWorldCommand =
  | { type: 'zone'; tileIds: number[]; zone: MarketZoneKind }
  | { type: 'dezone'; tileIds: number[] }
  | { type: 'demolish'; tileIds: number[]; layer?: 'surface' | 'underground' }
  | { type: 'place-road'; path: number[] }
  /** Direct fixture/import paint has no implied topology; interactive roads use path. */
  | { type: 'place-road'; tileIds: number[] }
  | { type: 'place-avenue'; path: number[]; expansionSide: 'left' | 'right' }
  | { type: 'place-rail'; path: number[] }
  | { type: 'place-subway'; path: number[] }
  | { type: 'place-power-line'; tileIds: number[] }
  | { type: 'place-water-pipe'; tileIds: number[] }
  | { type: 'zone-landfill'; tileIds: number[] }
  | { type: 'place-facility'; kind: MarketFacilityKind; anchor: number }
  | MarketCityPaintTerrainCommand
  | { type: 'adjust-trees'; tileIds: number[]; delta: number }
  | { type: 'set-elevation'; tileIds: number[]; elevation: number }
  | { type: 'adjust-elevation'; tileIds: number[]; delta: number }
  | { type: 'set-crime-funding'; funding: number }
  | { type: 'reset-elevation' };

export interface MarketCityCommandResult {
  ok: boolean;
  state: MarketCityStateV2;
  changedTileIds: number[];
  reason?: string;
}

export interface MarketSectorView {
  have: number;
  want: number;
  gap: number;
  bar: number;
  margin: number;
  availableCapacity: number;
}

export interface MarketPowerComponentMetrics {
  id: string;
  livePlantIds: string[];
  capacity: number;
  demand: number;
  allocated: number;
  remaining: number;
  constrained: boolean;
  utilization: number;
}

export interface MarketFacilityOperationalStatus {
  operational: boolean;
  inactiveReason: string | null;
}

export interface MarketView {
  R: MarketSectorView;
  C: MarketSectorView;
  I: MarketSectorView;
  population: number;
  powerLoad: number;
  powerAllocatedLoad: number;
  powerUnservedLoad: number;
  livePowerCapacity: number;
  powerHeadroom: number;
  powerConstrainedComponentCount: number;
}

export interface MarketTileInspection {
  tileId: number;
  x: number;
  y: number;
  zone: MarketZoneKind | null;
  density: number;
  targetDensity: number;
  desirability: number;
  densityCap: number;
  heightCap: number;
  renderedHeight: number;
  road: boolean;
  avenueLane: boolean;
  avenueTravelMask: number;
  avenuePairMask: number;
  roadSurface: boolean;
  rail: boolean;
  railConnectionMask: number;
  railComponentId: string | null;
  railRidership: number;
  subway: boolean;
  subwayConnectionMask: number;
  stationRailComponentId: string | null;
  stationRailAttachmentTileIds: number[];
  stationRidership: number;
  powerLine: boolean;
  waterPipe: boolean;
  waterConnectionMask: number;
  waterComponentId: string | null;
  waterCoverageComponentId: string | null;
  watered: boolean;
  waterComponentRawCapacity: number;
  waterComponentTreatmentCapacity: number;
  waterComponentUsableCapacity: number;
  waterComponentDemand: number;
  waterComponentAllocated: number;
  waterComponentRemaining: number;
  facilityWaterComponentId: string | null;
  facilityWaterAttachmentTileIds: number[];
  landfillZone: boolean;
  landfillStoredTenths: number;
  landfillCapacityTenths: number;
  landfillFillBasisPoints: number;
  landfillFillPercent: number;
  landfillStage: MarketLandfillFillStage | null;
  landfillComponentId: string | null;
  landfillComponentTileCount: number;
  landfillRoadConnected: boolean | null;
  landfillComponentStoredTenths: number;
  landfillComponentCapacityTenths: number;
  landfillComponentFreeCapacityTenths: number;
  landfillComponentUsableMonthlyIntakeTenths: number;
  wasteGeneratedThisMonth: number;
  wasteGeneratedLifetime: number;
  wasteLandfilledThisMonth: number;
  wasteLandfilledLifetime: number;
  wasteUnmanagedThisMonth: number;
  wasteUnmanagedLifetime: number;
  facility: Readonly<Pick<MarketFacility, 'id' | 'kind' | 'anchor'>> | null;
  facilityOperational: boolean | null;
  facilityInactiveReason: string | null;
  roadAccess: boolean;
  powered: boolean;
  powerComponentId: string | null;
  powerComponentCapacity: number;
  powerComponentDemand: number;
  powerComponentAllocated: number;
  powerComponentRemaining: number;
  powerComponentConstrained: boolean;
  wealth: number;
  pollution: number;
  congestion: number;
  fireIntensity: number;
  fireDamage: number;
  char: number;
  fireIncidentId: string | null;
  fireStatus: MarketFireIncidentStatus | null;
  fireAge: number;
  fireStartedMonth: number | null;
  fireSuppression: number;
  rubbleMonthsRemaining: number;
  fireLocked: boolean;
}

export type MarketLandfillFillStage = 'empty' | 'scattered' | 'low' | 'medium' | 'high' | 'full';

export type MarketRoofKind =
  | 'flat'
  | 'gable'
  | 'pyramid'
  | 'wedge'
  | 'mech'
  | 'core'
  | 'steps'
  | 'parapet'
  | 'sawtooth'
  | 'cylinder'
  | 'vents'
  | 'silos'
  | 'stack'
  | 'spire';

export type MarketBuildingDetail = 'door' | 'windows' | 'curtain' | 'bay' | null;
export type MarketLotFootprint = '1x1' | '1x2' | '2x1' | '2x2' | 'L';

export interface MarketRenderLot {
  id: string;
  tileIds: number[];
  zone: MarketZoneKind;
  height: number;
  footprint: MarketLotFootprint;
  roof: MarketRoofKind;
  roofHeight: number;
  roofOrientation: number;
  detail: MarketBuildingDetail;
  color: readonly [number, number, number];
  landmark: boolean;
  incidentId: string | null;
  fireIntensity: number;
  fireDamage: number;
  fireAge: number;
  char: number;
  plume: number;
}

export interface MarketRenderRubble {
  id: string;
  incidentId: string;
  tileIds: number[];
  zone: MarketZoneKind;
  structure: MarketBuildingStructure;
  char: number;
  rubbleMonthsRemaining: number;
}
