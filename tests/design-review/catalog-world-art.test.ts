import { describe, expect, it } from 'vitest';
// The review fixture deliberately serves this side-effect-free browser module
// from public/; Vitest executes the same ESM file the page imports.
// @ts-expect-error Static public review modules are not part of the TS program.
import * as worldArt from '../../public/design-review/catalog-world-art.js';
// @ts-expect-error Static public review modules are not part of the TS program.
import { sharedWorldArtCoverage, windTurbineRotorGeometry } from '../../public/design-review/world-item-renderer.js';
const {
  FACILITY_WORLD_ART,
  NETWORK_WORLD_ART,
  PLAYER_FACING_FACILITY_KINDS,
  PLAYER_FACING_NETWORK_KINDS,
} = worldArt;
import {
  INACTIVE_FACILITY_VISUAL_FOOTPRINTS,
  MARKET_FACILITY_CATALOG,
  MARKET_NETWORK_CATALOG,
} from '../../src/market-city/catalog';

describe('player-facing world art catalogue', () => {
  it('covers the two playable networks plus every retained visual family exactly once', () => {
    const expectedNetworks = ['avenue', 'power-line', 'rail', 'road', 'subway', 'water-pipe'];
    const expectedFacilities = [
      ...Object.keys(MARKET_FACILITY_CATALOG),
      ...Object.keys(INACTIVE_FACILITY_VISUAL_FOOTPRINTS),
    ].sort();

    expect([...PLAYER_FACING_NETWORK_KINDS].sort()).toEqual(expectedNetworks);
    expect([...PLAYER_FACING_FACILITY_KINDS].sort()).toEqual(expectedFacilities);
    expect(Object.keys(NETWORK_WORLD_ART).sort()).toEqual(expectedNetworks);
    expect(Object.keys(FACILITY_WORLD_ART).sort()).toEqual(expectedFacilities);
  });

  it('has a shared renderer recipe for every selectable map and catalog item', () => {
    const coverage = sharedWorldArtCoverage({
      facilityKinds: [
        ...Object.keys(MARKET_FACILITY_CATALOG),
        ...Object.keys(INACTIVE_FACILITY_VISUAL_FOOTPRINTS),
      ],
      networkKinds: Object.keys(NETWORK_WORLD_ART),
    });
    expect(coverage.missingFacilities).toEqual([]);
    expect(coverage.missingNetworks).toEqual([]);
  });

  it('locks the approved compact footprints and simple power-art contracts', () => {
    expect(MARKET_FACILITY_CATALOG['gas-power-plant'].footprint).toEqual({ width: 2, height: 3 });
    expect(MARKET_FACILITY_CATALOG['nuclear-power-plant'].footprint).toEqual({ width: 3, height: 3 });
    expect(MARKET_FACILITY_CATALOG['wind-turbine'].footprint).toEqual({ width: 1, height: 1 });
    expect(MARKET_FACILITY_CATALOG['solar-plant'].footprint).toEqual({ width: 4, height: 2 });

    expect(FACILITY_WORLD_ART['gas-power-plant'].geometry.accessory).toBe('hall-service-two-square-stacks');
    expect(FACILITY_WORLD_ART['nuclear-power-plant'].geometry.accessory).toBe('reactor-two-cooling-blocks');
    expect(FACILITY_WORLD_ART['wind-turbine'].geometry.accessory).toBe('tapered-cylinder-mast-and-three-blades');
    expect(FACILITY_WORLD_ART['solar-plant'].geometry.accessory).toBe('four-panel-rows');
  });

  it('keeps the wind turbine rotor vertical and centered over its 1 x 1 tile', () => {
    const center = { x: 100, y: 80 };
    const cellSize = 20;
    const blades = windTurbineRotorGeometry(center, cellSize) as Array<Array<{ x: number; y: number }>>;
    const points = blades.flat();

    expect(blades).toHaveLength(3);
    expect(blades.every((blade) => blade.length === 4)).toBe(true);
    expect(Math.min(...points.map(({ x }) => x))).toBeLessThan(center.x - cellSize * .7);
    expect(Math.max(...points.map(({ x }) => x))).toBeGreaterThan(center.x + cellSize * .7);
    expect(Math.min(...points.map(({ y }) => y))).toBeLessThan(center.y - cellSize);
    expect(Math.max(...points.map(({ y }) => y))).toBeGreaterThan(center.y + cellSize * .5);

    const distance = (left: { x: number; y: number }, right: { x: number; y: number }) => Math.hypot(left.x - right.x, left.y - right.y);
    for (const blade of blades) {
      expect(distance(blade[0]!, blade[3]!)).toBeCloseTo(cellSize * .20, 5);
      expect(distance(blade[1]!, blade[2]!)).toBeCloseTo(cellSize * .14, 5);
    }
  });
});
