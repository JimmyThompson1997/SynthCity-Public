/**
 * The single visual geometry contract for the player's coal power plant.
 *
 * Every coordinate is in world tiles with the origin at the north-west corner
 * of the authoritative 2 x 3 facility footprint.  Renderers project these
 * coordinates through their own current camera rather than baking a screen
 * rectangle or loading a raster sprite.
 */
export const COAL_PLANT_GEOMETRY = Object.freeze({
  id: 'coal-power-plant',
  footprint: Object.freeze({ width: 2, depth: 3 }),
  treatment: 'heritage-clay',
  visualSpec: 'world-geometry-v1',
  lot: Object.freeze({ inset: 0.035, fill: '#6f7665', edge: '#51493f' }),
  boiler: Object.freeze({
    left: 0.18,
    top: 0.20,
    width: 1.64,
    depth: 2.60,
    height: 1.88,
    colors: Object.freeze({
      south: '#ad664b',
      east: '#824b3b',
      north: '#935641',
      west: '#9f5f47',
      roof: '#d78d64',
      outline: '#594e46'
    })
  }),
  stack: Object.freeze({
    shape: 'round-cylinder',
    facets: 12,
    width: 0.22,
    depth: 0.22,
    bandStart: 0.42,
    bandHeight: 0.20,
    colors: Object.freeze({
      south: '#5f6767',
      east: '#414b4d',
      north: '#475255',
      west: '#535e60',
      roof: '#71797a',
      band: '#c94e45',
      outline: '#2e3a3e'
    })
  }),
  stacks: Object.freeze([
    Object.freeze({ x: 0.30, y: 0.36, height: 4.25 }),
    Object.freeze({ x: 1.70, y: 0.36, height: 4.75 }),
    Object.freeze({ x: 0.30, y: 2.64, height: 3.78 }),
    Object.freeze({ x: 1.70, y: 2.64, height: 4.18 })
  ])
});
