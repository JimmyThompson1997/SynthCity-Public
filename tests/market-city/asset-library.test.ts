import { describe, expect, it } from 'vitest';

import {
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
  MARKET_SERVICE_ZONE_CATALOG,
} from '../../src/market-city/catalog';
import {
  deriveAssetLibraryEntries,
  deriveAssetLibraryRciVariants,
} from '../../src/market-city/asset-library';
import {
  ASSET_VISUAL_SELECTION_STORAGE_KEY,
  assertAssetVisualVariantRegistry,
  assetVisualVariantForSlot,
  defaultAssetVisualVariantForSlot,
  parseAssetVisualSelections,
  serializeAssetVisualSelections,
  VISUAL_ASSET_VARIANTS,
} from '../../src/market-city/asset-visuals';

describe('SynthCity Asset Library manifest', () => {
  it('derives every current gameplay item from the active catalogues', () => {
    const entries = deriveAssetLibraryEntries();
    const live = entries.filter((entry) => entry.status === 'live');
    const liveKinds = live.filter((entry) => entry.type !== 'rci-system' && entry.type !== 'facility-visual-variant').map((entry) => entry.kind).sort();
    const activeKinds = [
      ...Object.keys(MARKET_NETWORK_CATALOG),
      ...Object.keys(MARKET_FACILITY_CATALOG),
      ...Object.keys(MARKET_SERVICE_ZONE_CATALOG),
    ].sort();

    expect(liveKinds).toEqual(activeKinds);
    expect(live.filter((entry) => entry.type === 'rci-system').map((entry) => entry.zone).sort()).toEqual(['C', 'I', 'R']);
    expect(live).toContainEqual(expect.objectContaining({ kind: 'subway', status: 'live', section: 'transit-network' }));
    expect(live).toContainEqual(expect.objectContaining({ kind: 'subway-station', status: 'live', section: 'transit-network' }));
    expect(live).toContainEqual(expect.objectContaining({ kind: 'fire-station', status: 'live', section: 'civic', serviceRadius: 21 }));
    expect(live).toContainEqual(expect.objectContaining({ kind: 'landfill', status: 'live', section: 'waste' }));
    expect(new Set(live.map((entry) => entry.id)).size).toBe(live.length);
  });

  it('keeps retired civic art visible but never labels it playable', () => {
    const clinic = deriveAssetLibraryEntries().find((entry) => entry.kind === 'health-clinic');

    expect(clinic).toMatchObject({
      status: 'visual-only',
      section: 'archive',
      footprint: { width: 3, height: 2 },
    });
  });

  it('lists the Police Station as playable civic art now that it is a real facility', () => {
    const police = deriveAssetLibraryEntries().find((entry) => entry.kind === 'police-station');

    expect(police).toMatchObject({
      status: 'live',
      section: 'civic',
      footprint: { width: 1, height: 1 },
    });
  });

  it('registers a dormant Fire Station visual candidate without changing the live facility contract', () => {
    const variants = VISUAL_ASSET_VARIANTS.filter((variant) => variant.slot === 'facility:fire-station');
    const current = defaultAssetVisualVariantForSlot('facility:fire-station');
    const modern = assetVisualVariantForSlot('facility:fire-station:modern-test');
    const entries = deriveAssetLibraryEntries();

    expect(ASSET_VISUAL_SELECTION_STORAGE_KEY).toBe('synthcity.asset-visual-selections.v1');
    expect(variants.map((variant) => variant.id)).toEqual([
      'facility:fire-station:classic',
      'facility:fire-station:modern-test',
    ]);
    expect(current).toMatchObject({
      id: 'facility:fire-station:classic',
      default: true,
      footprint: { width: 1, height: 1 },
    });
    expect(modern).toMatchObject({
      id: 'facility:fire-station:modern-test',
      default: false,
      kind: 'fire-station',
      rendererVariantId: 'civic-fire-modern-test',
      footprint: { width: 1, height: 1 },
    });
    expect(entries).toContainEqual(expect.objectContaining({
      id: 'live:facility:fire-station:modern-test',
      kind: 'fire-station',
      visualVariantId: 'facility:fire-station:modern-test',
      activationSlot: 'facility:fire-station',
      status: 'live',
    }));
    expect(MARKET_FACILITY_CATALOG['fire-station']).toMatchObject({
      footprint: { width: 1, height: 1 },
      serviceRadius: 21,
    });
  });

  it('accepts only compatible durable visual selections and falls back to the compiled default', () => {
    expect(parseAssetVisualSelections(JSON.stringify({
      version: 1,
      activeBySlot: { 'facility:fire-station': 'facility:fire-station:modern-test' },
    }))).toEqual({ 'facility:fire-station': 'facility:fire-station:modern-test' });
    expect(parseAssetVisualSelections(JSON.stringify({
      version: 1,
      activeBySlot: { 'facility:fire-station': 'facility:missing' },
    }))).toEqual({ 'facility:fire-station': 'facility:fire-station:classic' });
    expect(parseAssetVisualSelections('not-json')).toEqual({ 'facility:fire-station': 'facility:fire-station:classic' });
    expect(serializeAssetVisualSelections({
      'facility:fire-station': 'facility:fire-station:modern-test',
    })).toBe('{"version":1,"activeBySlot":{"facility:fire-station":"facility:fire-station:modern-test"}}');
  });

  it('rejects stale slots, mismatched mechanics, and missing or duplicate compiled defaults', () => {
    expect(() => assertAssetVisualVariantRegistry([
      { id: 'bad-slot', slot: 'facility:unknown', kind: 'fire-station', default: true, footprint: { width: 1, height: 1 } },
    ])).toThrow('Unknown asset visual slot');
    expect(() => assertAssetVisualVariantRegistry([
      { id: 'wrong-kind', slot: 'facility:fire-station', kind: 'water-tower', default: true, footprint: { width: 1, height: 1 } },
    ])).toThrow('incompatible kind');
    expect(() => assertAssetVisualVariantRegistry([
      { id: 'wrong-footprint', slot: 'facility:fire-station', kind: 'fire-station', default: true, footprint: { width: 2, height: 1 } },
    ])).toThrow('incompatible footprint');
    expect(() => assertAssetVisualVariantRegistry([
      { id: 'no-default', slot: 'facility:fire-station', kind: 'fire-station', default: false, footprint: { width: 1, height: 1 } },
    ])).toThrow('exactly one compiled default');
    expect(() => assertAssetVisualVariantRegistry([
      { id: 'default-a', slot: 'facility:fire-station', kind: 'fire-station', default: true, footprint: { width: 1, height: 1 } },
      { id: 'default-b', slot: 'facility:fire-station', kind: 'fire-station', default: true, footprint: { width: 1, height: 1 } },
    ])).toThrow('exactly one compiled default');
  });

  it('enumerates current RCI visual variants from the live appearance vocabulary', () => {
    const variants = deriveAssetLibraryRciVariants();

    expect(variants.length).toBeGreaterThan(1_000);
    expect(variants).toContainEqual(expect.objectContaining({ zone: 'R', height: 10, lotFootprint: '2x2', status: 'live' }));
    expect(variants).toContainEqual(expect.objectContaining({ zone: 'I', height: 10, status: 'live' }));
    expect(variants).toContainEqual(expect.objectContaining({ zone: 'C', roof: 'spire', landmark: true, status: 'live' }));
    expect(new Set(variants.map((entry) => entry.id)).size).toBe(variants.length);
  });
});
