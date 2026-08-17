/**
 * Deliberate, code-native visual contracts for the player-facing city shelf.
 *
 * This is not a sprite manifest.  Every entry describes world dimensions and
 * a small family of physical parts for the SVG map renderer to project onto
 * the actual terrain.  An item may be simple, but it must not silently fall
 * back to an unrelated generic cube.
 */

const freeze = (value) => Object.freeze(value);
const facility = (family, geometry) => freeze({ family, geometry: freeze({ ...geometry }) });

/** Every V3 player-selectable network kind receives a specialised renderer. */
export const NETWORK_WORLD_ART = freeze({
  road: freeze({ family: 'two-lane-road', surface: '#4a5052', marking: '#f0e7a5', curb: '#7d8588' }),
  avenue: freeze({ family: 'paired-one-way-avenue', surface: '#3f464a', marking: '#f5f0d0', curb: '#858f92', median: '#e0be54' }),
  rail: freeze({
    family: 'rail-track',
    // Keep the railroad visually distinct from the asphalt road family: a
    // broad, pale warm gravel bed carries matte-black steel and warm timber ties.
    surface: '#cbc7bd',
    marking: '#15171a',
    curb: '#80502f',
    highlight: '#4b5158',
  }),
  subway: freeze({ family: 'precast-concrete-tube', surface: '#8b969b', marking: '#d8dfe2', curb: '#465158' }),
  'power-line': freeze({ family: 'overhead-power', surface: '#7a5a37', marking: '#efca54', curb: '#59402b' }),
  // Underground View keeps water coverage deliberately muted. Give the pipe a
  // saturated blue of its own so the route remains immediately legible above
  // every coverage state.
  'water-pipe': freeze({ family: 'buried-water', surface: '#087fd6', marking: '#d5f7ff', curb: '#034d89' }),
});

/**
 * The active facility catalogue.  The `family` is a renderer program, while
 * the geometry values give it a distinct silhouette within the authoritative
 * footprint supplied by the simulation.
 */
export const FACILITY_WORLD_ART = freeze({
  'coal-power-plant': facility('coal-plant', { bodyHeight: 1.88, accessory: 'four-striped-stacks' }),
  'gas-power-plant': facility('thermal-plant', { bodyHeight: 1.18, accessory: 'hall-service-two-square-stacks', accent: '#a56f4e' }),
  'nuclear-power-plant': facility('nuclear-plant', { bodyHeight: 1.6, accessory: 'reactor-two-cooling-blocks', accent: '#ded8be' }),
  'wind-turbine': facility('wind-turbine', { bodyHeight: 4.65, accessory: 'tapered-cylinder-mast-and-three-blades', accent: '#f8faf8' }),
  'solar-plant': facility('solar-field', { bodyHeight: .18, accessory: 'four-panel-rows', accent: '#356b8e' }),
  'water-tower': facility('water-tower', { bodyHeight: 3.3, accessory: 'tank-and-legs', accent: '#7bb0c5' }),
  'coastal-water-pump': facility('water-intake', { bodyHeight: .78, accessory: 'intake-pipe-and-pump-house', accent: '#4b94ad' }),
  'water-treatment-plant': facility('water-treatment', { bodyHeight: .72, accessory: 'clarifier-basins', accent: '#62abc0' }),
  'recycling-center': facility('recycling', { bodyHeight: 1.22, accessory: 'sorting-bays', accent: '#76a87b' }),
  incinerator: facility('incinerator', { bodyHeight: 1.5, accessory: 'stack-and-bunker', accent: '#c47a56' }),
  'bus-stop': facility('bus-stop', { bodyHeight: .48, accessory: 'shelter-and-sign', accent: '#d6a94b' }),
  'train-station': facility('train-station', { bodyHeight: 1.1, accessory: 'platform-canopy', accent: '#776aa0' }),
  'subway-station': facility('subway-stop', { bodyHeight: .38, accessory: 'stairs-and-roundel', accent: '#5879a8' }),
  'police-station': facility('civic-police', { bodyHeight: 1.22, accessory: 'front-steps-and-sign', accent: '#5e8eb1' }),
  'fire-station': facility('civic-fire', { bodyHeight: 2, accessory: 'apparatus-bays', accent: '#c85f4f' }),
  'health-clinic': facility('civic-health', { bodyHeight: 1.08, accessory: 'entry-and-cross', accent: '#7bb9cf' }),
  school: facility('civic-school', { bodyHeight: 1.16, accessory: 'courtyard-and-entry', accent: '#d2a95c' }),
  'green-space': facility('green-space', { bodyHeight: .12, accessory: 'paths-and-trees', accent: '#6fa65c' }),
  playground: facility('playground', { bodyHeight: .34, accessory: 'slide-and-swings', accent: '#d49c57' }),
  'neighborhood-park': facility('neighborhood-park', { bodyHeight: .56, accessory: 'lawn-paths-and-pavilion', accent: '#6fa563' }),
});

/**
 * Optional visual variants retain the simulation's facility kind and
 * footprint. They are appearance choices only; callers pass the stable
 * library variant ID when they want a non-default renderer recipe.
 */
export const FACILITY_WORLD_ART_VARIANTS = freeze({
  'facility:fire-station:modern-test': facility('civic-fire-modern', {
    bodyHeight: 1.46,
    accessory: 'three-glass-bays-and-roof-beacon',
    accent: '#f3aa42',
  }),
});

export const PLAYER_FACING_NETWORK_KINDS = freeze(Object.keys(NETWORK_WORLD_ART));
export const PLAYER_FACING_FACILITY_KINDS = freeze(Object.keys(FACILITY_WORLD_ART));

export function facilityWorldArt(kind, visualVariantId = '') {
  if (kind === 'fire-station' && visualVariantId) {
    return FACILITY_WORLD_ART_VARIANTS[visualVariantId] ?? FACILITY_WORLD_ART[kind] ?? null;
  }
  return FACILITY_WORLD_ART[kind] ?? null;
}

export function facilityWorldRecipeVariant(kind, visualVariantId = '') {
  return kind === 'fire-station' && visualVariantId === 'facility:fire-station:modern-test'
    ? 'civic-fire-modern-test'
    : '';
}

export function networkWorldArt(kind) {
  return NETWORK_WORLD_ART[kind] ?? null;
}
