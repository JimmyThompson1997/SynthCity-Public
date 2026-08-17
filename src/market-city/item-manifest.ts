export const MARKET_ITEM_CONTRACT_FIELDS = Object.freeze([
  'ui',
  'engine',
  'renderer',
  'inspector',
  'persistence',
  'browser',
] as const);

export type MarketItemContractField = typeof MARKET_ITEM_CONTRACT_FIELDS[number];
export type MarketItemStatus = 'active' | 'planned';
export type MarketItemKind = 'zone' | 'network' | 'facility' | 'service-zone';
export type MarketItemCategory = 'zoning' | 'roads' | 'transit' | 'utilities' | 'public-services';

export interface MarketItemContracts {
  readonly ui: string;
  readonly engine: string;
  readonly renderer: string;
  readonly inspector: string;
  readonly persistence: string;
  readonly browser: string;
}

interface MarketItemManifestEntryBase {
  readonly id: string;
  readonly label: string;
  readonly kind: MarketItemKind;
  readonly category: MarketItemCategory;
  readonly action: string;
  readonly footprint: Readonly<{ width: number; height: number }>;
}

export interface ActiveMarketItemManifestEntry extends MarketItemManifestEntryBase {
  readonly status: 'active';
  readonly contracts: Readonly<MarketItemContracts>;
}

export interface PlannedMarketItemManifestEntry extends MarketItemManifestEntryBase {
  readonly status: 'planned';
  readonly contracts: Readonly<Partial<MarketItemContracts>>;
}

export type MarketItemManifestEntry =
  | ActiveMarketItemManifestEntry
  | PlannedMarketItemManifestEntry;

export interface MarketItemManifestIssue {
  readonly itemId: string;
  readonly field: string;
  readonly reason: string;
}

const footprint = (width: number, height: number) => Object.freeze({ width, height });

const active = (
  entry: Omit<ActiveMarketItemManifestEntry, 'status' | 'footprint' | 'contracts'> & {
    readonly footprint: readonly [width: number, height: number];
    readonly contracts: MarketItemContracts;
  },
): ActiveMarketItemManifestEntry => Object.freeze({
  ...entry,
  status: 'active' as const,
  footprint: footprint(entry.footprint[0], entry.footprint[1]),
  contracts: Object.freeze({ ...entry.contracts }),
});

const planned = (
  entry: Omit<PlannedMarketItemManifestEntry, 'status' | 'footprint' | 'contracts'> & {
    readonly footprint: readonly [width: number, height: number];
    readonly contracts?: Partial<MarketItemContracts>;
  },
): PlannedMarketItemManifestEntry => Object.freeze({
  ...entry,
  status: 'planned' as const,
  footprint: footprint(entry.footprint[0], entry.footprint[1]),
  contracts: Object.freeze({ ...entry.contracts }),
});

