import { MARKET_CITY_RULES, MARKET_ZONE_KINDS, isPowerPlant } from './rules';
import { derivePower } from './spatial';
import { derivePassengerRailService } from './transport';
import { deriveUtilities } from './utilities';
import { deriveWaterService } from './water';
import {
  MARKET_CITY_MAP_SIZE,
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_RULES_VERSION_V1,
  MARKET_CITY_RULES_VERSION_V2_ARRAY_FIRE,
  MARKET_CITY_RULES_VERSION_PRE_WATER,
  MARKET_CITY_RULES_VERSION_PRE_WASTE,
  MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT,
  MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS,
  MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT,
  MARKET_CITY_RULES_VERSION_PRE_SUBWAY,
  MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY,
  MARKET_CITY_RULES_VERSION_PRE_CRIME,
  MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING,
  MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES,
  MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING,
  MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING,
  MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES,
  MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS,
  MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE,
  MARKET_CITY_SCHEMA_VERSION,
  MARKET_CITY_SCHEMA_VERSION_V1,
  type MarketCityArrayFire,
  type MarketCityIdentity,
  type MarketCityStateV2,
  type MarketCityTerrain,
  type MarketFireHistoryEntry,
  type MarketFireIncident,
  type MarketFacility,
  type MarketFacilityKindV1,
  type MarketFacilityKind,
  type MarketTerrainMaterial,
  type MarketZoneKind,
} from './types';

export const MARKET_CITY_STORAGE_NAMESPACE = 'synthcity-market-v2' as const;

const TILE_COUNT = MARKET_CITY_MAP_SIZE * MARKET_CITY_MAP_SIZE;
const CARDINAL_MASK_DIRECTIONS = Object.freeze([
  { bit: 1, opposite: 4, dx: 0, dy: -1 },
  { bit: 2, opposite: 8, dx: 1, dy: 0 },
  { bit: 4, opposite: 1, dx: 0, dy: 1 },
  { bit: 8, opposite: 2, dx: -1, dy: 0 },
] as const);
const TERRAIN_MATERIALS = new Set<MarketTerrainMaterial>(['grass', 'earth', 'sand', 'rock']);
const ZONE_KINDS = new Set<MarketZoneKind>(MARKET_ZONE_KINDS);
const FACILITY_KINDS_V1 = new Set<MarketFacilityKindV1>([
  'coal-power-plant',
  'gas-power-plant',
  'nuclear-power-plant',
  'wind-turbine',
  'solar-plant',
  'fire-station',
]);
const FACILITY_KINDS = new Set<MarketFacilityKind>([
  ...FACILITY_KINDS_V1,
  'police-station',
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
  'train-station',
  'subway-station',
]);

export interface MarketCityTerrainFixture {
  water?: readonly boolean[];
  elevation?: readonly number[];
  material?: readonly MarketTerrainMaterial[];
  trees?: readonly number[];
}

const DEFAULT_IDENTITY: MarketCityIdentity = Object.freeze({
  cityId: 'market-city',
  cityName: 'New City',
  mayorName: 'Mayor',
  seed: 1,
  createdAt: '1970-01-01T00:00:00.000Z',
});

function filled<T>(value: T): T[] {
  return Array<T>(TILE_COUNT).fill(value);
}

function fixtureArray<T>(
  values: readonly T[] | undefined,
  fallback: T,
  path: string,
  validate: (value: unknown, itemPath: string) => void,
): T[] {
  const result = values === undefined ? filled(fallback) : [...values];
  if (result.length !== TILE_COUNT) {
    throw new Error(`${path} must contain exactly ${TILE_COUNT} tiles.`);
  }
  for (let index = 0; index < result.length; index += 1) validate(result[index], `${path}[${index}]`);
  return result;
}

export function createMarketCityState(
  identityOverrides: Partial<MarketCityIdentity> = {},
  terrainFixture: MarketCityTerrainFixture = {},
): MarketCityStateV2 {
  const terrain: MarketCityTerrain = {
    water: fixtureArray(terrainFixture.water, false, 'terrainFixture.water', assertBoolean),
    elevation: fixtureArray(terrainFixture.elevation, 0, 'terrainFixture.elevation', assertFiniteNumber),
    material: fixtureArray(terrainFixture.material, 'grass', 'terrainFixture.material', assertTerrainMaterial),
    trees: fixtureArray(terrainFixture.trees, 0, 'terrainFixture.trees', assertNonnegativeFiniteNumber),
  };

  const state: MarketCityStateV2 = {
    schemaVersion: MARKET_CITY_SCHEMA_VERSION,
    rulesVersion: MARKET_CITY_RULES_VERSION,
    identity: { ...DEFAULT_IDENTITY, ...identityOverrides },
    clock: { month: 0, paused: true, speed: 1, fireDifficulty: 'normal' },
    map: {
      size: MARKET_CITY_MAP_SIZE,
      terrain,
      zones: filled(null),
      roads: filled(false),
      roadConnectionMasks: filled(0),
      avenueLanes: filled(false),
      avenueTravelMasks: filled(0),
      avenuePairMasks: filled(0),
      avenueMedianMasks: filled(0),
      rails: filled(false),
      railConnectionMasks: filled(0),
      subways: filled(false),
      subwayConnectionMasks: filled(0),
      powerLines: filled(false),
      waterPipes: filled(false),
      landfillZones: filled(false),
      facilities: [],
    },
    economy: {
      density: filled(0),
      wealth: filled(0),
      treasury: MARKET_CITY_RULES.startingTreasury,
      lastRevenue: 0,
      lastOperatingExpense: 0,
      lastNet: 0,
    },
    environment: {
      pollution: filled(0),
      congestion: filled(0),
      roadAccess: filled(false),
      powered: filled(false),
      watered: filled(false),
    },
    fire: {
      incidents: [],
      char: filled(0),
      collapsedTotal: 0,
      suppressedTotal: 0,
      history: [],
    },
    crime: {
      derelict: Array<boolean>(TILE_COUNT).fill(false),
      share: MARKET_CITY_RULES.police.neutralStart,
      targetShare: 0,
      funding: 0,
      tippedTotal: 0,
      recoveredTotal: 0,
    },
    market: {
      demand: { R: 0, C: 0, I: 0 },
      margin: { R: 0, C: 0, I: 0 },
      verticalDevelopmentLevel: 1,
    },
    services: {
      water: {
        componentByTile: filled(null),
        components: [],
        totalDemand: 0,
        totalAllocated: 0,
      },
      rail: {
        totalRidership: 0,
        tileUsage: filled(0),
        stationUsage: [],
      },
      waste: {
        generatedThisMonth: 0,
        generatedLifetime: 0,
        landfilledThisMonth: 0,
        landfilledLifetime: 0,
        unmanagedThisMonth: 0,
        unmanagedLifetime: 0,
        storedByTile: filled(0),
      },
    },
  };

  return validateMarketCityState(state);
}

function cloneFacility(facility: MarketFacility): MarketFacility {
  return { id: facility.id, kind: facility.kind, anchor: facility.anchor, tiles: [...facility.tiles] };
}

function cloneFireIncident(incident: MarketFireIncident): MarketFireIncident {
  return {
    ...incident,
    tileIds: [...incident.tileIds],
    structure: { ...incident.structure, color: [...incident.structure.color] },
  };
}

function cloneFireHistoryEntry(entry: MarketFireHistoryEntry): MarketFireHistoryEntry {
  return { ...entry, tileIds: [...entry.tileIds] };
}

export function cloneMarketCityState(state: MarketCityStateV2): MarketCityStateV2 {
  const clone: MarketCityStateV2 = {
    schemaVersion: state.schemaVersion,
    rulesVersion: state.rulesVersion,
    identity: { ...state.identity },
    clock: { ...state.clock },
    map: {
      size: state.map.size,
      terrain: {
        water: [...state.map.terrain.water],
        elevation: [...state.map.terrain.elevation],
        material: [...state.map.terrain.material],
        trees: [...state.map.terrain.trees],
      },
      zones: [...state.map.zones],
      roads: [...state.map.roads],
      roadConnectionMasks: [...state.map.roadConnectionMasks],
      avenueLanes: [...state.map.avenueLanes],
      avenueTravelMasks: [...state.map.avenueTravelMasks],
      avenuePairMasks: [...state.map.avenuePairMasks],
      avenueMedianMasks: [...state.map.avenueMedianMasks],
      rails: [...state.map.rails],
      railConnectionMasks: [...state.map.railConnectionMasks],
      subways: [...state.map.subways],
      subwayConnectionMasks: [...state.map.subwayConnectionMasks],
      powerLines: [...state.map.powerLines],
      waterPipes: [...state.map.waterPipes],
      landfillZones: [...state.map.landfillZones],
      facilities: state.map.facilities.map(cloneFacility),
    },
    economy: {
      density: [...state.economy.density],
      wealth: [...state.economy.wealth],
      treasury: state.economy.treasury,
      lastRevenue: state.economy.lastRevenue,
      lastOperatingExpense: state.economy.lastOperatingExpense,
      lastNet: state.economy.lastNet,
    },
    environment: {
      pollution: [...state.environment.pollution],
      congestion: [...state.environment.congestion],
      roadAccess: [...state.environment.roadAccess],
      powered: [...state.environment.powered],
      watered: [...state.environment.watered],
    },
    fire: {
      incidents: state.fire.incidents.map(cloneFireIncident),
      char: [...state.fire.char],
      collapsedTotal: state.fire.collapsedTotal,
      suppressedTotal: state.fire.suppressedTotal,
      history: state.fire.history.map(cloneFireHistoryEntry),
    },
    crime: {
      ...state.crime,
      derelict: [...state.crime.derelict],
    },
    market: {
      demand: { ...state.market.demand },
      margin: { ...state.market.margin },
      verticalDevelopmentLevel: state.market.verticalDevelopmentLevel,
    },
    services: {
      water: {
        componentByTile: [...state.services.water.componentByTile],
        components: state.services.water.components.map((component) => ({ ...component })),
        totalDemand: state.services.water.totalDemand,
        totalAllocated: state.services.water.totalAllocated,
      },
      rail: {
        totalRidership: state.services.rail.totalRidership,
        tileUsage: [...state.services.rail.tileUsage],
        stationUsage: state.services.rail.stationUsage.map((usage) => ({ ...usage })),
      },
      waste: {
        generatedThisMonth: state.services.waste.generatedThisMonth,
        generatedLifetime: state.services.waste.generatedLifetime,
        landfilledThisMonth: state.services.waste.landfilledThisMonth,
        landfilledLifetime: state.services.waste.landfilledLifetime,
        unmanagedThisMonth: state.services.waste.unmanagedThisMonth,
        unmanagedLifetime: state.services.waste.unmanagedLifetime,
        storedByTile: [...state.services.waste.storedByTile],
      },
    },
  };
  return clone;
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Cannot serialize a non-finite number.');
    return Object.is(value, -0) ? '0' : JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  throw new Error(`Cannot serialize value of type ${typeof value}.`);
}

