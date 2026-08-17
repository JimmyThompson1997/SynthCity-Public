import { MARKET_CITY_RULES } from './rules';
import type { MarketFacilityKindV1, MarketPowerPlantKind, MarketWaterFacilityKind } from './types';

type ActiveMarketFacilityKind = MarketFacilityKindV1 | MarketWaterFacilityKind | 'train-station' | 'subway-station' | 'police-station';

export interface MarketNetworkCatalogEntry {
  kind: 'road' | 'avenue' | 'rail' | 'subway' | 'power-line' | 'water-pipe';
  label: string;
  category: 'roads' | 'transit' | 'utilities';
  footprint: Readonly<{ width: number; height: number }>;
  buildCost: 0;
  costUnit: 'per-tile';
  monthlyMaintenancePerTile: number;
  capabilities: readonly string[];
}

export interface MarketFacilityCatalogEntry {
  kind: ActiveMarketFacilityKind;
  label: string;
  category: 'power' | 'fire' | 'transit' | 'water' | 'safety';
  footprint: Readonly<{ width: number; height: number }>;
  buildCost: 0;
  costUnit: 'per-facility';
  monthlyMaintenance: number;
  operatingCapacity: number;
  pollutionMultiplier: number;
  serviceRadius: number;
  capabilities: readonly string[];
}

export interface MarketServiceZoneCatalogEntry {
  kind: 'landfill';
  label: string;
  category: 'waste';
  footprint: Readonly<{ width: 1; height: 1 }>;
  buildCost: 0;
  costUnit: 'per-tile';
  monthlyMaintenance: 0;
  monthlyIntake: number;
  storageCapacity: number;
  capabilities: readonly string[];
}

const network = (
  kind: MarketNetworkCatalogEntry['kind'],
  label: string,
  category: MarketNetworkCatalogEntry['category'],
  monthlyMaintenancePerTile: number,
  footprint: Readonly<{ width: number; height: number }> = { width: 1, height: 1 },
): MarketNetworkCatalogEntry => Object.freeze({
  kind,
  label,
  category,
  footprint: Object.freeze({ ...footprint }),
  buildCost: 0,
  costUnit: 'per-tile',
  monthlyMaintenancePerTile,
  capabilities: Object.freeze(kind === 'road'
    ? ['free-placement', 'radius-three-access', 'plant-access', 'congestion']
    : kind === 'avenue'
      ? ['free-placement', 'paired-lanes', 'opposing-directions', 'radius-three-access', 'plant-access']
      : kind === 'rail'
        ? ['ordered-path', 'curves', 'junctions', 'road-crossings', 'power-crossings', 'passenger-shuttles']
      : kind === 'subway'
        ? ['ordered-underground-path', 'curves', 'junctions', 'surface-coexistence']
      : kind === 'water-pipe'
        ? ['free-placement', 'underground', 'orthogonal-components', 'radius-seven-coverage']
      : ['free-placement', 'orthogonal-conduction', 'road-crossings', 'rail-crossings', 'one-road-bridge']),
});

const plant = (
  kind: MarketPowerPlantKind,
  label: string,
): MarketFacilityCatalogEntry => {
  const rules = MARKET_CITY_RULES.plants[kind];
  return Object.freeze({
    kind,
    label,
    category: 'power' as const,
    footprint: Object.freeze({ width: rules.footprint[0], height: rules.footprint[1] }),
    buildCost: 0 as const,
    costUnit: 'per-facility' as const,
    monthlyMaintenance: rules.monthlyExpense,
    operatingCapacity: rules.capacity,
    pollutionMultiplier: rules.pollutionMultiplier,
    serviceRadius: 0,
    capabilities: Object.freeze([
      'free-placement',
      'power-generation',
      'typed-cost',
      'typed-pollution',
      ...(rules.requiresRoad ? ['road-gated'] : []),
      ...(rules.waterDemand > 0 ? ['water-gated'] : []),
    ]),
  });
};

export const MARKET_NETWORK_CATALOG = Object.freeze({
  road: network('road', 'Road', 'roads', MARKET_CITY_RULES.roadMonthlyExpense),
  avenue: network(
    'avenue',
    'Avenue',
    'roads',
    MARKET_CITY_RULES.roadMonthlyExpense,
    { width: 2, height: 2 },
  ),
  rail: network('rail', 'Rail', 'transit', 0),
  subway: network('subway', 'Subway Tunnel', 'transit', 0),
  'power-line': network('power-line', 'Power Line', 'utilities', MARKET_CITY_RULES.powerLineMonthlyExpense),
  'water-pipe': network('water-pipe', 'Water Pipe', 'utilities', 0),
});