export const MARKET_ITEM_MANIFEST = Object.freeze([
  active({
    id: 'zone-residential', label: 'Residential Zone', kind: 'zone', category: 'zoning',
    action: 'zone:R', footprint: [1, 1],
    contracts: {
      ui: 'tool:zone-residential', engine: 'command:zone:R', renderer: 'layer:zone:R',
      inspector: 'query:tile:zone:R', persistence: 'map.zones:R', browser: 'e2e:visible-control:zone-residential',
    },
  }),
  active({
    id: 'zone-commercial', label: 'Commercial Zone', kind: 'zone', category: 'zoning',
    action: 'zone:C', footprint: [1, 1],
    contracts: {
      ui: 'tool:zone-commercial', engine: 'command:zone:C', renderer: 'layer:zone:C',
      inspector: 'query:tile:zone:C', persistence: 'map.zones:C', browser: 'e2e:visible-control:zone-commercial',
    },
  }),
  active({
    id: 'zone-industrial', label: 'Industrial Zone', kind: 'zone', category: 'zoning',
    action: 'zone:I', footprint: [1, 1],
    contracts: {
      ui: 'tool:zone-industrial', engine: 'command:zone:I', renderer: 'layer:zone:I',
      inspector: 'query:tile:zone:I', persistence: 'map.zones:I', browser: 'e2e:visible-control:zone-industrial',
    },
  }),
  active({
    id: 'road', label: 'Road', kind: 'network', category: 'roads',
    action: 'place-road', footprint: [1, 1],
    contracts: {
      ui: 'tool:road', engine: 'command:place-road', renderer: 'layer:roads',
      inspector: 'query:tile:road', persistence: 'map.roads', browser: 'e2e:visible-control:road',
    },
  }),
  active({
    id: 'avenue', label: 'Avenue', kind: 'network', category: 'roads',
    action: 'place-avenue', footprint: [2, 2],
    contracts: {
      ui: 'tool:avenue', engine: 'command:place-avenue', renderer: 'layer:avenue-lanes',
      inspector: 'query:tile:avenue', persistence: 'map.avenueLanes', browser: 'e2e:visible-control:avenue',
    },
  }),
  active({
    id: 'rail', label: 'Rail', kind: 'network', category: 'transit',
    action: 'place-rail', footprint: [1, 1],
    contracts: {
      ui: 'tool:rail', engine: 'command:place-rail', renderer: 'layer:rails',
      inspector: 'query:tile:rail', persistence: 'map.rails+map.railConnectionMasks',
      browser: 'e2e:visible-control:rail',
    },
  }),
  active({
    id: 'subway', label: 'Subway Tunnel', kind: 'network', category: 'transit',
    action: 'place-subway', footprint: [1, 1],
    contracts: {
      ui: 'tool:subway', engine: 'command:place-subway', renderer: 'layer:subways',
      inspector: 'query:tile:subway', persistence: 'map.subways+map.subwayConnectionMasks', browser: 'e2e:visible-control:subway',
    },
  }),
  active({
    id: 'power-line', label: 'Power Line', kind: 'network', category: 'utilities',
    action: 'place-power-line', footprint: [1, 1],
    contracts: {
      ui: 'tool:power-line', engine: 'command:place-power-line', renderer: 'layer:power-lines',
      inspector: 'query:tile:power-line', persistence: 'map.powerLines', browser: 'e2e:visible-control:power-line',
    },
  }),
  active({
    id: 'water-pipe', label: 'Water Pipe', kind: 'network', category: 'utilities',
    action: 'place-water-pipe', footprint: [1, 1],
    contracts: {
      ui: 'tool:water-pipe', engine: 'command:place-water-pipe', renderer: 'layer:water-pipes',
      inspector: 'query:tile:water-pipe', persistence: 'map.waterPipes+services.water',
      browser: 'e2e:visible-control:water-pipe',
    },
  }),
  active({
    id: 'coal-power-plant', label: 'Coal Power Plant', kind: 'facility', category: 'utilities',
    action: 'place-facility:coal-power-plant', footprint: [2, 3],
    contracts: {
      ui: 'catalog:power:coal-power-plant', engine: 'command:place-facility:coal-power-plant',
      renderer: 'facility:coal-power-plant', inspector: 'query:facility:coal-power-plant',
      persistence: 'facilities:coal-power-plant', browser: 'e2e:visible-control:coal-power-plant',
    },
  }),
  active({
    id: 'gas-power-plant', label: 'Natural Gas Plant', kind: 'facility', category: 'utilities',
    action: 'place-facility:gas-power-plant', footprint: [2, 3],
    contracts: {
      ui: 'catalog:power:gas-power-plant', engine: 'command:place-facility:gas-power-plant',
      renderer: 'facility:gas-power-plant', inspector: 'query:facility:gas-power-plant',
      persistence: 'facilities:gas-power-plant', browser: 'e2e:visible-control:gas-power-plant',
    },
  }),
  active({
    id: 'nuclear-power-plant', label: 'Nuclear Power Plant', kind: 'facility', category: 'utilities',
    action: 'place-facility:nuclear-power-plant', footprint: [3, 3],
    contracts: {
      ui: 'catalog:power:nuclear-power-plant', engine: 'command:place-facility:nuclear-power-plant',
      renderer: 'facility:nuclear-power-plant', inspector: 'query:facility:nuclear-power-plant',
      persistence: 'facilities:nuclear-power-plant', browser: 'e2e:visible-control:nuclear-power-plant',
    },
  }),
  active({
    id: 'wind-turbine', label: 'Wind Turbine', kind: 'facility', category: 'utilities',
    action: 'place-facility:wind-turbine', footprint: [1, 1],
    contracts: {
      ui: 'catalog:power:wind-turbine', engine: 'command:place-facility:wind-turbine',
      renderer: 'facility:wind-turbine', inspector: 'query:facility:wind-turbine',
      persistence: 'facilities:wind-turbine', browser: 'e2e:visible-control:wind-turbine',
    },
  }),
  active({
    id: 'solar-plant', label: 'Solar Plant', kind: 'facility', category: 'utilities',
    action: 'place-facility:solar-plant', footprint: [4, 2],
    contracts: {
      ui: 'catalog:power:solar-plant', engine: 'command:place-facility:solar-plant',
      renderer: 'facility:solar-plant', inspector: 'query:facility:solar-plant',
      persistence: 'facilities:solar-plant', browser: 'e2e:visible-control:solar-plant',
    },
  }),
  active({
    id: 'water-tower', label: 'Water Tower', kind: 'facility', category: 'utilities',
    action: 'place-facility:water-tower', footprint: [2, 2],
    contracts: {
      ui: 'catalog:water:water-tower', engine: 'command:place-facility:water-tower',
      renderer: 'facility:water-tower', inspector: 'query:facility:water-tower',
      persistence: 'facilities:water-tower+services.water', browser: 'e2e:visible-control:water-tower',
    },
  }),
  active({
    id: 'coastal-water-pump', label: 'Coastal Water Pump', kind: 'facility', category: 'utilities',
    action: 'place-facility:coastal-water-pump', footprint: [3, 3],
    contracts: {
      ui: 'catalog:water:coastal-water-pump', engine: 'command:place-facility:coastal-water-pump',
      renderer: 'facility:coastal-water-pump', inspector: 'query:facility:coastal-water-pump',
      persistence: 'facilities:coastal-water-pump+services.water', browser: 'e2e:visible-control:coastal-water-pump',
    },
  }),
  active({
    id: 'water-treatment-plant', label: 'Water Treatment Plant', kind: 'facility', category: 'utilities',
    action: 'place-facility:water-treatment-plant', footprint: [4, 3],
    contracts: {
      ui: 'catalog:water:water-treatment-plant', engine: 'command:place-facility:water-treatment-plant',
      renderer: 'facility:water-treatment-plant', inspector: 'query:facility:water-treatment-plant',
      persistence: 'facilities:water-treatment-plant+services.water',
      browser: 'e2e:visible-control:water-treatment-plant',
    },
  }),
  active({
    id: 'train-station', label: 'Train Station', kind: 'facility', category: 'transit',
    action: 'place-facility:train-station', footprint: [2, 2],
    contracts: {
      ui: 'catalog:transit:train-station', engine: 'command:place-facility:train-station',
      renderer: 'facility:train-station', inspector: 'query:facility:train-station',
      persistence: 'facilities:train-station+services.rail', browser: 'e2e:visible-control:train-station',
    },
  }),
  active({
    id: 'subway-station', label: 'Subway Station', kind: 'facility', category: 'transit',
    action: 'place-facility:subway-station', footprint: [1, 1],
    contracts: {
      ui: 'catalog:transit:subway-station', engine: 'command:place-facility:subway-station',
      renderer: 'facility:subway-station+layer:subways', inspector: 'query:facility:subway-station',
      persistence: 'facilities:subway-station', browser: 'e2e:visible-control:subway-station',
    },
  }),
  active({
    id: 'fire-station', label: 'Fire Station', kind: 'facility', category: 'public-services',
    action: 'place-facility:fire-station', footprint: [1, 1],
    contracts: {
      ui: 'catalog:fire:fire-station', engine: 'command:place-facility:fire-station',
      renderer: 'facility:fire-station', inspector: 'query:facility:fire-station',
      persistence: 'facilities:fire-station', browser: 'e2e:visible-control:fire-station',
    },
  }),
  active({
    id: 'police-station', label: 'Police Station', kind: 'facility', category: 'public-services',
    action: 'place-facility:police-station', footprint: [1, 1],
    contracts: {
      ui: 'catalog:safety:police-station', engine: 'command:place-facility:police-station',
      renderer: 'facility:police-station', inspector: 'query:facility:police-station',
      persistence: 'facilities:police-station', browser: 'e2e:visible-control:police-station',
    },
  }),
  active({
    id: 'landfill-zone', label: 'Landfill Zone', kind: 'service-zone', category: 'public-services',
    action: 'zone-landfill', footprint: [1, 1],
    contracts: {
      ui: 'catalog:waste:landfill-zone', engine: 'command:zone-landfill',
      renderer: 'service-zone:landfill', inspector: 'query:tile:landfill',
      persistence: 'map.landfillZones+services.waste', browser: 'e2e:visible-control:landfill-zone',
    },
  }),
] satisfies readonly MarketItemManifestEntry[]);