export function serializeMarketCityState(state: MarketCityStateV2): string {
  return canonicalize(validateMarketCityState(state));
}

export function restoreMarketCityState(serialized: string | unknown): MarketCityStateV2 {
  let raw: unknown = serialized;
  if (typeof serialized === 'string') {
    try {
      raw = JSON.parse(serialized) as unknown;
    } catch (error) {
      throw new Error(`Market city save is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (!isRecord(raw)) throw new Error('state must be an object.');
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION_V1) return migrateArrayFireState(raw, 'v1');
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_V2_ARRAY_FIRE) {
    return migrateArrayFireState(raw, 'v2.0');
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_WATER) {
    return migratePreWaterState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_WASTE) {
    return migratePreWasteState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT) {
    return migratePreSolarFootprintState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS) {
    return migratePreAvenueMedianState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT) {
    return migratePreVerticalDevelopmentState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_SUBWAY) {
    return migratePreSubwayState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY) {
    return migratePreRoadTopologyState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS) {
    return migratePreFireStationRadiusState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE) {
    return migratePreLandfillRoadGateState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_CRIME) {
    return migratePreCrimeState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES) {
    return migratePreTrainStationUtilitiesState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING) {
    return migratePreCrimeFundingState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING) {
    return migratePreRoadPowerCrossingState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING) {
    return migratePreRailPowerCrossingState(raw);
  }
  if (raw.schemaVersion === MARKET_CITY_SCHEMA_VERSION
    && raw.rulesVersion === MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES) {
    return migratePreThermalUtilityGatesState(raw);
  }
  return validateMarketCityState(raw);
}

function migratePreWaterState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_WATER) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_WATER}.`);
  }
  const environment = record(state.environment, 'state.environment', [
    'pollution', 'congestion', 'roadAccess', 'powered', 'watered',
  ]);
  const services = record(state.services, 'state.services', ['water', 'rail', 'waste']);
  const water = record(services.water, 'state.services.water', [
    'componentByTile', 'components', 'totalDemand', 'totalAllocated',
  ]);
  const priorWatered = denseArray(environment.watered, 'state.environment.watered', TILE_COUNT);
  priorWatered.forEach((item, index) => assertBoolean(item, `state.environment.watered[${index}]`));
  const priorMappings = denseArray(water.componentByTile, 'state.services.water.componentByTile', TILE_COUNT);
  if (priorWatered.some(Boolean)
    || priorMappings.some((item) => item !== null)
    || !Array.isArray(water.components)
    || water.components.length > 0
    || water.totalDemand !== 0
    || water.totalAllocated !== 0) {
    throw new Error('Pre-Water state must retain canonical-empty planned water service fields.');
  }
  const candidate = {
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_WASTE,
    environment: { ...environment, watered: filled(false) },
    services: {
      ...services,
      water: { componentByTile: filled(null), components: [], totalDemand: 0, totalAllocated: 0 },
    },
  } as unknown as MarketCityStateV2;
  const derived = deriveWaterService(candidate);
  candidate.environment.watered = derived.watered;
  candidate.services.water = derived.service;
  return migratePreWasteState(candidate);
}

/**
 * Waste turns the already-persisted landfill service scaffold into live
 * simulation. A valid 2.2 snapshot is otherwise shape-identical, so migration
 * is deliberately pure and retains even a valid nonzero garbage ledger.
 */
function migratePreWasteState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_WASTE) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_WASTE}.`);
  }
  return migratePreAvenueMedianState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS,
  });
}

/**
 * Solar changed from 2×2 to 4×2 in 2.4.  Existing mayors' lots must not be
 * expanded over their later roads, zones, water, or facilities, so the
 * migration preserves their exact 2×2 footprint. New placements use 4×2.
 */
function migratePreSolarFootprintState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_SOLAR_FOOTPRINT}.`);
  }
  return migratePreAvenueMedianState({ ...state, rulesVersion: MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS });
}

/**
 * 2.5 makes Avenue paint durable: a later crossing may add connectivity but
 * cannot reinterpret markings already painted by the established carriageway.
 * A 2.4 save has no placement provenance, so its current pair markings become
 * the honest baseline for all existing lanes.
 */
function migratePreAvenueMedianState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS}.`);
  }
  const map = record(withoutFutureRoadTopologyField(withoutFutureSubwayFields(withoutFutureAvenueMedianField(state.map))), 'state.map', [
    'size', 'terrain', 'zones', 'roads', 'avenueLanes', 'avenueTravelMasks', 'avenuePairMasks',
    'rails', 'railConnectionMasks', 'powerLines', 'waterPipes', 'landfillZones', 'facilities',
  ]);
  const avenuePairMasks = denseArray(map.avenuePairMasks, 'state.map.avenuePairMasks', TILE_COUNT);
  avenuePairMasks.forEach((mask, index) => assertIntegerRange(mask, `state.map.avenuePairMasks[${index}]`, 0, 15));
  return migratePreVerticalDevelopmentState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT,
    map: { ...map, avenueMedianMasks: [...avenuePairMasks] },
  });
}

/**
 * Vertical Development is a persisted player setting. Existing 2.5 saves have
 * no such field, so they retain every prior city value and begin at Level 1.
 */
function migratePreVerticalDevelopmentState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_VERTICAL_DEVELOPMENT}.`);
  }
  // Test fixtures and interrupted development builds may already carry the
  // new field while still advertising 2.5. Treat it as migration metadata,
  // then apply the single canonical Level-1 default for every old rules save.
  const market = record(
    state.market,
    'state.market',
    isRecord(state.market) && Object.hasOwn(state.market, 'verticalDevelopmentLevel')
      ? ['demand', 'margin', 'verticalDevelopmentLevel']
      : ['demand', 'margin'],
  );
  return migratePreSubwayState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_SUBWAY,
    market: { ...market, verticalDevelopmentLevel: 1 },
  });
}

/** Subway adds an empty independent underground layer to prior market maps. */
function migratePreSubwayState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_SUBWAY) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_SUBWAY}.`);
  }
  const map = record(withoutFutureRoadTopologyField(withoutFutureSubwayFields(state.map)), 'state.map', [
    'size', 'terrain', 'zones', 'roads', 'avenueLanes', 'avenueTravelMasks', 'avenuePairMasks', 'avenueMedianMasks',
    'rails', 'railConnectionMasks', 'powerLines', 'waterPipes', 'landfillZones', 'facilities',
  ]);
  return migratePreRoadTopologyState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY,
    map: { ...map, subways: filled(false), subwayConnectionMasks: filled(0) },
  });
}

function legacyRoadConnectionMasks(roads: readonly boolean[]): number[] {
  const masks = filled(0);
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (!roads[tile]) continue;
    const x = tile % MARKET_CITY_MAP_SIZE;
    const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
    if (y > 0 && roads[tile - MARKET_CITY_MAP_SIZE]) masks[tile] = (masks[tile] ?? 0) | 1;
    if (x + 1 < MARKET_CITY_MAP_SIZE && roads[tile + 1]) masks[tile] = (masks[tile] ?? 0) | 2;
    if (y + 1 < MARKET_CITY_MAP_SIZE && roads[tile + MARKET_CITY_MAP_SIZE]) masks[tile] = (masks[tile] ?? 0) | 4;
    if (x > 0 && roads[tile - 1]) masks[tile] = (masks[tile] ?? 0) | 8;
  }
  return masks;
}

/** Existing saves retain their former inferred road graph; new roads use exact gesture links. */
function migratePreRoadTopologyState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_ROAD_TOPOLOGY}.`);
  }
  const map = record(state.map, 'state.map', [
    'size', 'terrain', 'zones', 'roads', 'avenueLanes', 'avenueTravelMasks', 'avenuePairMasks', 'avenueMedianMasks',
    'rails', 'railConnectionMasks', 'subways', 'subwayConnectionMasks', 'powerLines', 'waterPipes', 'landfillZones', 'facilities',
  ]);
  const roads = validateArray(map.roads, 'state.map.roads', assertBoolean);
  return migratePreFireStationRadiusState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS,
    map: { ...map, roadConnectionMasks: legacyRoadConnectionMasks(roads) },
  });
}

/**
 * Fire Station coverage expanded from radius seven to twenty-one in 2.9.
 * Existing city geometry and ledgers are already canonical, so this release
 * advances only its governing rules version and remains pure and lossless.
 */