export const MARKET_FACILITY_CATALOG = Object.freeze({
  'coal-power-plant': plant('coal-power-plant', 'Coal Power Plant'),
  'gas-power-plant': plant('gas-power-plant', 'Natural Gas Plant'),
  'nuclear-power-plant': plant('nuclear-power-plant', 'Nuclear Power Plant'),
  'wind-turbine': plant('wind-turbine', 'Wind Turbine'),
  'solar-plant': plant('solar-plant', 'Solar Plant'),
  'water-tower': Object.freeze({
    kind: 'water-tower' as const, label: 'Water Tower', category: 'water' as const,
    footprint: Object.freeze({ width: 2, height: 2 }), buildCost: 0 as const,
    costUnit: 'per-facility' as const, monthlyMaintenance: 0, operatingCapacity: 20_000,
    pollutionMultiplier: 0, serviceRadius: 7,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'power-gated', 'pipe-connected', 'raw-water-source']),
  }),
  'coastal-water-pump': Object.freeze({
    kind: 'coastal-water-pump' as const, label: 'Coastal Water Pump', category: 'water' as const,
    footprint: Object.freeze({ width: 3, height: 3 }), buildCost: 0 as const,
    costUnit: 'per-facility' as const, monthlyMaintenance: 0, operatingCapacity: 75_000,
    pollutionMultiplier: 0, serviceRadius: 7,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'power-gated', 'pipe-connected', 'shoreline-gated', 'raw-water-source']),
  }),
  'water-treatment-plant': Object.freeze({
    kind: 'water-treatment-plant' as const, label: 'Water Treatment Plant', category: 'water' as const,
    footprint: Object.freeze({ width: 4, height: 3 }), buildCost: 0 as const,
    costUnit: 'per-facility' as const, monthlyMaintenance: 0, operatingCapacity: 50_000,
    pollutionMultiplier: 0, serviceRadius: 7,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'power-gated', 'pipe-connected', 'treatment-bonus']),
  }),
  'train-station': Object.freeze({
    kind: 'train-station' as const,
    label: 'Train Station',
    category: 'transit' as const,
    footprint: Object.freeze({ width: 2, height: 2 }),
    buildCost: 0 as const,
    costUnit: 'per-facility' as const,
    monthlyMaintenance: 0,
    operatingCapacity: 0,
    pollutionMultiplier: 0,
    serviceRadius: 6,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'rail-adjacent', 'power-gated', 'water-covered', 'passenger-catchment']),
  }),
  'subway-station': Object.freeze({
    kind: 'subway-station' as const,
    label: 'Subway Station',
    category: 'transit' as const,
    footprint: Object.freeze({ width: 1, height: 1 }),
    buildCost: 0 as const,
    costUnit: 'per-facility' as const,
    monthlyMaintenance: 0,
    operatingCapacity: 0,
    pollutionMultiplier: 0,
    serviceRadius: 0,
    capabilities: Object.freeze(['free-placement', 'tunnel-directly-below', 'surface-entrance']),
  }),
  'fire-station': Object.freeze({
    kind: 'fire-station' as const,
    label: 'Fire Station',
    category: 'fire' as const,
    footprint: Object.freeze({ width: 1, height: 1 }),
    buildCost: 0 as const,
    costUnit: 'per-facility' as const,
    monthlyMaintenance: MARKET_CITY_RULES.fireStationMonthlyExpense,
    operatingCapacity: MARKET_CITY_RULES.fire.stationPower,
    pollutionMultiplier: 0,
    serviceRadius: MARKET_CITY_RULES.fire.stationRadius,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'power-gated', 'radius-twenty-one-suppression', 'shared-fire-capacity']),
  }),
  'police-station': Object.freeze({
    kind: 'police-station' as const,
    label: 'Police Station',
    category: 'safety' as const,
    // 1x1 like the fire station: the placed cube IS the art, so the ghost and
    // the footprint outline cannot drift apart during placement preview.
    footprint: Object.freeze({ width: 1, height: 1 }),
    buildCost: 0 as const,
    costUnit: 'per-facility' as const,
    monthlyMaintenance: MARKET_CITY_RULES.policeStationMonthlyExpense,
    operatingCapacity: MARKET_CITY_RULES.police.stationSuppression,
    pollutionMultiplier: 0,
    serviceRadius: MARKET_CITY_RULES.police.stationRadius,
    capabilities: Object.freeze(['free-placement', 'road-gated', 'power-gated', 'radius-height-bonus', 'citywide-suppression']),
  }),
} satisfies Record<ActiveMarketFacilityKind, MarketFacilityCatalogEntry>);

export const MARKET_SERVICE_ZONE_CATALOG = Object.freeze({
  landfill: Object.freeze({
    kind: 'landfill' as const,
    label: 'Landfill Zone',
    category: 'waste' as const,
    footprint: Object.freeze({ width: 1 as const, height: 1 as const }),
    buildCost: 0 as const,
    costUnit: 'per-tile' as const,
    monthlyMaintenance: 0 as const,
    monthlyIntake: MARKET_CITY_RULES.waste.cellMonthlyIntake,
    storageCapacity: MARKET_CITY_RULES.waste.cellStorageCapacity,
    capabilities: Object.freeze(['free-placement', 'road-gated-collection', 'component-stable-allocation', 'stored-waste-lock']),
  }),
} satisfies Record<'landfill', MarketServiceZoneCatalogEntry>);

/**
 * Visual-only footprints keep retired facility art inspectable in the gallery.
 * Entries outside MARKET_FACILITY_CATALOG are never offered to the player and
 * have no simulator command or persistence representation.
 */
export const INACTIVE_FACILITY_VISUAL_FOOTPRINTS = Object.freeze({
  'recycling-center': Object.freeze({ width: 6, height: 5 }),
  incinerator: Object.freeze({ width: 6, height: 5 }),
  'bus-stop': Object.freeze({ width: 1, height: 1 }),
  'health-clinic': Object.freeze({ width: 3, height: 2 }),
  school: Object.freeze({ width: 4, height: 3 }),
  'green-space': Object.freeze({ width: 1, height: 1 }),
  playground: Object.freeze({ width: 2, height: 2 }),
  'neighborhood-park': Object.freeze({ width: 4, height: 4 }),
});

export function marketFacilityVisualFootprint(kind: string): Readonly<{ width: number; height: number }> | null {
  const active = MARKET_FACILITY_CATALOG[kind as ActiveMarketFacilityKind];
  if (active) return active.footprint;
  return INACTIVE_FACILITY_VISUAL_FOOTPRINTS[
    kind as keyof typeof INACTIVE_FACILITY_VISUAL_FOOTPRINTS
  ] ?? null;
}
