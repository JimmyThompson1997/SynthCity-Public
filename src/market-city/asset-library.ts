import {
  INACTIVE_FACILITY_VISUAL_FOOTPRINTS,
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
  MARKET_SERVICE_ZONE_CATALOG,
} from './catalog';
import {
  deriveBuildingAppearanceVariants,
  type MarketBuildingAppearanceVariant,
} from './appearance';
import {
  defaultAssetVisualVariantForSlot,
  VISUAL_ASSET_VARIANTS,
  type AssetVisualSlot,
} from './asset-visuals';
import type { MarketLotFootprint, MarketZoneKind } from './types';

export type AssetLibraryStatus = 'live' | 'visual-only';
export type AssetLibrarySection =
  | 'residential'
  | 'commercial'
  | 'industrial'
  | 'civic'
  | 'power-water'
  | 'transit-network'
  | 'waste'
  | 'archive';
export type AssetLibraryType = 'rci-system' | 'rci-variant' | 'network' | 'facility' | 'facility-visual-variant' | 'service-zone';

export interface AssetLibraryEntry {
  readonly id: string;
  readonly status: AssetLibraryStatus;
  readonly section: AssetLibrarySection;
  readonly type: AssetLibraryType;
  readonly label: string;
  readonly kind: string;
  readonly zone?: MarketZoneKind;
  readonly height?: number;
  readonly footprint: Readonly<{ width: number; height: number }>;
  readonly lotFootprint?: MarketLotFootprint;
  readonly roof?: string;
  readonly roofOrientation?: number;
  readonly detail?: string | null;
  readonly landmark?: boolean;
  readonly activationSlot?: AssetVisualSlot;
  readonly visualVariantId?: string;
  readonly visualVariantDefault?: boolean;
  readonly capabilities: readonly string[];
  readonly serviceRadius?: number;
  readonly renderer: 'market-rci-svg-v1' | 'shared-v1';
  readonly authority: string;
}

const ZONE_LABEL: Readonly<Record<MarketZoneKind, string>> = Object.freeze({
  R: 'Residential',
  C: 'Commercial',
  I: 'Industrial',
});

const ARCHIVE_LABELS = Object.freeze({
  'recycling-center': 'Recycling Center',
  incinerator: 'Incinerator',
  'bus-stop': 'Bus Stop',
  'health-clinic': 'Health Clinic',
  school: 'School',
  'green-space': 'Green Space',
  playground: 'Playground',
  'neighborhood-park': 'Neighborhood Park',
} satisfies Record<keyof typeof INACTIVE_FACILITY_VISUAL_FOOTPRINTS, string>);

const rciSystem = (zone: MarketZoneKind): AssetLibraryEntry => Object.freeze({
  id: `live:rci:${zone}`,
  status: 'live',
  section: zone === 'R' ? 'residential' : zone === 'C' ? 'commercial' : 'industrial',
  type: 'rci-system',
  label: `${ZONE_LABEL[zone]} building system`,
  kind: `rci-${zone.toLowerCase()}`,
  zone,
  footprint: Object.freeze({ width: 1, height: 1 }),
  capabilities: Object.freeze(['market-derived-density', 'height-one-to-ten', 'shared-footprint-allocator']),
  renderer: 'market-rci-svg-v1',
  authority: 'src/market-city/appearance.ts',
});

const facilitySection = (category: string): AssetLibrarySection => {
  if (category === 'power' || category === 'water') return 'power-water';
  // Both public safety services belong beside each other under civic.
  if (category === 'fire' || category === 'safety') return 'civic';
  return 'transit-network';
};

const networkSection = (category: string): AssetLibrarySection => (
  category === 'utilities' ? 'power-water' : 'transit-network'
);

const visualSection = (kind: keyof typeof INACTIVE_FACILITY_VISUAL_FOOTPRINTS): AssetLibrarySection => (
  kind === 'recycling-center' || kind === 'incinerator' ? 'waste' : 'archive'
);

function capabilityText(capability: string): string {
  const known: Record<string, string> = {
    'road-gated': 'Requires road access',
    'power-gated': 'Requires power access',
    'water-covered': 'Requires water service',
    'pipe-connected': 'Requires pipe connection',
    'shoreline-gated': 'Requires shoreline',
    'rail-adjacent': 'Requires adjacent rail',
    'tunnel-directly-below': 'Requires tunnel directly below',
    'road-gated-collection': 'Requires road collection access',
  };
  return known[capability] ?? capability.replaceAll('-', ' ');
}

export function assetLibraryCapabilityText(capability: string): string {
  return capabilityText(capability);
}

