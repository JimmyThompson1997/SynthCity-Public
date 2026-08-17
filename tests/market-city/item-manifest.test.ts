import { describe, expect, it } from 'vitest';
import {
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
  MARKET_SERVICE_ZONE_CATALOG,
} from '../../src/market-city/catalog';
import { applyWorldCommand } from '../../src/market-city/commands';
import {
  MARKET_ITEM_MANIFEST,
  assertMarketItemManifestComplete,
  validateMarketItemManifest,
  type MarketItemManifestEntry,
} from '../../src/market-city/item-manifest';
import { deriveTileInspection } from '../../src/market-city/queries';
import { createMarketCityState, restoreMarketCityState, serializeMarketCityState } from '../../src/market-city/state';
import { toSquareGridRendererState } from '../../src/market-city-dashboard/render-adapter';
import type { MarketCityWorldCommand } from '../../src/market-city/types';

const EXPECTED_IDS = [
  'zone-residential',
  'zone-commercial',
  'zone-industrial',
  'road',
  'avenue',
  'rail',
  'subway',
  'power-line',
  'water-pipe',
  'coal-power-plant',
  'gas-power-plant',
  'nuclear-power-plant',
  'wind-turbine',
  'solar-plant',
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
  'train-station',
  'subway-station',
  'fire-station',
  'police-station',
  'landfill-zone',
] as const;