const isNonEmptyIdentifier = (value: unknown): value is string => (
  typeof value === 'string' && value.trim().length > 0
);

export function validateMarketItemManifest(
  manifest: readonly MarketItemManifestEntry[],
): readonly MarketItemManifestIssue[] {
  const issues: MarketItemManifestIssue[] = [];
  const seenIds = new Set<string>();

  for (const item of manifest) {
    if (!isNonEmptyIdentifier(item.id)) {
      issues.push({ itemId: item.id, field: 'id', reason: 'must be a non-empty identifier' });
    } else if (seenIds.has(item.id)) {
      issues.push({ itemId: item.id, field: 'id', reason: 'must be unique' });
    }
    seenIds.add(item.id);

    for (const field of ['label', 'action'] as const) {
      if (!isNonEmptyIdentifier(item[field])) {
        issues.push({ itemId: item.id, field, reason: 'must be a non-empty identifier' });
      }
    }

    for (const dimension of ['width', 'height'] as const) {
      if (!Number.isInteger(item.footprint[dimension]) || item.footprint[dimension] < 1) {
        issues.push({ itemId: item.id, field: `footprint.${dimension}`, reason: 'must be a positive integer' });
      }
    }

    for (const field of MARKET_ITEM_CONTRACT_FIELDS) {
      const value = item.contracts[field];
      if (item.status === 'active' && !isNonEmptyIdentifier(value)) {
        issues.push({ itemId: item.id, field: `contracts.${field}`, reason: 'must be a non-empty identifier' });
      } else if (value !== undefined && !isNonEmptyIdentifier(value)) {
        issues.push({ itemId: item.id, field: `contracts.${field}`, reason: 'must be a non-empty identifier when declared' });
      }
    }
  }

  return Object.freeze(issues);
}

export function assertMarketItemManifestComplete(manifest: readonly MarketItemManifestEntry[]): void {
  const issues = validateMarketItemManifest(manifest);
  if (issues.length === 0) return;

  throw new Error(issues.map((issue) => (
    `${issue.itemId} ${issue.field} ${issue.reason}`
  )).join('\n'));
}
