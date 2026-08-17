import { describe, expect, it } from 'vitest';
import {
  INACTIVE_FACILITY_VISUAL_FOOTPRINTS,
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
  marketFacilityVisualFootprint,
} from '../../src/market-city/catalog';

describe('fresh playable catalog', () => {
  it('contains the active buildables and never charges placement prices', () => {
    expect(Object.keys(MARKET_NETWORK_CATALOG)).toEqual(['road', 'avenue', 'rail', 'subway', 'power-line', 'water-pipe']);
    expect(Object.keys(MARKET_FACILITY_CATALOG)).toEqual([
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
    ]);
    expect([
      ...Object.values(MARKET_NETWORK_CATALOG),
      ...Object.values(MARKET_FACILITY_CATALOG),
    ].every((entry) => entry.buildCost === 0)).toBe(true);
    expect(MARKET_NETWORK_CATALOG.avenue).toMatchObject({
      category: 'roads',
      footprint: { width: 2, height: 2 },
      monthlyMaintenancePerTile: MARKET_NETWORK_CATALOG.road.monthlyMaintenancePerTile,
    });
    expect(MARKET_NETWORK_CATALOG.rail).toMatchObject({
      category: 'transit', footprint: { width: 1, height: 1 }, monthlyMaintenancePerTile: 0,
    });
    expect(MARKET_NETWORK_CATALOG.subway).toMatchObject({
      category: 'transit', footprint: { width: 1, height: 1 }, monthlyMaintenancePerTile: 0,
    });
    expect(MARKET_NETWORK_CATALOG['water-pipe']).toMatchObject({
      category: 'utilities', footprint: { width: 1, height: 1 }, monthlyMaintenancePerTile: 0,
    });
    expect(MARKET_FACILITY_CATALOG['train-station']).toMatchObject({
      category: 'transit', footprint: { width: 2, height: 2 }, monthlyMaintenance: 0, serviceRadius: 6,
    });
    expect(MARKET_FACILITY_CATALOG['water-tower']).toMatchObject({
      category: 'water', footprint: { width: 2, height: 2 }, operatingCapacity: 20_000,
    });
  });

  it('keeps retired art footprints visual-only while activating the Subway Station', () => {
    expect(MARKET_FACILITY_CATALOG['subway-station']).toMatchObject({ category: 'transit', footprint: { width: 1, height: 1 } });
    expect(marketFacilityVisualFootprint('subway-station')).toEqual({ width: 1, height: 1 });
    expect(marketFacilityVisualFootprint('coal-power-plant')).toEqual({ width: 2, height: 3 });
  });

  it('keeps the playable Police Station a one-tile Public Services facility', () => {
    expect(MARKET_FACILITY_CATALOG['police-station']).toMatchObject({
      category: 'safety',
      footprint: { width: 1, height: 1 },
      serviceRadius: 21,
      capabilities: ['free-placement', 'road-gated', 'power-gated', 'radius-height-bonus', 'citywide-suppression'],
    });
  });

  it('keeps the playable Fire Station a one-tile Public Services facility', () => {
    expect(MARKET_FACILITY_CATALOG['fire-station']).toMatchObject({
      category: 'fire',
      footprint: { width: 1, height: 1 },
      serviceRadius: 21,
      capabilities: ['free-placement', 'road-gated', 'power-gated', 'radius-twenty-one-suppression', 'shared-fire-capacity'],
    });
  });

  it('advertises the thermal road-and-water gates without assigning them to renewables', () => {
    for (const kind of ['coal-power-plant', 'gas-power-plant', 'nuclear-power-plant'] as const) {
      expect(MARKET_FACILITY_CATALOG[kind].capabilities).toEqual(expect.arrayContaining([
        'road-gated',
        'water-gated',
      ]));
    }
    for (const kind of ['wind-turbine', 'solar-plant'] as const) {
      expect(MARKET_FACILITY_CATALOG[kind].capabilities).not.toEqual(expect.arrayContaining([
        'road-gated',
        'water-gated',
      ]));
    }
  });
});