function migratePreFireStationRadiusState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_FIRE_STATION_RADIUS}.`);
  }
  return migratePreLandfillRoadGateState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE,
  });
}

/**
 * Landfill collection now requires direct road contact, but it introduces no
 * persistent fields.  Every valid 2.9 save therefore upgrades losslessly.
 */
function migratePreLandfillRoadGateState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_LANDFILL_ROAD_GATE}.`);
  }
  return migratePreCrimeState({ ...state, rulesVersion: MARKET_CITY_RULES_VERSION_PRE_CRIME });
}

/**
 * Public safety is new in 2.11. A prior save has no crime record at all, so it
 * arrives with a clean, unpoliced city: no derelicts, no funding. The system
 * stays dormant until that mayor builds a police department, which is exactly
 * the state a fresh city starts in.
 */
function migratePreCrimeState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_CRIME) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_CRIME}.`);
  }
  return migratePreTrainStationUtilitiesState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES,
    crime: {
      derelict: Array<boolean>(TILE_COUNT).fill(false),
      share: MARKET_CITY_RULES.police.neutralStart,
      targetShare: 0,
      funding: 0,
      tippedTotal: 0,
      recoveredTotal: 0,
    },
  });
}

/**
 * Version 2.12 changes only derived Train Station utility and rail service.
 * Map topology, facility footprints, and player-authored state pass through
 * untouched while the existing pure service derivations establish their new
 * canonical values.
 */
function migratePreTrainStationUtilitiesState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_TRAIN_STATION_UTILITIES}.`);
  }
  // Clone every nested persisted structure before re-deriving services: the
  // migration contract is pure even when reached through an older migration
  // chain whose raw parsed save is still owned by its caller.
  const candidate = cloneMarketCityState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING,
  } as unknown as MarketCityStateV2);
  let power = derivePower(candidate);
  candidate.environment.powered = power.powered;
  let water = deriveWaterService(candidate, power);
  candidate.environment.watered = water.watered;
  candidate.services.water = water.service;
  power = derivePower(candidate);
  candidate.environment.powered = power.powered;
  water = deriveWaterService(candidate, power);
  candidate.environment.watered = water.watered;
  candidate.services.water = water.service;
  const rail = derivePassengerRailService(candidate, power, water);
  return migratePreCrimeFundingState({
    ...candidate,
    environment: candidate.environment,
    services: {
      ...candidate.services,
      rail: rail.service,
    },
  });
}

/**
 * 2.12 to 2.13: police funding became a spendable, capped dial.
 *
 * Nothing in 2.12 could write crime.funding -- it was read by the balance model
 * but had no command, no bridge method and no control -- so every save from
 * that era carries zero. The clamp is belt and braces for a hand-edited file
 * that set it above the new ceiling.
 */
function migratePreCrimeFundingState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_CRIME_FUNDING}.`);
  }
  const candidate = cloneMarketCityState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING,
  } as unknown as MarketCityStateV2);
  const funding = Number(candidate.crime.funding);
  candidate.crime.funding = Number.isInteger(funding)
    ? Math.max(0, Math.min(MARKET_CITY_RULES.police.maximumFunding, funding))
    : 0;
  return migratePreRoadPowerCrossingState(candidate);
}

/**
 * Version 2.14 permits an ordinary Road and a Power Line to share a surface
 * tile. The state shape is unchanged; this pure migration only adopts the
 * new placement rule while retaining every player-authored map record.
 */
function migratePreRoadPowerCrossingState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_ROAD_POWER_CROSSING}.`);
  }
  return migratePreRailPowerCrossingState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING,
  } as unknown as MarketCityStateV2);
}

/**
 * Version 2.15 extends the overhead Power Line crossing rule to Rail. The
 * state shape stays unchanged and an older city cannot contain this newly
 * permitted combination, so upgrading is pure and lossless.
 */
function migratePreRailPowerCrossingState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_RAIL_POWER_CROSSING}.`);
  }
  return migratePreThermalUtilityGatesState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES,
  } as unknown as MarketCityStateV2);
}

/**
 * Version 2.16 adds derived thermal cooling gates. Player-authored city data
 * remains untouched; only canonical utility projections are re-derived for
 * the new rules before the migrated save is validated and persisted.
 */
function migratePreThermalUtilityGatesState(value: unknown): MarketCityStateV2 {
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION_PRE_THERMAL_UTILITY_GATES}.`);
  }
  const candidate = cloneMarketCityState({
    ...state,
    rulesVersion: MARKET_CITY_RULES_VERSION,
  } as unknown as MarketCityStateV2);
  const utilities = deriveUtilities(candidate);
  candidate.environment.powered = utilities.power.powered;
  candidate.environment.watered = utilities.water.watered;
  candidate.services.water = utilities.water.service;
  const trainStationCount = candidate.map.facilities.reduce(
    (count, facility) => count + (facility.kind === 'train-station' ? 1 : 0),
    0,
  );
  candidate.services.rail = trainStationCount >= 2 && candidate.map.rails.some(Boolean)
    ? derivePassengerRailService(candidate, utilities.power, utilities.water).service
    : { totalRidership: 0, tileUsage: Array<number>(TILE_COUNT).fill(0), stationUsage: [] };
  return validateMarketCityState(candidate);
}

function fnv1a32(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function hashDeterministicState(state: MarketCityStateV2): string {
  return `market-v2-${fnv1a32(serializeMarketCityState(state))}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function record(value: unknown, path: string, keys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${path} must be an object.`);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new Error(`${path} must be a plain object.`);
  if (Object.getOwnPropertySymbols(value).length > 0) throw new Error(`${path} must not contain symbol properties.`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!('value' in descriptor)) throw new Error(`${path}.${key} must be a data property.`);
    if (!descriptor.enumerable) throw new Error(`${path}.${key} must be enumerable.`);
  }
  const expected = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!expected.has(key)) throw new Error(`${path} has unexpected key ${JSON.stringify(key)}.`);
  }
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) throw new Error(`${path} is missing key ${JSON.stringify(key)}.`);
  }
  return value;
}

/** Test fixtures and a few pre-release local saves may already carry the
 * future field while claiming an older rules version. Treat it as transport
 * metadata and rebuild the historical baseline from pair masks below. */
function withoutFutureAvenueMedianField(value: unknown): unknown {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'avenueMedianMasks')) return value;
  const { avenueMedianMasks: _ignored, ...legacyMap } = value;
  return legacyMap;
}

/** New 2.8 road topology is not meaningful to historical rule snapshots. */
function withoutFutureRoadTopologyField(value: unknown): unknown {
  if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'roadConnectionMasks')) return value;
  const { roadConnectionMasks: _ignored, ...legacyMap } = value;
  return legacyMap;
}

/** Historical fixtures can carry a newer empty subway layer while declaring
 * earlier rules. Subway did not exist in those rule sets, so it is discarded
 * before their canonical migration path assigns the new empty layer. */
function withoutFutureSubwayFields(value: unknown): unknown {
  if (!isRecord(value)) return value;
  const { subways: _ignoredSubways, subwayConnectionMasks: _ignoredMasks, ...legacyMap } = value;
  return legacyMap;
}

function denseArray(value: unknown, path: string, length: number): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (value.length !== length) throw new Error(`${path} must contain exactly ${length} entries.`);
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) throw new Error(`${path}[${index}] cannot be empty.`);
  }
  return value;
}

function assertString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${path} must be a nonempty string.`);
}

function assertCanonicalTimestamp(value: unknown, path: string): asserts value is string {
  assertString(value, path);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${path} must be a canonical ISO timestamp.`);
  }
}

