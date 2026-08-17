/**
 * City View shows zoning as land-use paint, not as a blanket laid over an
 * already visible physical object. The canonical zone permission remains in
 * state and in data views regardless of this presentation decision.
 */
export type CityZoneSurfaceOccupant =
  | 'none'
  | 'underground-network'
  | 'road'
  | 'avenue'
  | 'rail'
  | 'power-line'
  | 'landfill'
  | 'facility';

export interface CityZoneGroundOverlayInput {
  zoned: boolean;
  developed: boolean;
  surfaceOccupant: CityZoneSurfaceOccupant;
}

export function shouldRenderCityZoneGroundOverlay(input: CityZoneGroundOverlayInput): boolean {
  return input.zoned
    && !input.developed
    && (input.surfaceOccupant === 'none' || input.surfaceOccupant === 'underground-network');
}