export function deriveAssetLibraryRciVariants(maximumHeight = 10): readonly AssetLibraryEntry[] {
  const variants = deriveBuildingAppearanceVariants(maximumHeight);
  return Object.freeze(variants.map((variant: MarketBuildingAppearanceVariant) => Object.freeze({
    id: [
      'live:rci-variant',
      variant.zone,
      variant.height,
      variant.footprint,
      variant.roof,
      variant.roofOrientation,
      variant.detail ?? 'none',
      variant.landmark ? 'landmark' : 'ordinary',
    ].join(':'),
    status: 'live' as const,
    section: variant.zone === 'R' ? 'residential' : variant.zone === 'C' ? 'commercial' : 'industrial',
    type: 'rci-variant' as const,
    label: `${ZONE_LABEL[variant.zone]} ${variant.height}-storey ${variant.roof} ${variant.footprint}${variant.landmark ? ' landmark' : ''}`,
    kind: 'rci-variant',
    zone: variant.zone,
    height: variant.height,
    footprint: Object.freeze({ width: 1, height: 1 }),
    lotFootprint: variant.footprint,
    roof: variant.roof,
    roofOrientation: variant.roofOrientation,
    detail: variant.detail,
    landmark: variant.landmark,
    capabilities: Object.freeze(['market-derived-density', 'height-one-to-ten']),
    renderer: 'market-rci-svg-v1' as const,
    authority: 'src/market-city/appearance.ts',
  })));
}

/** Current game entries plus cleared, retired visual artifacts. */
export function deriveAssetLibraryEntries(): readonly AssetLibraryEntry[] {
  const entries: AssetLibraryEntry[] = (['R', 'C', 'I'] as const).map(rciSystem);

  Object.values(MARKET_NETWORK_CATALOG).forEach((entry) => {
    entries.push(Object.freeze({
      id: `live:network:${entry.kind}`,
      status: 'live',
      section: networkSection(entry.category),
      type: 'network',
      label: entry.label,
      kind: entry.kind,
      footprint: entry.footprint,
      capabilities: entry.capabilities,
      renderer: 'shared-v1',
      authority: 'src/market-city/catalog.ts',
    }));
  });

  Object.values(MARKET_FACILITY_CATALOG).forEach((entry) => {
    const activation = entry.kind === 'fire-station'
      ? defaultAssetVisualVariantForSlot('facility:fire-station')
      : null;
    entries.push(Object.freeze({
      id: `live:facility:${entry.kind}`,
      status: 'live',
      section: facilitySection(entry.category),
      type: 'facility',
      label: entry.label,
      kind: entry.kind,
      footprint: entry.footprint,
      capabilities: entry.capabilities,
      serviceRadius: entry.serviceRadius,
      renderer: 'shared-v1',
      authority: 'src/market-city/catalog.ts',
      ...(activation ? {
        activationSlot: activation.slot,
        visualVariantId: activation.id,
        visualVariantDefault: true,
      } : {}),
    }));
  });

  VISUAL_ASSET_VARIANTS.filter((variant) => !variant.default).forEach((variant) => {
    const facility = MARKET_FACILITY_CATALOG[variant.kind];
    entries.push(Object.freeze({
      id: `live:facility:${variant.kind}:${variant.id.split(':').at(-1)}`,
      status: 'live',
      section: facilitySection(facility.category),
      type: 'facility-visual-variant',
      label: variant.label,
      kind: variant.kind,
      footprint: variant.footprint,
      capabilities: facility.capabilities,
      serviceRadius: facility.serviceRadius,
      renderer: 'shared-v1',
      authority: variant.authority,
      activationSlot: variant.slot,
      visualVariantId: variant.id,
      visualVariantDefault: false,
    }));
  });

  Object.values(MARKET_SERVICE_ZONE_CATALOG).forEach((entry) => {
    entries.push(Object.freeze({
      id: `live:service-zone:${entry.kind}`,
      status: 'live',
      section: 'waste',
      type: 'service-zone',
      label: entry.label,
      kind: entry.kind,
      footprint: entry.footprint,
      capabilities: entry.capabilities,
      renderer: 'shared-v1',
      authority: 'src/market-city/catalog.ts',
    }));
  });

  (Object.entries(INACTIVE_FACILITY_VISUAL_FOOTPRINTS) as Array<[
    keyof typeof INACTIVE_FACILITY_VISUAL_FOOTPRINTS,
    Readonly<{ width: number; height: number }>,
  ]>).forEach(([kind, footprint]) => {
    entries.push(Object.freeze({
      id: `visual:${kind}`,
      status: 'visual-only',
      section: visualSection(kind),
      type: 'facility',
      label: ARCHIVE_LABELS[kind],
      kind,
      footprint,
      capabilities: Object.freeze(['visual-only', 'not-player-placeable']),
      renderer: 'shared-v1',
      authority: 'src/market-city/catalog.ts',
    }));
  });

  return Object.freeze(entries);
}