function assertBoolean(value: unknown, path: string): asserts value is boolean {
  if (typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
}

function assertFiniteNumber(value: unknown, path: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${path} must be a finite number.`);
}

function assertNonnegativeFiniteNumber(value: unknown, path: string): asserts value is number {
  assertFiniteNumber(value, path);
  if (value < 0) throw new Error(`${path} cannot be negative.`);
}

function assertInteger(value: unknown, path: string, minimum = Number.MIN_SAFE_INTEGER): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) throw new Error(`${path} must be an integer >= ${minimum}.`);
}

function assertRange(value: unknown, path: string, minimum: number, maximum: number): asserts value is number {
  assertFiniteNumber(value, path);
  if (value < minimum || value > maximum) throw new Error(`${path} must be between ${minimum} and ${maximum}.`);
}

function assertTerrainMaterial(value: unknown, path: string): asserts value is MarketTerrainMaterial {
  if (typeof value !== 'string' || !TERRAIN_MATERIALS.has(value as MarketTerrainMaterial)) {
    throw new Error(`${path} is not a supported terrain material.`);
  }
}

function validateArray<T>(
  value: unknown,
  path: string,
  validator: (item: unknown, itemPath: string) => asserts item is T,
): T[] {
  const values = denseArray(value, path, TILE_COUNT);
  for (let index = 0; index < values.length; index += 1) validator(values[index], `${path}[${index}]`);
  return values as T[];
}

function emptyServiceScaffolding(): MarketCityStateV2['services'] {
  return {
    water: { componentByTile: filled(null), components: [], totalDemand: 0, totalAllocated: 0 },
    rail: { totalRidership: 0, tileUsage: filled(0), stationUsage: [] },
    waste: {
      generatedThisMonth: 0,
      generatedLifetime: 0,
      landfilledThisMonth: 0,
      landfilledLifetime: 0,
      unmanagedThisMonth: 0,
      unmanagedLifetime: 0,
      storedByTile: filled(0),
    },
  };
}

function validateArrayFire(value: unknown): MarketCityArrayFire {
  const fire = record(value, 'state.fire', ['intensity', 'damage', 'age', 'char', 'collapsedTotal']);
  const intensity = validateArray(
    fire.intensity,
    'state.fire.intensity',
    (item, path): asserts item is number => assertRange(item, path, 0, 1),
  );
  const damage = validateArray(fire.damage, 'state.fire.damage', assertNonnegativeFiniteNumber);
  const age = validateArray(
    fire.age,
    'state.fire.age',
    (item, path): asserts item is number => assertInteger(item, path, 0),
  );
  const char = validateArray(
    fire.char,
    'state.fire.char',
    (item, path): asserts item is number => assertRange(item, path, 0, 1),
  );
  assertInteger(fire.collapsedTotal, 'state.fire.collapsedTotal', 0);
  return { intensity, damage, age, char, collapsedTotal: fire.collapsedTotal };
}

function migratedStructure(tile: number, zone: MarketZoneKind, density: number): MarketFireIncident['structure'] {
  const colors: Record<MarketZoneKind, [number, number, number]> = {
    R: [164, 126, 86],
    C: [92, 130, 166],
    I: [136, 126, 94],
  };
  return {
    footprint: '1x1',
    originTile: tile,
    height: Math.max(1, Math.min(10, Math.ceil(density * (zone === 'I' ? 4 : 10)))),
    roof: 'flat',
    roofHeight: 0,
    roofOrientation: 0,
    detail: null,
    color: [...colors[zone]],
    landmark: false,
  };
}

function migrateArrayFire(
  legacy: MarketCityArrayFire,
  clockMonth: number,
  zones: Array<MarketZoneKind | null>,
  density: number[],
): MarketCityStateV2['fire'] {
  const activeTiles = legacy.intensity
    .map((intensity, tile) => ({ intensity, tile }))
    .filter(({ intensity }) => intensity > 0)
    .map(({ tile }) => tile);
  if (activeTiles.length > 0 && clockMonth < 1) {
    throw new Error('state.fire cannot contain active legacy fires before month 1.');
  }
  for (const tile of activeTiles) {
    if (zones[tile] === null) throw new Error(`state.fire.intensity[${tile}] requires a zoned tile.`);
  }

  const incidents: MarketFireIncident[] = activeTiles.map((tile) => {
    const zone = zones[tile]!;
    const startedMonth = Math.max(1, clockMonth - legacy.age[tile]!);
    return {
      id: `fire-m${startedMonth}-t${tile}`,
      status: 'burning',
      tileIds: [tile],
      zone,
      startedMonth,
      structure: migratedStructure(tile, zone, density[tile]!),
      intensity: legacy.intensity[tile]!,
      damage: legacy.damage[tile]!,
      age: legacy.age[tile]!,
      rubbleMonthsRemaining: 0,
    };
  });

  const history: MarketFireHistoryEntry[] = [];
  const activeIds = new Set(incidents.map(({ id }) => id));
  const collapsedKeys: Array<{ month: number; tile: number }> = [];
  for (let month = 1; month <= clockMonth && collapsedKeys.length < legacy.collapsedTotal; month += 1) {
    for (let tile = 0; tile < TILE_COUNT && collapsedKeys.length < legacy.collapsedTotal; tile += 1) {
      if (!activeIds.has(`fire-m${month}-t${tile}`)) collapsedKeys.push({ month, tile });
    }
  }
  if (legacy.collapsedTotal > 0 && clockMonth < 1) {
    throw new Error('state.fire.collapsedTotal requires the city to have reached month 1.');
  }
  if (collapsedKeys.length < legacy.collapsedTotal) {
    throw new Error('state.fire.collapsedTotal exceeds the representable deterministic history capacity.');
  }
  const historyGroups: Array<{ month: number; tile: number; entries: Array<Omit<MarketFireHistoryEntry, 'sequence'>> }> = [];
  for (const { month, tile } of collapsedKeys) {
    const zone = zones[tile] ?? 'R';
    const incidentId = `fire-m${month}-t${tile}`;
    historyGroups.push({
      month,
      tile,
      entries: [
        {
          month, incidentId, event: 'ignited', tileIds: [tile], zone,
          intensity: 1, damage: 0, rubbleMonthsRemaining: 0,
        },
        {
          month, incidentId, event: 'collapsed', tileIds: [tile], zone,
          intensity: 0, damage: 0, rubbleMonthsRemaining: MARKET_CITY_RULES.fire.rubbleMonths,
        },
      ],
    });
  }
  for (const incident of incidents) {
    historyGroups.push({
      month: incident.startedMonth,
      tile: incident.tileIds[0]!,
      entries: [{
        month: incident.startedMonth,
        incidentId: incident.id,
        event: 'ignited',
        tileIds: [...incident.tileIds],
        zone: incident.zone,
        intensity: incident.intensity,
        damage: incident.damage,
        rubbleMonthsRemaining: 0,
      }],
    });
  }
  const appendHistory = (entry: Omit<MarketFireHistoryEntry, 'sequence'>): void => {
    history.push({ sequence: history.length + 1, ...entry });
  };
  historyGroups.sort((left, right) => left.month - right.month || left.tile - right.tile);
  for (const group of historyGroups) {
    for (const entry of group.entries) appendHistory(entry);
  }
  return {
    incidents,
    char: [...legacy.char],
    collapsedTotal: legacy.collapsedTotal,
    suppressedTotal: 0,
    history,
  };
}

function migrateArrayFireState(value: unknown, format: 'v1' | 'v2.0'): MarketCityStateV2 {
  const keys = format === 'v1'
    ? ['schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market']
    : ['schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'market', 'services'];
  const state = record(value, 'state', keys);
  const expectedSchema = format === 'v1' ? MARKET_CITY_SCHEMA_VERSION_V1 : MARKET_CITY_SCHEMA_VERSION;
  const expectedRules = format === 'v1' ? MARKET_CITY_RULES_VERSION_V1 : MARKET_CITY_RULES_VERSION_V2_ARRAY_FIRE;
  if (state.schemaVersion !== expectedSchema) throw new Error(`state.schemaVersion must be ${expectedSchema}.`);
  if (state.rulesVersion !== expectedRules) throw new Error(`state.rulesVersion must be ${expectedRules}.`);
  const clock = record(state.clock, 'state.clock', ['month', 'paused', 'speed', 'fireDifficulty']);
  assertInteger(clock.month, 'state.clock.month', 0);
  const economy = record(state.economy, 'state.economy', [
    'density', 'wealth', 'treasury', 'lastRevenue', 'lastOperatingExpense', 'lastNet',
  ]);
  const density = validateArray(
    economy.density,
    'state.economy.density',
    (item, path): asserts item is number => assertRange(item, path, 0, 1),
  );
  const legacyFire = validateArrayFire(state.fire);

  let map: Record<string, unknown>;
  let environment: Record<string, unknown>;
  let services: unknown;
  if (format === 'v1') {
    map = record(withoutFutureRoadTopologyField(withoutFutureSubwayFields(state.map)), 'state.map', ['size', 'terrain', 'zones', 'roads', 'powerLines', 'facilities']);
    environment = record(
      state.environment,
      'state.environment',
      ['pollution', 'congestion', 'roadAccess', 'powered'],
    );
    if (!Array.isArray(map.facilities)) throw new Error('state.map.facilities must be an array.');
    for (let index = 0; index < map.facilities.length; index += 1) {
      const facility = record(map.facilities[index], `state.map.facilities[${index}]`, ['id', 'kind', 'anchor', 'tiles']);
      if (typeof facility.kind !== 'string' || !FACILITY_KINDS_V1.has(facility.kind as MarketFacilityKindV1)) {
        throw new Error(`state.map.facilities[${index}].kind is not a supported V1 facility kind.`);
      }
    }
    map = {
      ...map,
      avenueLanes: filled(false),
      avenueTravelMasks: filled(0),
      avenuePairMasks: filled(0),
      rails: filled(false),
      railConnectionMasks: filled(0),
      waterPipes: filled(false),
      landfillZones: filled(false),
    };
    environment = { ...environment, watered: filled(false) };
    services = emptyServiceScaffolding();
  } else {
    map = record(withoutFutureRoadTopologyField(withoutFutureSubwayFields(withoutFutureAvenueMedianField(state.map))), 'state.map', [
      'size', 'terrain', 'zones', 'roads', 'avenueLanes', 'avenueTravelMasks', 'avenuePairMasks',
      'rails', 'railConnectionMasks', 'powerLines', 'waterPipes', 'landfillZones', 'facilities',
    ]);
    environment = record(
      state.environment,
      'state.environment',
      ['pollution', 'congestion', 'roadAccess', 'powered', 'watered'],
    );
    services = state.services;
  }
  const zones = validateArray(map.zones, 'state.map.zones', assertZone);
  const migrated = {
    ...state,
    schemaVersion: MARKET_CITY_SCHEMA_VERSION,
    rulesVersion: MARKET_CITY_RULES_VERSION_PRE_AVENUE_MEDIANS,
    map,
    environment,
    fire: migrateArrayFire(legacyFire, clock.month, zones, density),
    services,
  };
  return migratePreAvenueMedianState(migrated);
}

function assertZone(value: unknown, path: string): asserts value is MarketZoneKind | null {
  if (value !== null && (typeof value !== 'string' || !ZONE_KINDS.has(value as MarketZoneKind))) {
    throw new Error(`${path} is not a supported zone.`);
  }
}

function assertFacilityKind(value: unknown, path: string): asserts value is MarketFacilityKind {
  if (typeof value !== 'string' || !FACILITY_KINDS.has(value as MarketFacilityKind)) {
    throw new Error(`${path} is not a supported facility kind.`);
  }
}

function facilityDimensions(kind: MarketFacilityKind): readonly [number, number] {
  if (isPowerPlant(kind)) return MARKET_CITY_RULES.plants[kind].footprint;
  if (kind === 'water-tower') return [2, 2];
  if (kind === 'coastal-water-pump') return [3, 3];
  if (kind === 'water-treatment-plant') return [4, 3];
  if (kind === 'train-station') return [2, 2];
  return [1, 1];
}

function expectedFacilityTiles(kind: MarketFacilityKind, anchor: number): number[] {
  return expectedFacilityTilesForDimensions(anchor, facilityDimensions(kind));
}

function expectedFacilityTilesForDimensions(anchor: number, [width, height]: readonly [number, number]): number[] {
  const anchorX = anchor % MARKET_CITY_MAP_SIZE;
  const anchorY = Math.floor(anchor / MARKET_CITY_MAP_SIZE);
  if (anchorX + width > MARKET_CITY_MAP_SIZE || anchorY + height > MARKET_CITY_MAP_SIZE) {
    throw new Error('facility footprint is outside the map.');
  }
  const tiles: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) tiles.push((anchorY + y) * MARKET_CITY_MAP_SIZE + anchorX + x);
  }
  return tiles;
}

function expectedPersistedFacilityTiles(kind: MarketFacilityKind, anchor: number, rawTiles: unknown): number[] {
  // A 2×2 Solar array can only originate in a 2.3-or-earlier save. Keeping
  // that exact lot prevents a rule upgrade from overwriting player-built map
  // content. All command-created arrays are the current 4×2 footprint.
  if (kind === 'solar-plant' && Array.isArray(rawTiles) && rawTiles.length === 4) {
    return expectedFacilityTilesForDimensions(anchor, [2, 2]);
  }
  return expectedFacilityTiles(kind, anchor);
}

function validateSectorValues(value: unknown, path: string, nonnegative: boolean): { R: number; C: number; I: number } {
  const values = record(value, path, ['R', 'C', 'I']);
  for (const sector of MARKET_ZONE_KINDS) {
    if (nonnegative) assertNonnegativeFiniteNumber(values[sector], `${path}.${sector}`);
    else assertFiniteNumber(values[sector], `${path}.${sector}`);
  }
  return values as unknown as { R: number; C: number; I: number };
}

const FIRE_STATUSES = new Set(['burning', 'rubble']);
const FIRE_EVENTS = new Set(['ignited', 'burning', 'suppressed', 'collapsed', 'rubble-cleared']);
const LOT_FOOTPRINTS = new Set(['1x1', '1x2', '2x1', '2x2', 'L']);
const ROOF_KINDS = new Set([
  'flat', 'gable', 'pyramid', 'wedge', 'mech', 'core', 'steps', 'parapet',
  'sawtooth', 'cylinder', 'vents', 'silos', 'stack', 'spire',
]);
const BUILDING_DETAILS = new Set(['door', 'windows', 'curtain', 'bay']);

function validateFireTileIds(value: unknown, path: string): number[] {
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${path} must be a nonempty array.`);
  const tileIds: number[] = [];
  let previous = -1;
  for (let index = 0; index < value.length; index += 1) {
    const tile = value[index];
    assertInteger(tile, `${path}[${index}]`, 0);
    if (tile >= TILE_COUNT) throw new Error(`${path}[${index}] is outside the map.`);
    if (tile <= previous) throw new Error(`${path} must be sorted and unique.`);
    tileIds.push(tile);
    previous = tile;
  }
  const connected = new Set([tileIds[0]!]);
  const queue = [tileIds[0]!];
  const tileSet = new Set(tileIds);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const tile = queue[cursor]!;
    const x = tile % MARKET_CITY_MAP_SIZE;
    const neighbours = [
      tile - MARKET_CITY_MAP_SIZE,
      x + 1 < MARKET_CITY_MAP_SIZE ? tile + 1 : -1,
      tile + MARKET_CITY_MAP_SIZE,
      x > 0 ? tile - 1 : -1,
    ];
    for (const neighbour of neighbours) {
      if (!tileSet.has(neighbour) || connected.has(neighbour)) continue;
      connected.add(neighbour);
      queue.push(neighbour);
    }
  }
  if (connected.size !== tileIds.length) throw new Error(`${path} must form one connected footprint.`);
  return tileIds;
}