describe('market item completeness manifest', () => {
  it('enumerates every roadmap item once in a stable order', () => {
    expect(MARKET_ITEM_MANIFEST.map((item) => item.id)).toEqual(EXPECTED_IDS);
    expect(new Set(MARKET_ITEM_MANIFEST.map((item) => item.id)).size).toBe(EXPECTED_IDS.length);
  });

  it('requires every active item to declare all six delivery contracts', () => {
    expect(validateMarketItemManifest(MARKET_ITEM_MANIFEST)).toEqual([]);
    expect(() => assertMarketItemManifestComplete(MARKET_ITEM_MANIFEST)).not.toThrow();

    const active = MARKET_ITEM_MANIFEST.filter((item) => item.status === 'active');
    expect(active.map((item) => item.id)).toEqual([
      'zone-residential',
      'zone-commercial',
      'zone-industrial',
      'road',
      'avenue',
      'rail',
      'subway',
      'power-line',
      'water-pipe',
      'coal-power-plant',
      'gas-power-plant',
      'nuclear-power-plant',
      'wind-turbine',
      'solar-plant',
      'water-tower',
      'coastal-water-pump',
      'water-treatment-plant',
      'train-station',
      'subway-station',
      'fire-station',
      'police-station',
      'landfill-zone',
    ]);

    for (const item of active) {
      expect(Object.keys(item.contracts).sort()).toEqual([
        'browser',
        'engine',
        'inspector',
        'persistence',
        'renderer',
        'ui',
      ]);
      expect(Object.values(item.contracts).every((contract) => contract.trim().length > 0)).toBe(true);
    }
  });

  it('binds every active declaration to the real engine, renderer, inspector, and persistence contracts', () => {
    const active = MARKET_ITEM_MANIFEST.filter((item) => item.status === 'active');
    const activeCatalogIds = [
      ...Object.keys(MARKET_NETWORK_CATALOG),
      ...Object.keys(MARKET_FACILITY_CATALOG),
    ];
    expect(active.filter(({ kind }) => kind === 'network' || kind === 'facility').map(({ id }) => id))
      .toEqual(activeCatalogIds);

    for (const item of active) {
      const anchor = 12 * 48 + 12;
      const command: MarketCityWorldCommand = item.kind === 'zone'
        ? {
            type: 'zone',
            tileIds: [anchor],
            zone: item.id === 'zone-residential' ? 'R' : item.id === 'zone-commercial' ? 'C' : 'I',
          }
        : item.kind === 'network'
          ? item.id === 'avenue'
            ? { type: 'place-avenue', path: [anchor, anchor + 1], expansionSide: 'right' }
            : item.id === 'rail'
              ? { type: 'place-rail', path: [anchor] }
              : item.id === 'subway'
                ? { type: 'place-subway', path: [anchor] }
              : item.id === 'water-pipe'
                ? { type: 'place-water-pipe', tileIds: [anchor] }
                : item.id === 'road'
                  ? { type: 'place-road', tileIds: [anchor] }
                  : { type: 'place-power-line', tileIds: [anchor] }
        : item.kind === 'service-zone'
          ? { type: 'zone-landfill', tileIds: [anchor] }
          : { type: 'place-facility', kind: item.id as keyof typeof MARKET_FACILITY_CATALOG, anchor };
      const city = createMarketCityState({ cityId: `manifest-${item.id}` });
      if (item.id === 'coastal-water-pump') city.map.terrain.water[anchor - 1] = true;
      if (item.id === 'subway-station') {
        const tunnel = applyWorldCommand(city, { type: 'place-subway', path: [anchor] });
        expect(tunnel.ok).toBe(true);
        if (tunnel.ok) Object.assign(city, tunnel.state);
      }
      const placed = applyWorldCommand(city, command);
      expect(placed.ok, `${item.id} engine contract`).toBe(true);
      const rendered = toSquareGridRendererState(placed.state);
      const inspected = deriveTileInspection(placed.state, anchor);

      if (item.kind === 'zone') {
        expect(rendered.zones[anchor], `${item.id} renderer contract`).not.toBeNull();
        expect(inspected.zone, `${item.id} inspector contract`).not.toBeNull();
      } else if (item.id === 'road') {
        expect(rendered.networks.road[anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.road, `${item.id} inspector contract`).toBe(true);
      } else if (item.id === 'avenue') {
        expect(rendered.networks.avenue[anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.avenueLane, `${item.id} inspector contract`).toBe(true);
        expect(inspected.roadSurface, `${item.id} road surface contract`).toBe(true);
        expect(item.footprint).toEqual(MARKET_NETWORK_CATALOG.avenue.footprint);
      } else if (item.id === 'rail') {
        expect(rendered.networks.rail[anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.rail, `${item.id} inspector contract`).toBe(true);
        expect(item.footprint).toEqual(MARKET_NETWORK_CATALOG.rail.footprint);
      } else if (item.id === 'subway') {
        expect(rendered.networks.subway[anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.subway, `${item.id} inspector contract`).toBe(true);
        expect(item.footprint).toEqual(MARKET_NETWORK_CATALOG.subway.footprint);
      } else if (item.id === 'power-line') {
        expect(rendered.networks['power-line'][anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.powerLine, `${item.id} inspector contract`).toBe(true);
      } else if (item.id === 'water-pipe') {
        expect(rendered.networks['water-pipe'][anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.waterPipe, `${item.id} inspector contract`).toBe(true);
      } else if (item.kind === 'service-zone') {
        expect(rendered.landfillZones[anchor], `${item.id} renderer contract`).toBe(true);
        expect(inspected.landfillZone, `${item.id} inspector contract`).toBe(true);
        expect(item.footprint).toEqual(MARKET_SERVICE_ZONE_CATALOG.landfill.footprint);
      } else {
        expect(rendered.facilities.some(({ kind }) => kind === item.id), `${item.id} renderer contract`).toBe(true);
        expect(inspected.facility?.kind, `${item.id} inspector contract`).toBe(item.id);
        const catalog = MARKET_FACILITY_CATALOG[item.id as keyof typeof MARKET_FACILITY_CATALOG];
        expect(item.footprint).toEqual(catalog.footprint);
      }

      const restored = restoreMarketCityState(serializeMarketCityState(placed.state));
      expect(restored, `${item.id} persistence contract`).toEqual(placed.state);
    }
  }, 20_000);

  it('rejects a malformed active item with a useful deterministic issue', () => {
    const fixture: readonly MarketItemManifestEntry[] = [{
      id: 'broken-active-item',
      label: 'Broken Active Item',
      status: 'active',
      kind: 'network',
      category: 'roads',
      action: 'place-broken-item',
      footprint: { width: 1, height: 1 },
      contracts: {
        ui: 'tool:broken',
        engine: 'command:broken',
        renderer: '   ',
        inspector: 'tile:broken',
        persistence: 'map.broken',
        browser: 'e2e:broken',
      },
    }];

    expect(validateMarketItemManifest(fixture)).toEqual([
      { itemId: 'broken-active-item', field: 'contracts.renderer', reason: 'must be a non-empty identifier' },
    ]);
    expect(() => assertMarketItemManifestComplete(fixture)).toThrow(
      'broken-active-item contracts.renderer must be a non-empty identifier',
    );
  });

  it('allows planned items to reserve identity and placement metadata before contracts exist', () => {
    const fixture: readonly MarketItemManifestEntry[] = [{
      id: 'future-network',
      label: 'Future Network',
      status: 'planned',
      kind: 'network',
      category: 'transit',
      action: 'place-future-network',
      footprint: { width: 1, height: 1 },
      contracts: {},
    }];

    expect(validateMarketItemManifest(fixture)).toEqual([]);
    expect(() => assertMarketItemManifestComplete(fixture)).not.toThrow();
  });
});
