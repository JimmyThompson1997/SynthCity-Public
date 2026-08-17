import { describe, expect, it } from 'vitest';
import { shouldRenderCityZoneGroundOverlay } from '../../src/market-city-dashboard/zone-visuals';

describe('City View zoning permission visuals', () => {
  it('shows a ground tint only where an RCI permission can be seen as land', () => {
    expect(shouldRenderCityZoneGroundOverlay({ zoned: true, developed: false, surfaceOccupant: 'none' })).toBe(true);
    expect(shouldRenderCityZoneGroundOverlay({ zoned: true, developed: false, surfaceOccupant: 'underground-network' })).toBe(true);

    for (const surfaceOccupant of ['road', 'avenue', 'rail', 'power-line', 'landfill', 'facility'] as const) {
      expect(shouldRenderCityZoneGroundOverlay({ zoned: true, developed: false, surfaceOccupant })).toBe(false);
    }

    expect(shouldRenderCityZoneGroundOverlay({ zoned: true, developed: true, surfaceOccupant: 'none' })).toBe(false);
    expect(shouldRenderCityZoneGroundOverlay({ zoned: false, developed: false, surfaceOccupant: 'none' })).toBe(false);
  });
});