function validateDeclaredFireFootprint(
  tileIds: readonly number[],
  footprint: string,
  originTile: number,
  path: string,
): void {
  if (originTile !== tileIds[0]) throw new Error(`${path}.originTile must be the canonical first tile.`);
  const xs = tileIds.map((tile) => tile % MARKET_CITY_MAP_SIZE);
  const ys = tileIds.map((tile) => Math.floor(tile / MARKET_CITY_MAP_SIZE));
  const width = Math.max(...xs) - Math.min(...xs) + 1;
  const height = Math.max(...ys) - Math.min(...ys) + 1;
  const minimumX = Math.min(...xs);
  const minimumY = Math.min(...ys);
  const normalized = new Set(tileIds.map((tile) => {
    const x = tile % MARKET_CITY_MAP_SIZE;
    const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
    return `${x - minimumX},${y - minimumY}`;
  }));
  const matches = footprint === '1x1'
    ? tileIds.length === 1 && width === 1 && height === 1
    : footprint === '1x2'
      ? tileIds.length === 2 && width === 2 && height === 1
      : footprint === '2x1'
        ? tileIds.length === 2 && width === 1 && height === 2
        : footprint === '2x2'
          ? tileIds.length === 4 && width === 2 && height === 2
          : footprint === 'L'
            ? tileIds.length === 3 && width === 2 && height === 2
              && normalized.has('0,0') && normalized.has('0,1') && normalized.has('1,1')
            : false;
  if (!matches) throw new Error(`${path}.footprint does not match its tile geometry.`);
}

function validateFireIncident(value: unknown, path: string): MarketFireIncident {
  const incident = record(value, path, [
    'id', 'status', 'tileIds', 'zone', 'startedMonth', 'structure',
    'intensity', 'damage', 'age', 'rubbleMonthsRemaining',
  ]);
  assertString(incident.id, `${path}.id`);
  if (typeof incident.status !== 'string' || !FIRE_STATUSES.has(incident.status)) {
    throw new Error(`${path}.status is not supported.`);
  }
  const tileIds = validateFireTileIds(incident.tileIds, `${path}.tileIds`);
  assertZone(incident.zone, `${path}.zone`);
  if (incident.zone === null) throw new Error(`${path}.zone cannot be null.`);
  assertInteger(incident.startedMonth, `${path}.startedMonth`, 1);

  const structure = record(incident.structure, `${path}.structure`, [
    'footprint', 'originTile', 'height', 'roof', 'roofHeight', 'roofOrientation',
    'detail', 'color', 'landmark',
  ]);
  if (typeof structure.footprint !== 'string' || !LOT_FOOTPRINTS.has(structure.footprint)) {
    throw new Error(`${path}.structure.footprint is not supported.`);
  }
  assertInteger(structure.originTile, `${path}.structure.originTile`, 0);
  if (!tileIds.includes(structure.originTile)) throw new Error(`${path}.structure.originTile must belong to the footprint.`);
  validateDeclaredFireFootprint(
    tileIds,
    structure.footprint as string,
    structure.originTile as number,
    `${path}.structure`,
  );
  assertInteger(structure.height, `${path}.structure.height`, 1);
  if (typeof structure.roof !== 'string' || !ROOF_KINDS.has(structure.roof)) {
    throw new Error(`${path}.structure.roof is not supported.`);
  }
  assertNonnegativeFiniteNumber(structure.roofHeight, `${path}.structure.roofHeight`);
  assertInteger(structure.roofOrientation, `${path}.structure.roofOrientation`, 0);
  if (structure.detail !== null && (typeof structure.detail !== 'string' || !BUILDING_DETAILS.has(structure.detail))) {
    throw new Error(`${path}.structure.detail is not supported.`);
  }
  const color = denseArray(structure.color, `${path}.structure.color`, 3);
  color.forEach((channel, index) => assertRange(channel, `${path}.structure.color[${index}]`, 0, 255));
  assertBoolean(structure.landmark, `${path}.structure.landmark`);

  assertRange(incident.intensity, `${path}.intensity`, 0, 1);
  assertNonnegativeFiniteNumber(incident.damage, `${path}.damage`);
  assertInteger(incident.age, `${path}.age`, 0);
  assertInteger(incident.rubbleMonthsRemaining, `${path}.rubbleMonthsRemaining`, 0);
  if (incident.status === 'burning' && incident.rubbleMonthsRemaining !== 0) {
    throw new Error(`${path}.rubbleMonthsRemaining must be zero while burning.`);
  }
  if (incident.status === 'rubble' && (incident.intensity !== 0 || incident.rubbleMonthsRemaining < 1)) {
    throw new Error(`${path} rubble must have zero intensity and a positive timer.`);
  }
  if (incident.id !== `fire-m${incident.startedMonth}-t${structure.originTile}`) {
    throw new Error(`${path}.id must be deterministic from its month and origin tile.`);
  }
  return incident as unknown as MarketFireIncident;
}

function validateFireHistoryEntry(value: unknown, path: string): MarketFireHistoryEntry {
  const entry = record(value, path, [
    'sequence', 'month', 'incidentId', 'event', 'tileIds', 'zone',
    'intensity', 'damage', 'rubbleMonthsRemaining',
  ]);
  assertInteger(entry.sequence, `${path}.sequence`, 1);
  assertInteger(entry.month, `${path}.month`, 1);
  assertString(entry.incidentId, `${path}.incidentId`);
  if (typeof entry.event !== 'string' || !FIRE_EVENTS.has(entry.event)) throw new Error(`${path}.event is not supported.`);
  validateFireTileIds(entry.tileIds, `${path}.tileIds`);
  assertZone(entry.zone, `${path}.zone`);
  if (entry.zone === null) throw new Error(`${path}.zone cannot be null.`);
  assertRange(entry.intensity, `${path}.intensity`, 0, 1);
  assertNonnegativeFiniteNumber(entry.damage, `${path}.damage`);
  assertInteger(entry.rubbleMonthsRemaining, `${path}.rubbleMonthsRemaining`, 0);
  return entry as unknown as MarketFireHistoryEntry;
}

function validateTopologyMasks(
  occupied: readonly boolean[],
  masks: readonly number[],
  path: string,
  reciprocal: boolean,
): void {
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (!occupied[tile]) continue;
    const x = tile % MARKET_CITY_MAP_SIZE;
    const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
    for (const direction of CARDINAL_MASK_DIRECTIONS) {
      if (((masks[tile] ?? 0) & direction.bit) === 0) continue;
      const neighborX = x + direction.dx;
      const neighborY = y + direction.dy;
      if (neighborX < 0 || neighborX >= MARKET_CITY_MAP_SIZE || neighborY < 0 || neighborY >= MARKET_CITY_MAP_SIZE) {
        throw new Error(`${path}[${tile}] points outside the map.`);
      }
      const neighbor = neighborY * MARKET_CITY_MAP_SIZE + neighborX;
      if (!occupied[neighbor]) throw new Error(`${path}[${tile}] points to an unoccupied topology tile.`);
      if (reciprocal && (((masks[neighbor] ?? 0) & direction.opposite) === 0)) {
        throw new Error(`${path}[${tile}] must have a reciprocal connection.`);
      }
    }
  }
}

export function validateMarketCityState(value: unknown): MarketCityStateV2 {
  // Version before shape. An unsupported save should say so plainly rather
  // than reporting whichever key that version happened to lack.
  const versioned = value as { schemaVersion?: unknown; rulesVersion?: unknown } | null;
  if (versioned?.schemaVersion !== undefined && versioned.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (versioned?.rulesVersion !== undefined && versioned.rulesVersion !== MARKET_CITY_RULES_VERSION) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION}.`);
  }
  const state = record(value, 'state', [
    'schemaVersion', 'rulesVersion', 'identity', 'clock', 'map', 'economy', 'environment', 'fire', 'crime', 'market', 'services',
  ]);
  if (state.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new Error(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION}.`);
  }
  if (state.rulesVersion !== MARKET_CITY_RULES_VERSION) {
    throw new Error(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION}.`);
  }

  const identity = record(state.identity, 'state.identity', ['cityId', 'cityName', 'mayorName', 'seed', 'createdAt']);
  assertString(identity.cityId, 'state.identity.cityId');
  assertString(identity.cityName, 'state.identity.cityName');
  assertString(identity.mayorName, 'state.identity.mayorName');
  assertInteger(identity.seed, 'state.identity.seed');
  assertCanonicalTimestamp(identity.createdAt, 'state.identity.createdAt');

  const clock = record(state.clock, 'state.clock', ['month', 'paused', 'speed', 'fireDifficulty']);
  assertInteger(clock.month, 'state.clock.month', 0);
  assertBoolean(clock.paused, 'state.clock.paused');
  if (clock.speed !== 0 && clock.speed !== 1 && clock.speed !== 2 && clock.speed !== 3) {
    throw new Error('state.clock.speed must be 0, 1, 2, or 3.');
  }
  if (clock.fireDifficulty !== 'easy' && clock.fireDifficulty !== 'normal' && clock.fireDifficulty !== 'hard') {
    throw new Error('state.clock.fireDifficulty must be easy, normal, or hard.');
  }

  const map = record(state.map, 'state.map', [
    'size',
    'terrain',
    'zones',
    'roads',
    'roadConnectionMasks',
    'avenueLanes',
    'avenueTravelMasks',
    'avenuePairMasks',
    'avenueMedianMasks',
    'rails',
    'railConnectionMasks',
    'subways',
    'subwayConnectionMasks',
    'powerLines',
    'waterPipes',
    'landfillZones',
    'facilities',
  ]);
  if (map.size !== MARKET_CITY_MAP_SIZE) throw new Error(`state.map.size must be ${MARKET_CITY_MAP_SIZE}.`);
  const terrain = record(map.terrain, 'state.map.terrain', ['water', 'elevation', 'material', 'trees']);
  const water = validateArray(terrain.water, 'state.map.terrain.water', assertBoolean);
  validateArray(terrain.elevation, 'state.map.terrain.elevation', assertFiniteNumber);
  validateArray(terrain.material, 'state.map.terrain.material', assertTerrainMaterial);
  validateArray(terrain.trees, 'state.map.terrain.trees', assertNonnegativeFiniteNumber);
  const zones = validateArray(map.zones, 'state.map.zones', assertZone);
  const roads = validateArray(map.roads, 'state.map.roads', assertBoolean);
  const roadConnectionMasks = validateArray(
    map.roadConnectionMasks,
    'state.map.roadConnectionMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const avenueLanes = validateArray(map.avenueLanes, 'state.map.avenueLanes', assertBoolean);
  const avenueTravelMasks = validateArray(
    map.avenueTravelMasks,
    'state.map.avenueTravelMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const avenuePairMasks = validateArray(
    map.avenuePairMasks,
    'state.map.avenuePairMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const avenueMedianMasks = validateArray(
    map.avenueMedianMasks,
    'state.map.avenueMedianMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const rails = validateArray(map.rails, 'state.map.rails', assertBoolean);
  const railConnectionMasks = validateArray(
    map.railConnectionMasks,
    'state.map.railConnectionMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const subways = validateArray(map.subways, 'state.map.subways', assertBoolean);
  const subwayConnectionMasks = validateArray(
    map.subwayConnectionMasks,
    'state.map.subwayConnectionMasks',
    (item, path): asserts item is number => assertIntegerRange(item, path, 0, 15),
  );
  const powerLines = validateArray(map.powerLines, 'state.map.powerLines', assertBoolean);
  const waterPipes = validateArray(map.waterPipes, 'state.map.waterPipes', assertBoolean);
  const landfillZones = validateArray(map.landfillZones, 'state.map.landfillZones', assertBoolean);
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if (!roads[tile] && roadConnectionMasks[tile] !== 0) {
      throw new Error(`state.map roadConnectionMasks requires road at tile ${tile}.`);
    }
    if (!avenueLanes[tile] && (avenueTravelMasks[tile] !== 0 || avenuePairMasks[tile] !== 0 || avenueMedianMasks[tile] !== 0)) {
      throw new Error(`state.map avenue masks require an avenue lane at tile ${tile}.`);
    }
    if (((avenueMedianMasks[tile] ?? 0) & ~(avenuePairMasks[tile] ?? 0)) !== 0) {
      throw new Error(`state.map avenue median mask requires a paired edge at tile ${tile}.`);
    }
    if (!rails[tile] && railConnectionMasks[tile] !== 0) {
      throw new Error(`state.map railConnectionMasks requires rail at tile ${tile}.`);
    }
    if (!subways[tile] && subwayConnectionMasks[tile] !== 0) {
      throw new Error(`state.map subwayConnectionMasks requires subway at tile ${tile}.`);
    }
    const transport = roads[tile] === true || avenueLanes[tile] === true;
    // Legacy saves may contain R/C/I zoning on a physical surface occupant.
    // Preserve that state long enough for the player to remove the invalid
    // zoning with Dezone; new zoning commands reject these placements.
    const powerSharesAllowedSurface = powerLines[tile] === true
      && avenueLanes[tile] !== true
      && ((roads[tile] === true && rails[tile] !== true)
        || (rails[tile] === true && roads[tile] !== true));
    const physicalOccupants = Number(transport || rails[tile] === true)
      + Number(powerLines[tile] === true && !powerSharesAllowedSurface)
      + Number(landfillZones[tile] === true);
    if (physicalOccupants > 1) throw new Error(`state.map has conflicting occupants at tile ${tile}.`);
    if (water[tile] === true && (zones[tile] !== null || physicalOccupants > 0)) {
      throw new Error(`state.map cannot place an occupant on water at tile ${tile}.`);
    }
    if (water[tile] === true && waterPipes[tile] === true) {
      throw new Error(`state.map cannot place a water pipe beneath surface water at tile ${tile}.`);
    }
  }
  validateTopologyMasks(roads, roadConnectionMasks, 'state.map.roadConnectionMasks', true);
  validateTopologyMasks(avenueLanes, avenueTravelMasks, 'state.map.avenueTravelMasks', false);
  validateTopologyMasks(avenueLanes, avenuePairMasks, 'state.map.avenuePairMasks', true);
  validateTopologyMasks(avenueLanes, avenueMedianMasks, 'state.map.avenueMedianMasks', true);
  validateTopologyMasks(rails, railConnectionMasks, 'state.map.railConnectionMasks', true);
  validateTopologyMasks(subways, subwayConnectionMasks, 'state.map.subwayConnectionMasks', true);

  if (!Array.isArray(map.facilities)) throw new Error('state.map.facilities must be an array.');
  const facilities: MarketFacility[] = [];
  const occupied = new Set<number>();
  const ids = new Set<string>();
  for (let index = 0; index < map.facilities.length; index += 1) {
    const path = `state.map.facilities[${index}]`;
    const raw = record(map.facilities[index], path, ['id', 'kind', 'anchor', 'tiles']);
    assertString(raw.id, `${path}.id`);
    if (ids.has(raw.id)) throw new Error(`${path}.id must be unique.`);
    ids.add(raw.id);
    assertFacilityKind(raw.kind, `${path}.kind`);
    assertInteger(raw.anchor, `${path}.anchor`, 0);
    if (raw.anchor >= TILE_COUNT) throw new Error(`${path}.anchor is outside the map.`);
    const expectedTiles = expectedPersistedFacilityTiles(raw.kind, raw.anchor, raw.tiles);
    const actualTiles = denseArray(raw.tiles, `${path}.tiles`, expectedTiles.length);
    for (let tileIndex = 0; tileIndex < actualTiles.length; tileIndex += 1) {
      const tile = actualTiles[tileIndex];
      assertInteger(tile, `${path}.tiles[${tileIndex}]`, 0);
      if (tile !== expectedTiles[tileIndex]) throw new Error(`${path}.tiles must match its rule-defined footprint.`);
      if (occupied.has(tile)) throw new Error(`${path}.tiles overlaps another facility.`);
      occupied.add(tile);
      if (water[tile] === true) throw new Error(`${path}.tiles cannot occupy water.`);
      if (roads[tile] === true
        || avenueLanes[tile] === true
        || rails[tile] === true
        || powerLines[tile] === true
        || landfillZones[tile] === true) {
        throw new Error(`${path}.tiles conflicts with another occupant.`);
      }
    }
    facilities.push({ id: raw.id, kind: raw.kind, anchor: raw.anchor, tiles: expectedTiles });
  }

  const economy = record(state.economy, 'state.economy', [
    'density', 'wealth', 'treasury', 'lastRevenue', 'lastOperatingExpense', 'lastNet',
  ]);
  validateArray(economy.density, 'state.economy.density', (item, path): asserts item is number => assertRange(item, path, 0, 1));
  validateArray(economy.wealth, 'state.economy.wealth', assertNonnegativeFiniteNumber);
  assertFiniteNumber(economy.treasury, 'state.economy.treasury');
  assertNonnegativeFiniteNumber(economy.lastRevenue, 'state.economy.lastRevenue');
  assertNonnegativeFiniteNumber(economy.lastOperatingExpense, 'state.economy.lastOperatingExpense');
  assertFiniteNumber(economy.lastNet, 'state.economy.lastNet');

  const environment = record(state.environment, 'state.environment', [
    'pollution', 'congestion', 'roadAccess', 'powered', 'watered',
  ]);
  validateArray(environment.pollution, 'state.environment.pollution', (item, path): asserts item is number => assertRange(item, path, 0, 100));
  validateArray(environment.congestion, 'state.environment.congestion', (item, path): asserts item is number => assertRange(item, path, 0, 1));
  validateArray(environment.roadAccess, 'state.environment.roadAccess', assertBoolean);
  validateArray(environment.powered, 'state.environment.powered', assertBoolean);
  validateArray(environment.watered, 'state.environment.watered', (item, path): asserts item is boolean => {
    assertBoolean(item, path);
  });

  const crime = record(state.crime, 'state.crime',
    ['derelict', 'share', 'targetShare', 'funding', 'tippedTotal', 'recoveredTotal']);
  const derelict = validateArray(crime.derelict, 'state.crime.derelict', assertBoolean);
  if (derelict.length !== TILE_COUNT) {
    throw new Error(`state.crime.derelict must hold ${TILE_COUNT} entries.`);
  }
  assertRange(crime.share, 'state.crime.share', 0, 1);
  assertRange(crime.targetShare, 'state.crime.targetShare', 0, 1);
  assertRange(crime.funding, 'state.crime.funding', 0, MARKET_CITY_RULES.police.maximumFunding);
  assertInteger(crime.tippedTotal, 'state.crime.tippedTotal', 0);
  assertInteger(crime.recoveredTotal, 'state.crime.recoveredTotal', 0);

  const fire = record(state.fire, 'state.fire', ['incidents', 'char', 'collapsedTotal', 'suppressedTotal', 'history']);
  if (!Array.isArray(fire.incidents)) throw new Error('state.fire.incidents must be an array.');
  const incidentIds = new Set<string>();
  const incidentTiles = new Set<number>();
  for (let index = 0; index < fire.incidents.length; index += 1) {
    const incident = validateFireIncident(fire.incidents[index], `state.fire.incidents[${index}]`);
    if (incident.startedMonth > clock.month) throw new Error(`state.fire.incidents[${index}] cannot start in the future.`);
    if (incident.rubbleMonthsRemaining > MARKET_CITY_RULES.fire.rubbleMonths) {
      throw new Error(`state.fire.incidents[${index}].rubbleMonthsRemaining exceeds the configured rubble duration.`);
    }
    if (incidentIds.has(incident.id)) throw new Error(`state.fire.incidents[${index}].id must be unique.`);
    incidentIds.add(incident.id);
    for (const tile of incident.tileIds) {
      if (incidentTiles.has(tile)) throw new Error(`state.fire.incidents overlap at tile ${tile}.`);
      incidentTiles.add(tile);
      if (zones[tile] !== incident.zone) throw new Error(`state.fire.incidents[${index}] must retain its original zoning.`);
    }
  }
  validateArray(fire.char, 'state.fire.char', (item, path): asserts item is number => assertRange(item, path, 0, 1));
  assertInteger(fire.collapsedTotal, 'state.fire.collapsedTotal', 0);
  assertInteger(fire.suppressedTotal, 'state.fire.suppressedTotal', 0);
  if (!Array.isArray(fire.history)) throw new Error('state.fire.history must be an array.');
  let previousSequence = 0;
  let previousMonth = 0;
  const historyLifecycle = new Map<string, {
    event: MarketFireHistoryEntry['event'];
    month: number;
    tileIds: string;
    zone: MarketFireHistoryEntry['zone'];
  }>();
  const ignitionMonthByIncident = new Map<string, number>();
  for (let index = 0; index < fire.history.length; index += 1) {
    const entry = validateFireHistoryEntry(fire.history[index], `state.fire.history[${index}]`);
    if (entry.sequence !== previousSequence + 1) throw new Error('state.fire.history sequence must be contiguous.');
    if (entry.month < previousMonth) throw new Error('state.fire.history months must be nondecreasing.');
    if (entry.month > clock.month) throw new Error('state.fire.history cannot contain future events.');
    if (entry.event === 'collapsed' && (
      entry.intensity !== 0
      || entry.rubbleMonthsRemaining !== MARKET_CITY_RULES.fire.rubbleMonths
    )) throw new Error('state.fire.history collapsed events must begin the complete rubble lifecycle.');
    if ((entry.event === 'suppressed' || entry.event === 'rubble-cleared') && (
      entry.intensity !== 0 || entry.rubbleMonthsRemaining !== 0
    )) throw new Error(`state.fire.history ${entry.event} events must be inactive.`);
    const prior = historyLifecycle.get(entry.incidentId);
    if (!prior && entry.event !== 'ignited') throw new Error('state.fire.history incidents must begin with ignited.');
    if (!prior) {
      if (entry.incidentId !== `fire-m${entry.month}-t${entry.tileIds[0]}`) {
        throw new Error('state.fire.history incident ids must match ignition month and canonical tile.');
      }
      ignitionMonthByIncident.set(entry.incidentId, entry.month);
    }
    if (prior) {
      if (prior.tileIds !== entry.tileIds.join(',') || prior.zone !== entry.zone) {
        throw new Error('state.fire.history incident footprint and zone must remain stable.');
      }
      const allowed = prior.event === 'ignited' || prior.event === 'burning'
        ? entry.event === 'burning' || entry.event === 'suppressed' || entry.event === 'collapsed'
        : prior.event === 'collapsed'
          ? entry.event === 'rubble-cleared'
            && entry.month === prior.month + MARKET_CITY_RULES.fire.rubbleMonths
          : false;
      if (!allowed) throw new Error('state.fire.history contains an impossible incident transition.');
    }
    historyLifecycle.set(entry.incidentId, {
      event: entry.event,
      month: entry.month,
      tileIds: entry.tileIds.join(','),
      zone: entry.zone,
    });
    previousSequence = entry.sequence;
    previousMonth = entry.month;
  }
  if (fire.collapsedTotal !== fire.history.filter((entry) => entry.event === 'collapsed').length) {
    throw new Error('state.fire.collapsedTotal must match fire history.');
  }
  if (fire.suppressedTotal !== fire.history.filter((entry) => entry.event === 'suppressed').length) {
    throw new Error('state.fire.suppressedTotal must match fire history.');
  }
  for (const incident of fire.incidents as MarketFireIncident[]) {
    const lifecycle = historyLifecycle.get(incident.id);
    const expected = incident.status === 'burning' ? new Set(['ignited', 'burning']) : new Set(['collapsed']);
    if (!lifecycle || !expected.has(lifecycle.event)) {
      throw new Error(`state.fire.incident ${incident.id} does not match its history lifecycle.`);
    }
    if (ignitionMonthByIncident.get(incident.id) !== incident.startedMonth) {
      throw new Error(`state.fire.incident ${incident.id} must match its ignition month.`);
    }
    if (incident.status === 'rubble') {
      const expectedRemaining = MARKET_CITY_RULES.fire.rubbleMonths - (clock.month - lifecycle.month);
      if (expectedRemaining < 1 || incident.rubbleMonthsRemaining !== expectedRemaining) {
        throw new Error(`state.fire.incident ${incident.id} has an invalid rubble timer.`);
      }
    }
  }

  const market = record(state.market, 'state.market', ['demand', 'margin', 'verticalDevelopmentLevel']);
  validateSectorValues(market.demand, 'state.market.demand', true);
  validateSectorValues(market.margin, 'state.market.margin', false);
  assertIntegerRange(market.verticalDevelopmentLevel, 'state.market.verticalDevelopmentLevel', 1, 10);

  const services = record(state.services, 'state.services', ['water', 'rail', 'waste']);
  const waterService = record(services.water, 'state.services.water', [
    'componentByTile', 'components', 'totalDemand', 'totalAllocated',
  ]);
  const componentByTile = validateArray(
    waterService.componentByTile,
    'state.services.water.componentByTile',
    (item, path): asserts item is string | null => {
      if (item !== null) {
        assertString(item, path);
      }
    },
  );
  if (!Array.isArray(waterService.components)) throw new Error('state.services.water.components must be an array.');
  assertNonnegativeFiniteNumber(waterService.totalDemand, 'state.services.water.totalDemand');
  assertNonnegativeFiniteNumber(waterService.totalAllocated, 'state.services.water.totalAllocated');
  const waterComponentIds = new Set<string>();
  const waterComponents: Array<{
    id: string;
    rawCapacity: number;
    treatmentCapacity: number;
    usableCapacity: number;
    demand: number;
    allocated: number;
  }> = [];
  for (let index = 0; index < waterService.components.length; index += 1) {
    const path = `state.services.water.components[${index}]`;
    const component = record(waterService.components[index], path, [
      'id', 'rawCapacity', 'treatmentCapacity', 'usableCapacity', 'demand', 'allocated',
    ]);
    assertString(component.id, `${path}.id`);
    if (waterComponentIds.has(component.id)) throw new Error(`${path}.id must be unique.`);
    waterComponentIds.add(component.id);
    for (const key of ['rawCapacity', 'treatmentCapacity', 'usableCapacity', 'demand', 'allocated'] as const) {
      assertNonnegativeFiniteNumber(component[key], `${path}.${key}`);
    }
    const expectedUsable = (component.rawCapacity as number)
      + Math.min(component.rawCapacity as number, component.treatmentCapacity as number);
    if (component.usableCapacity !== expectedUsable) {
      throw new Error(`${path}.usableCapacity must equal raw capacity plus the treatment bonus.`);
    }
    if ((component.allocated as number) > (component.demand as number)
      || (component.allocated as number) > (component.usableCapacity as number)) {
      throw new Error(`${path}.allocated cannot exceed demand or usable capacity.`);
    }
    waterComponents.push(component as typeof waterComponents[number]);
  }
  const mappedWaterTiles = new Map<string, number[]>();
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    const componentId = componentByTile[tile];
    if (componentId === null || componentId === undefined) continue;
    if (waterPipes[tile] !== true) {
      throw new Error(`state.services.water.componentByTile[${tile}] requires a water pipe.`);
    }
    if (!waterComponentIds.has(componentId)) {
      throw new Error(`state.services.water.componentByTile[${tile}] references an unknown component.`);
    }
    const memberTiles = mappedWaterTiles.get(componentId) ?? [];
    memberTiles.push(tile);
    mappedWaterTiles.set(componentId, memberTiles);
  }
  const expectedWaterOrder = waterComponents
    .map(({ id }) => id)
    .slice()
    .sort((left, right) => {
      const leftTile = Number(left.slice('water:'.length));
      const rightTile = Number(right.slice('water:'.length));
      return leftTile - rightTile || left.localeCompare(right);
    });
  if (waterComponents.some(({ id }) => !/^water:\d+$/.test(id))
    || waterComponents.some(({ id }, index) => id !== expectedWaterOrder[index])) {
    throw new Error('state.services.water.components must use canonical water:<minimum-tile> IDs in tile order.');
  }
  for (const { id } of waterComponents) {
    const members = mappedWaterTiles.get(id) ?? [];
    if (members.length === 0) throw new Error(`state.services.water component ${id} must own at least one pipe tile.`);
    if (id !== `water:${Math.min(...members)}`) {
      throw new Error(`state.services.water component ${id} must be named for its minimum pipe tile.`);
    }
    const pending = [members[0]!];
    const visited = new Set<number>();
    const memberSet = new Set(members);
    while (pending.length > 0) {
      const tile = pending.pop()!;
      if (visited.has(tile)) continue;
      visited.add(tile);
      const x = tile % MARKET_CITY_MAP_SIZE;
      const y = Math.floor(tile / MARKET_CITY_MAP_SIZE);
      for (const neighbor of [
        y > 0 ? tile - MARKET_CITY_MAP_SIZE : -1,
        x + 1 < MARKET_CITY_MAP_SIZE ? tile + 1 : -1,
        y + 1 < MARKET_CITY_MAP_SIZE ? tile + MARKET_CITY_MAP_SIZE : -1,
        x > 0 ? tile - 1 : -1,
      ]) {
        if (memberSet.has(neighbor) && !visited.has(neighbor)) pending.push(neighbor);
      }
    }
    if (visited.size !== members.length) throw new Error(`state.services.water component ${id} must be orthogonally connected.`);
  }
  const componentDemand = waterComponents.reduce((total, component) => total + component.demand, 0);
  const componentAllocated = waterComponents.reduce((total, component) => total + component.allocated, 0);
  if (waterService.totalDemand !== componentDemand || waterService.totalAllocated !== componentAllocated) {
    throw new Error('state.services.water totals must reconcile with component demand and allocation.');
  }
  const expectedWater = deriveWaterService(value as MarketCityStateV2);
  if (canonicalize(waterService) !== canonicalize(expectedWater.service)
    || canonicalize(environment.watered) !== canonicalize(expectedWater.watered)) {
    throw new Error('state.services.water and state.environment.watered must match the canonical water derivation.');
  }

  const railService = record(services.rail, 'state.services.rail', [
    'totalRidership', 'tileUsage', 'stationUsage',
  ]);
  assertInteger(railService.totalRidership, 'state.services.rail.totalRidership', 0);
  const railTileUsage = validateArray(
    railService.tileUsage,
    'state.services.rail.tileUsage',
    (item, path): asserts item is number => {
      assertInteger(item, path, 0);
    },
  );
  if (!Array.isArray(railService.stationUsage)) throw new Error('state.services.rail.stationUsage must be an array.');
  const stationIds = new Set<string>();
  let stationUsageTotal = 0;
  const trainStationIds = new Set(facilities.filter(({ kind }) => kind === 'train-station').map(({ id }) => id));
  for (let index = 0; index < railService.stationUsage.length; index += 1) {
    const path = `state.services.rail.stationUsage[${index}]`;
    const usage = record(railService.stationUsage[index], path, ['stationId', 'ridership']);
    assertString(usage.stationId, `${path}.stationId`);
    if (stationIds.has(usage.stationId)) throw new Error(`${path}.stationId must be unique.`);
    stationIds.add(usage.stationId);
    if (!trainStationIds.has(usage.stationId as string)) {
      throw new Error(`${path}.stationId must reference a real train station.`);
    }
    assertInteger(usage.ridership, `${path}.ridership`, 0);
    stationUsageTotal += usage.ridership as number;
  }
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if ((railTileUsage[tile] ?? 0) > 0 && !rails[tile]) {
      throw new Error(`state.services.rail.tileUsage[${tile}] requires rail.`);
    }
  }
  if (stationUsageTotal !== (railService.totalRidership as number) * 2) {
    throw new Error('state.services.rail station usage must count both endpoints of total ridership.');
  }
  if ((railService.totalRidership as number) > 0
    && (stationIds.size < 2 || !railTileUsage.some((usage) => usage > 0))) {
    throw new Error('state.services.rail positive ridership requires two stations and used rail.');
  }
  const railServiceIsEmpty = (railService.totalRidership as number) === 0
    && railService.stationUsage.length === 0
    && railTileUsage.every((usage) => usage === 0);
  if (trainStationIds.size >= 2 && rails.some(Boolean)) {
    const expectedRailService = derivePassengerRailService(value as MarketCityStateV2).service;
    if (canonicalize(railService) !== canonicalize(expectedRailService)) {
      throw new Error('state.services.rail must match the canonical passenger rail derivation.');
    }
  } else if (!railServiceIsEmpty) {
    throw new Error('state.services.rail must remain empty without a possible passenger leg.');
  }

  const wasteService = record(services.waste, 'state.services.waste', [
    'generatedThisMonth',
    'generatedLifetime',
    'landfilledThisMonth',
    'landfilledLifetime',
    'unmanagedThisMonth',
    'unmanagedLifetime',
    'storedByTile',
  ]);
  for (const key of [
    'generatedThisMonth',
    'generatedLifetime',
    'landfilledThisMonth',
    'landfilledLifetime',
    'unmanagedThisMonth',
    'unmanagedLifetime',
  ] as const) {
    assertInteger(wasteService[key], `state.services.waste.${key}`, 0);
  }
  const storedByTile = validateArray(
    wasteService.storedByTile,
    'state.services.waste.storedByTile',
    (item, path): asserts item is number => assertIntegerRange(
      item,
      path,
      0,
      MARKET_CITY_RULES.waste.cellStorageCapacity,
    ),
  );
  for (let tile = 0; tile < TILE_COUNT; tile += 1) {
    if ((storedByTile[tile] ?? 0) > 0 && !landfillZones[tile]) {
      throw new Error(`state.services.waste.storedByTile[${tile}] requires a landfill zone.`);
    }
  }
  if ((wasteService.generatedThisMonth as number)
    !== (wasteService.landfilledThisMonth as number) + (wasteService.unmanagedThisMonth as number)) {
    throw new Error('state.services.waste generatedThisMonth must equal landfilledThisMonth plus unmanagedThisMonth.');
  }
  if ((wasteService.generatedLifetime as number)
    !== (wasteService.landfilledLifetime as number) + (wasteService.unmanagedLifetime as number)) {
    throw new Error('state.services.waste generatedLifetime must equal landfilledLifetime plus unmanagedLifetime.');
  }
  for (const pair of [
    ['generatedThisMonth', 'generatedLifetime'],
    ['landfilledThisMonth', 'landfilledLifetime'],
    ['unmanagedThisMonth', 'unmanagedLifetime'],
  ] as const) {
    if ((wasteService[pair[0]] as number) > (wasteService[pair[1]] as number)) {
      throw new Error(`state.services.waste.${pair[0]} cannot exceed ${pair[1]}.`);
    }
  }
  const storedTotal = storedByTile.reduce((total, stored) => total + stored, 0);
  if (storedTotal !== wasteService.landfilledLifetime) {
    throw new Error('state.services.waste storedByTile total must equal landfilledLifetime.');
  }

  return cloneMarketCityState(value as MarketCityStateV2);
}

function assertIntegerRange(
  value: unknown,
  path: string,
  minimum: number,
  maximum: number,
): asserts value is number {
  assertInteger(value, path, minimum);
  if ((value as number) > maximum) throw new Error(`${path} must be an integer between ${minimum} and ${maximum}.`);
}
