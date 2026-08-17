/**
 * Shared world-SVG renderer for player-selectable city items.
 *
 * This module deliberately owns physical silhouettes, palettes, and SVG
 * construction.  A caller may provide a real map projection or the compact,
 * deterministic thumbnail projection below, but it may not supply a second
 * item-specific icon.  That keeps the catalogue as a view of world art rather
 * than a separate art system.
 */
import { facilityWorldArt, facilityWorldRecipeVariant, networkWorldArt } from './catalog-world-art.js';
import { COAL_PLANT_GEOMETRY } from './coal-plant-geometry.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const create = (name) => document.createElementNS(SVG_NS, name);
const pointString = (points) => points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
const appendData = (element, data) => Object.entries(data ?? {}).forEach(([key, value]) => {
  if (value !== undefined && value !== null) element.dataset[key] = String(value);
});

const WORLD_RECIPE_VERSION = 2;

function worldRecipeData(type, kind, variant = '') {
  const recipeKind = variant ? `${kind}-${variant}` : kind;
  return {
    worldRecipeId: `${type}:${recipeKind}:v${WORLD_RECIPE_VERSION}`,
    worldGeometryFingerprint: `${type}-${recipeKind}-geometry-v${WORLD_RECIPE_VERSION}`,
  };
}

function networkRecipeData(kind) {
  if (kind === 'rail') {
    return {
      worldRecipeId: 'network:rail:v5',
      worldGeometryFingerprint: 'network-rail-geometry-v5',
    };
  }
  return worldRecipeData('network', kind);
}

function polygon(className, points, attributes = {}, data = {}) {
  const element = create('polygon');
  element.setAttribute('class', className);
  element.setAttribute('points', pointString(points));
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  appendData(element, data);
  return element;
}

function circle(className, center, radius, attributes = {}, data = {}) {
  const element = create('circle');
  element.setAttribute('class', className);
  element.setAttribute('cx', center.x.toFixed(2));
  element.setAttribute('cy', center.y.toFixed(2));
  element.setAttribute('r', String(radius));
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  appendData(element, data);
  return element;
}

function svgPath(className, d, attributes = {}, data = {}) {
  const element = create('path');
  element.setAttribute('class', className);
  element.setAttribute('d', d);
  Object.entries(attributes).forEach(([name, value]) => element.setAttribute(name, String(value)));
  appendData(element, data);
  return element;
}

function line(className, start, end, { stroke = '#4c4742', width = 1, linecap = 'round', data = {} } = {}) {
  const element = create('line');
  element.setAttribute('class', className);
  element.setAttribute('x1', start.x.toFixed(2));
  element.setAttribute('y1', start.y.toFixed(2));
  element.setAttribute('x2', end.x.toFixed(2));
  element.setAttribute('y2', end.y.toFixed(2));
  element.setAttribute('stroke', stroke);
  element.setAttribute('stroke-width', String(width));
  element.setAttribute('stroke-linecap', linecap);
  element.setAttribute('vector-effect', 'non-scaling-stroke');
  appendData(element, data);
  return element;
}

const CARDINAL_DIRECTIONS = Object.freeze([
  Object.freeze({ bit: 1, name: 'north', dx: 0, dy: -1 }),
  Object.freeze({ bit: 2, name: 'east', dx: 1, dy: 0 }),
  Object.freeze({ bit: 4, name: 'south', dx: 0, dy: 1 }),
  Object.freeze({ bit: 8, name: 'west', dx: -1, dy: 0 }),
]);

function avenueDirectionNames(mask) {
  const names = CARDINAL_DIRECTIONS.filter(({ bit }) => (mask & bit) !== 0).map(({ name }) => name);
  return names.length ? names.join(',') : 'none';
}

function avenueMedianFallbackDirection(pairMask) {
  const canonicalPairMask = Number(pairMask) & 15;
  if (canonicalPairMask === 0 || (canonicalPairMask & (canonicalPairMask - 1)) !== 0) return null;
  const directionBit = ({ 1: 2, 2: 4, 4: 8, 8: 1 })[canonicalPairMask];
  return CARDINAL_DIRECTIONS.find(({ bit }) => bit === directionBit) || null;
}

function avenueEdgePoints(project, bit, inset = 0) {
  if (bit === 1) return [project(inset, inset, .075), project(1 - inset, inset, .075)];
  if (bit === 2) return [project(1 - inset, inset, .075), project(1 - inset, 1 - inset, .075)];
  if (bit === 4) return [project(1 - inset, 1 - inset, .075), project(inset, 1 - inset, .075)];
  return [project(inset, 1 - inset, .075), project(inset, inset, .075)];
}

function appendAvenueArrow(group, project, direction, art, data, directionSource = 'travel-mask') {
  const center = { x: .5, y: .5 };
  const start = { x: center.x - direction.dx * .20, y: center.y - direction.dy * .20 };
  const tip = { x: center.x + direction.dx * .25, y: center.y + direction.dy * .25 };
  const normal = { x: -direction.dy, y: direction.dx };
  const wingBase = { x: tip.x - direction.dx * .14, y: tip.y - direction.dy * .14 };
  const marking = create('g');
  marking.setAttribute('class', 'terrain-avenue-direction-marking');
  appendData(marking, { ...data, direction: direction.name, directionBit: direction.bit, directionSource });
  marking.append(line('terrain-avenue-direction-shaft', project(start.x, start.y, .09), project(tip.x, tip.y, .09), {
    stroke: art.marking, width: 1.05, data: { direction: direction.name },
  }));
  marking.append(line('terrain-avenue-direction-arrow-left', project(tip.x, tip.y, .09), project(wingBase.x + normal.x * .10, wingBase.y + normal.y * .10, .09), {
    stroke: art.marking, width: 1.05, data: { direction: direction.name },
  }));
  marking.append(line('terrain-avenue-direction-arrow-right', project(tip.x, tip.y, .09), project(wingBase.x - normal.x * .10, wingBase.y - normal.y * .10, .09), {
    stroke: art.marking, width: 1.05, data: { direction: direction.name },
  }));
  group.append(marking);
}

/**
 * Draw one canonical avenue lane tile. The simulation-owned travel and pair
 * masks are world-relative cardinal bits (N=1, E=2, S=4, W=8); camera
 * rotation changes only `project`, never those durable directions.
 */
export function appendAvenueWorldGeometry(group, {
  project,
  travelMask,
  pairMask,
  medianMask = pairMask,
  laneRole = 'canonical',
  tile = null,
  preview = false,
  suppressDirection = false,
  suppressMedianMask = 0,
}) {
  const art = networkWorldArt('avenue');
  if (!art) throw new Error('No shared network world-art recipe for avenue.');
  const canonicalTravelMask = Number(travelMask) & 15;
  const canonicalPairMask = Number(pairMask) & 15;
  const canonicalMedianMask = Number(medianMask) & canonicalPairMask;
  // Connectivity may change as later Avenue construction crosses this tile,
  // but paint is historical: only its recorded median edges are drawn.
  const canonicalMergeFlowMask = canonicalTravelMask & canonicalPairMask;
  const canonicalSuppressedMedianMask = Number(suppressMedianMask) & canonicalMedianMask;
  const data = {
    networkKind: 'avenue',
    travelMask: canonicalTravelMask,
    pairMask: canonicalPairMask,
    medianMask: canonicalMedianMask,
    mergeFlowMask: canonicalMergeFlowMask,
    suppressedMedianMask: canonicalSuppressedMedianMask,
    laneDirection: avenueDirectionNames(canonicalTravelMask),
    laneRole,
  };
  appendData(group, {
    worldRenderer: 'shared-v1',
    worldRecipeId: 'network:avenue:v1',
    worldGeometryFingerprint: 'network-avenue-geometry-v1',
    artFamily: art.family,
    renderContract: 'world-svg-avenue-v1',
    drivingSide: 'right',
    atomicFootprint: 'paired-lanes',
    gradeCrossingCompatible: 'rail',
    tile: tile ? `${tile.x},${tile.y}` : undefined,
    preview: preview ? 'true' : undefined,
    ...data,
  });
  group.append(polygon('terrain-avenue-carriageway terrain-road-bed', [
    project(0, 0, .07), project(1, 0, .07), project(1, 1, .07), project(0, 1, .07),
  ], { fill: art.surface, stroke: 'none' }, data));

  CARDINAL_DIRECTIONS.filter(({ bit }) => (
    (canonicalMedianMask & bit) !== 0 && (canonicalSuppressedMedianMask & bit) === 0
  )).forEach(({ bit, name }) => {
    const [start, end] = avenueEdgePoints(project, bit, .035);
    group.append(line('terrain-avenue-median-edge', start, end, {
      stroke: art.median, width: 1.45, data: { ...data, edge: name },
    }));
  });
  CARDINAL_DIRECTIONS.filter(({ bit }) => (canonicalPairMask & bit) === 0).forEach(({ bit, name }) => {
    const [start, end] = avenueEdgePoints(project, bit, .07);
    group.append(line('terrain-avenue-outer-edge', start, end, {
      stroke: art.curb, width: .55, data: { ...data, edge: name },
    }));
  });
  const travelDirections = CARDINAL_DIRECTIONS.filter(({ bit }) => (canonicalTravelMask & bit) !== 0);
  const mergeDirections = travelDirections.filter(({ bit }) => (canonicalMergeFlowMask & bit) !== 0);
  if (!suppressDirection && mergeDirections.length) {
    mergeDirections.forEach((direction) => appendAvenueArrow(group, project, direction, art, data, 'merge-flow'));
  } else if (!suppressDirection) travelDirections.forEach((direction) => appendAvenueArrow(group, project, direction, art, data));
  if (!suppressDirection && !mergeDirections.length && travelDirections.length === 0) {
    const fallbackDirection = avenueMedianFallbackDirection(canonicalPairMask);
    if (fallbackDirection) appendAvenueArrow(group, project, fallbackDirection, art, data, 'median-fallback');
  }
  return group;
}

function paletteForFacility(kind) {
  const distinctFacilityPalettes = {
    'police-station': { roof: '#4f7fba', south: '#365d94', east: '#294875', north: '#426ea7', west: '#315687', outline: '#203b61' },
    'fire-station': { roof: '#c95c4b', south: '#984337', east: '#74312a', north: '#b74e40', west: '#873a31', outline: '#59251f' },
    'health-clinic': { roof: '#e6efef', south: '#83afb3', east: '#5f858b', north: '#c7dddd', west: '#709ca1', outline: '#3d6e74' },
    school: { roof: '#d2a35b', south: '#9c7041', east: '#785331', north: '#bd8e4e', west: '#8d6339', outline: '#5d4329' },
    'recycling-center': { roof: '#6ba86e', south: '#4e8056', east: '#3c6344', north: '#5d9662', west: '#47764e', outline: '#2d5437' },
    incinerator: { roof: '#c8754d', south: '#945039', east: '#713a2c', north: '#b46142', west: '#854733', outline: '#542d23' },
  };
  if (distinctFacilityPalettes[kind]) return distinctFacilityPalettes[kind];
  if (/park|playground|green-space/.test(kind)) return { roof: '#7fba69', south: '#5c8e51', east: '#486f45', north: '#6aa85c', west: '#56824d', outline: '#315b39' };
  if (/water/.test(kind)) return { roof: '#8db7d5', south: '#688ea8', east: '#527386', north: '#7da9c8', west: '#638fa8', outline: '#36586b' };
  if (/rail|station|terminal|ramp/.test(kind)) return { roof: '#9587be', south: '#706494', east: '#584f76', north: '#8778af', west: '#6e6390', outline: '#3f385a' };
  if (/power|landfill|recycling|incinerator/.test(kind)) return { roof: '#c98d64', south: '#965f48', east: '#754837', north: '#b67758', west: '#8a5743', outline: '#553629' };
  return { roof: '#bab0a1', south: '#897f73', east: '#6c655e', north: '#a79d8f', west: '#80786e', outline: '#4c4742' };
}

function bodyHeight(kind, footprint, art = facilityWorldArt(kind)) {
  if (Number.isFinite(art?.geometry?.bodyHeight)) return art.geometry.bodyHeight;
  if (kind === 'wind-turbine') return 4.8;
  if (kind === 'water-tower') return 3.2;
  return Math.max(.72, Math.min(2.3, .68 + (footprint.width + footprint.height) * .18));
}

function visibleFaces(rotation) {
  return [['south', 'east'], ['west', 'south'], ['north', 'west'], ['east', 'north']][((rotation % 4) + 4) % 4];
}

function appendVolume(group, project, rotation, box, colors, className, data = {}) {
  const left = box.left;
  const top = box.top;
  const right = left + box.width;
  const bottom = top + box.depth;
  const base = box.baseHeight || 0;
  const topHeight = base + box.height;
  const faces = {
    south: [[left, bottom, base], [right, bottom, base], [right, bottom, topHeight], [left, bottom, topHeight]],
    east: [[right, top, base], [right, bottom, base], [right, bottom, topHeight], [right, top, topHeight]],
    north: [[right, top, base], [left, top, base], [left, top, topHeight], [right, top, topHeight]],
    west: [[left, bottom, base], [left, top, base], [left, top, topHeight], [left, bottom, topHeight]],
  };
  visibleFaces(rotation).forEach((face) => {
    group.append(polygon(`${className} ${className}-wall`, faces[face].map(([x, y, z]) => project(x, y, z)), {
      fill: colors[face], stroke: 'none',
    }, { ...data, face }));
  });
  group.append(polygon(`${className} ${className}-roof`, [
    project(left, top, topHeight), project(right, top, topHeight),
    project(right, bottom, topHeight), project(left, bottom, topHeight),
  ], { fill: colors.roof, stroke: 'none' }, data));
}

function appendSemanticVolume(group, project, rotation, box, colors, className, data = {}) {
  const semanticPart = create('g');
  semanticPart.setAttribute('class', className);
  appendData(semanticPart, data);
  appendVolume(semanticPart, project, rotation, box, colors, `${className}-geometry`, data);
  group.append(semanticPart);
}

function appendFacilityPatch(group, className, points, options = {}) {
  group.append(polygon(className, points, {
    fill: options.fill,
    stroke: options.stroke ?? 'none',
    ...(options.width === undefined ? {} : { 'stroke-width': options.width, 'vector-effect': 'non-scaling-stroke' }),
  }, options.data));
}

function appendFacilityCircle(group, className, center, radius, options = {}) {
  group.append(circle(className, center, radius, {
    fill: options.fill,
    stroke: options.stroke ?? 'none',
    ...(options.width === undefined ? {} : { 'stroke-width': options.width, 'vector-effect': 'non-scaling-stroke' }),
  }, options.data));
}

function appendFacilityLine(group, className, start, end, options = {}) {
  group.append(line(className, start, end, options));
}

function appendFacilityTrees(group, project, cellSize, width, depth, count = 4) {
  const locations = [[.22, .22], [.78, .22], [.22, .78], [.78, .78], [.5, .18], [.18, .5]];
  locations.slice(0, count).forEach(([u, v], index) => appendFacilityCircle(group, 'terrain-facility-tree', project(width * u, depth * v, .34), cellSize * .11, {
    fill: index % 2 ? '#467c49' : '#5d9858', stroke: '#31583b', width: .55, data: { treeIndex: index + 1 },
  }));
}

function appendCoalCylinder(group, project, stack, index) {
  const stackGeometry = COAL_PLANT_GEOMETRY.stack;
  const centerX = stack.x + stackGeometry.width / 2;
  const centerY = stack.y + stackGeometry.depth / 2;
  const radiusX = stackGeometry.width / 2;
  const radiusY = stackGeometry.depth / 2;
  const ringPoint = (facet, lift) => {
    const angle = (Math.PI * 2 * facet) / stackGeometry.facets;
    return project(centerX + Math.cos(angle) * radiusX, centerY + Math.sin(angle) * radiusY, lift);
  };
  const color = (facet, band) => {
    if (band) return stackGeometry.colors.band;
    const angle = (Math.PI * 2 * (facet + .5)) / stackGeometry.facets;
    const x = Math.cos(angle);
    const y = Math.sin(angle);
    if (Math.abs(x) >= Math.abs(y)) return x >= 0 ? stackGeometry.colors.east : stackGeometry.colors.west;
    return y >= 0 ? stackGeometry.colors.south : stackGeometry.colors.north;
  };
  const sections = [
    { from: 0, to: stack.height * stackGeometry.bandStart, band: false },
    { from: stack.height * stackGeometry.bandStart, to: stack.height * (stackGeometry.bandStart + stackGeometry.bandHeight), band: true },
    { from: stack.height * (stackGeometry.bandStart + stackGeometry.bandHeight), to: stack.height, band: false },
  ];
  sections.flatMap((section) => Array.from({ length: stackGeometry.facets }, (_, facet) => {
    const next = (facet + 1) % stackGeometry.facets;
    const points = [ringPoint(facet, section.from), ringPoint(next, section.from), ringPoint(next, section.to), ringPoint(facet, section.to)];
    return { facet, section, points, depth: points.reduce((sum, current) => sum + current.y, 0) / points.length };
  })).sort((left, right) => left.depth - right.depth || left.facet - right.facet).forEach(({ facet, section, points }) => {
    group.append(polygon(`terrain-coal-stack-cylinder-facet${section.band ? ' terrain-coal-stack-band' : ''}`, points, {
      fill: color(facet, section.band), stroke: 'none',
    }, { stackIndex: index + 1, stackShape: stackGeometry.shape, facet: facet + 1 }));
  });
  group.append(polygon('terrain-coal-stack-cap', Array.from({ length: stackGeometry.facets }, (_, facet) => ringPoint(facet, stack.height + .012)), {
    fill: stackGeometry.colors.roof, stroke: 'none',
  }, { stackIndex: index + 1, stackShape: stackGeometry.shape }));
}

function appendCoalPlant(group, project, rotation) {
  const geometry = COAL_PLANT_GEOMETRY;
  const lot = geometry.lot.inset;
  group.append(polygon('terrain-coal-plant-footprint', [project(0, 0), project(geometry.footprint.width, 0), project(geometry.footprint.width, geometry.footprint.depth), project(0, geometry.footprint.depth)], { fill: 'transparent', stroke: 'none' }));
  group.append(polygon('terrain-coal-plant-lot', [
    project(lot, lot, .015), project(geometry.footprint.width - lot, lot, .015),
    project(geometry.footprint.width - lot, geometry.footprint.depth - lot, .015), project(lot, geometry.footprint.depth - lot, .015),
  ], { fill: geometry.lot.fill, stroke: 'none' }));
  appendVolume(group, project, rotation, geometry.boiler, geometry.boiler.colors, 'terrain-coal-boiler');
  geometry.stacks.forEach((stack, index) => appendCoalCylinder(group, project, stack, index));
}

/** Three bright, readable blades in a camera-facing vertical rotor plane. */
export function windTurbineRotorGeometry(hub, cellSize) {
  const inner = cellSize * .11;
  const outer = cellSize * 1.056;
  const rootHalfWidth = cellSize * .10;
  const tipHalfWidth = cellSize * .07;
  return [-Math.PI / 2, Math.PI / 6, (Math.PI * 5) / 6].map((angle) => {
    const along = { x: Math.cos(angle), y: Math.sin(angle) };
    const across = { x: -along.y, y: along.x };
    return [
      { x: hub.x + along.x * inner + across.x * rootHalfWidth, y: hub.y + along.y * inner + across.y * rootHalfWidth },
      { x: hub.x + along.x * outer + across.x * tipHalfWidth, y: hub.y + along.y * outer + across.y * tipHalfWidth },
      { x: hub.x + along.x * outer - across.x * tipHalfWidth, y: hub.y + along.y * outer - across.y * tipHalfWidth },
      { x: hub.x + along.x * inner - across.x * rootHalfWidth, y: hub.y + along.y * inner - across.y * rootHalfWidth },
    ];
  });
}

function appendFacilityAccessory(group, kind, footprint, project, cellSize, rotation, palette, art, { animate = true } = {}) {
  const width = footprint.width;
  const depth = footprint.height;
  const height = bodyHeight(kind, footprint, art);
  const accent = art.geometry.accent || palette.roof;
  const stackPalette = { ...palette, roof: '#737d7d', south: '#5b6565', east: '#3f494b', north: '#4d5758', west: '#536061', outline: '#2d3739' };
  const part = (className, values, options) => appendFacilityPatch(group, className, values.map(([x, y, z = 0]) => project(x, y, z)), options);
  const segment = (className, start, end, options) => appendFacilityLine(group, className, project(...start), project(...end), options);
  switch (art.family) {
    case 'thermal-plant': {
      const hallPalette = { ...palette, roof: '#c98c62' };
      const servicePalette = { ...palette, roof: accent };
      appendSemanticVolume(group, project, rotation, {
        left: .16, top: .30, width: width * .58, depth: depth * .72, height,
      }, hallPalette, 'terrain-facility-gas-hall', { facilityPart: 'turbine-hall' });
      appendSemanticVolume(group, project, rotation, {
        left: width * .66, top: .34, width: width * .25, depth: depth * .34, height: height * .62,
      }, servicePalette, 'terrain-facility-gas-service', { facilityPart: 'service-block' });
      [[width * .19, depth * .23], [width * .42, depth * .23]].forEach(([left, top], index) => appendSemanticVolume(group, project, rotation, {
        left, top, width: width * .075, depth: width * .075, height: height * (.68 + index * .12), baseHeight: height,
      }, stackPalette, 'terrain-facility-gas-stack', { stackIndex: index + 1, stackShape: 'square' }));
      break;
    }
    case 'incinerator':
      appendVolume(group, project, rotation, { left: width * .18, top: depth * .18, width: .18, depth: .18, height: height + .9 }, stackPalette, 'terrain-facility-stack', { stackIndex: 1 });
      appendVolume(group, project, rotation, { left: width * .72, top: depth * .24, width: .18, depth: .18, height: height + .55 }, stackPalette, 'terrain-facility-stack', { stackIndex: 2 });
      part('terrain-facility-service-bay', [[width * .40, depth - .11, .04], [width * .73, depth - .11, .04], [width * .73, depth - .11, .44], [width * .40, depth - .11, .44]], { fill: accent, stroke: palette.outline });
      break;
    case 'nuclear-plant': {
      const coolingPalette = { roof: '#e6e2ca', south: '#b7b39f', east: '#8d8a7a', north: '#d1ccb5', west: '#a5a18f', outline: '#77756d' };
      [[.45, .42], [width - 1.90, .42]].forEach(([left, top], index) => appendSemanticVolume(group, project, rotation, {
        left, top, width: 1.45, depth: 1.62, height: height * 1.36,
      }, coolingPalette, 'terrain-facility-nuclear-cooling-block', { blockIndex: index + 1, blockShape: 'rectangular' }));
      appendSemanticVolume(group, project, rotation, {
        left: width * .35, top: depth * .28, width: width * .30, depth: depth * .43, height: height * 1.05,
      }, { ...palette, roof: accent }, 'terrain-facility-nuclear-reactor-block', { facilityPart: 'reactor-block' });
      appendSemanticVolume(group, project, rotation, {
        left: width * .19, top: depth * .74, width: width * .62, depth: depth * .20, height: height * .48,
      }, { ...palette, roof: '#b8b09d' }, 'terrain-facility-nuclear-turbine-hall', { facilityPart: 'turbine-hall' });
      break;
    }
    case 'wind-turbine': {
      const centerX = width / 2;
      const centerY = depth / 2;
      const mastBase = project(centerX, centerY, .05);
      const mastTop = project(centerX, centerY, height);
      const mastBaseRadius = cellSize * .11;
      const mastTopRadius = cellSize * .076;
      appendFacilityPatch(group, 'terrain-facility-wind-mast-cylinder', [
        { x: mastTop.x - mastTopRadius, y: mastTop.y },
        { x: mastTop.x + mastTopRadius, y: mastTop.y },
        { x: mastBase.x + mastBaseRadius, y: mastBase.y },
        { x: mastBase.x - mastBaseRadius, y: mastBase.y },
      ], { fill: '#eef3ef', stroke: '#a9b4af', width: .55, data: { facilityPart: 'mast', mastShape: 'cylinder' } });
      appendFacilityCircle(group, 'terrain-facility-wind-mast-cap', mastTop, mastTopRadius, {
        fill: '#fbfdfb', stroke: '#b7c1bd', width: .45, data: { facilityPart: 'mast-cap', mastShape: 'cylinder' },
      });
      appendFacilityLine(group, 'terrain-facility-wind-mast-highlight',
        { x: mastBase.x - mastBaseRadius * .32, y: mastBase.y - .6 },
        { x: mastTop.x - mastTopRadius * .28, y: mastTop.y + .6 },
        { stroke: '#ffffff', width: .55, data: { facilityPart: 'mast-highlight' } });
      appendSemanticVolume(group, project, rotation, {
        left: centerX - .16, top: centerY - .16, width: .32, depth: .32, height: .26, baseHeight: height - .08,
      }, { roof: '#f5f7f3', south: '#d8dfda', east: '#a8b3ae', north: '#e8ece7', west: '#c3ccc7', outline: '#87918d' }, 'terrain-facility-wind-hub-block', { facilityPart: 'hub' });
      const rotor = create('g');
      rotor.setAttribute('class', 'terrain-facility-wind-rotor');
      const hub = project(centerX, centerY, height + .16);
      appendData(rotor, {
        rotorPlane: 'vertical',
        rotorHubX: hub.x.toFixed(2),
        rotorHubY: hub.y.toFixed(2),
        rotorDurationSeconds: 14,
      });
      if (animate && (typeof window === 'undefined' || !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches)) {
        const motion = create('animateTransform');
        motion.setAttribute('class', 'terrain-facility-wind-rotor-motion');
        motion.setAttribute('attributeName', 'transform');
        motion.setAttribute('type', 'rotate');
        motion.setAttribute('from', `0 ${hub.x.toFixed(2)} ${hub.y.toFixed(2)}`);
        motion.setAttribute('to', `360 ${hub.x.toFixed(2)} ${hub.y.toFixed(2)}`);
        motion.setAttribute('dur', '14s');
        motion.setAttribute('repeatCount', 'indefinite');
        motion.setAttribute('calcMode', 'linear');
        rotor.append(motion);
      }
      windTurbineRotorGeometry(hub, cellSize).forEach((blade, index) => appendFacilityPatch(rotor, 'terrain-facility-wind-blade-block', blade, {
        fill: '#f8faf8', stroke: '#b7c1bd', width: .55,
        data: { bladeIndex: index + 1, bladeShape: 'rectangular', rotorPlane: 'vertical' },
      }));
      const capHalf = cellSize * .075;
      appendFacilityPatch(rotor, 'terrain-facility-wind-rotor-cap', [
        { x: hub.x - capHalf, y: hub.y - capHalf },
        { x: hub.x + capHalf, y: hub.y - capHalf },
        { x: hub.x + capHalf, y: hub.y + capHalf },
        { x: hub.x - capHalf, y: hub.y + capHalf },
      ], { fill: '#f0f4f1', stroke: '#a5b0ac', width: .55, data: { facilityPart: 'rotor-cap' } });
      group.append(rotor);
      appendSemanticVolume(group, project, rotation, {
        left: centerX - .075, top: centerY - .075, width: .15, depth: .15, height: .08,
      }, { roof: '#727d7e', south: '#596466', east: '#434d50', north: '#667174', west: '#505b5e', outline: '#394345' }, 'terrain-facility-wind-footing-block', { facilityPart: 'footing' });
      break;
    }
    case 'solar-field': {
      const panelPalette = { roof: '#2f658c', south: '#244b68', east: '#1b3a51', north: '#396f95', west: '#295773', outline: '#183246' };
      for (let row = 0; row < 4; row += 1) appendSemanticVolume(group, project, rotation, {
        left: .24, top: .24 + row * .88, width: width - .48, depth: .48, height: .13, baseHeight: .06,
      }, panelPalette, 'terrain-facility-solar-panel-row', { row: row + 1, panelShape: 'rectangular-strip' });
      appendSemanticVolume(group, project, rotation, {
        left: width - .78, top: depth - .62, width: .48, depth: .34, height: .42,
      }, { ...palette, roof: '#b9b6a8' }, 'terrain-facility-solar-service-block', { facilityPart: 'service-block' });
      break;
    }
    case 'water-tower': {
      const centerX = width / 2;
      const centerY = depth / 2;
      const spread = Math.min(width, depth) * .18;
      part('terrain-facility-water-tower-pad', [[centerX - spread * 1.45, centerY - spread * 1.45, .03], [centerX + spread * 1.45, centerY - spread * 1.45, .03], [centerX + spread * 1.45, centerY + spread * 1.45, .03], [centerX - spread * 1.45, centerY + spread * 1.45, .03]], { fill: '#89918d', stroke: '#59635f', width: .55 });
      [[-spread, -spread], [spread, -spread], [-spread, spread], [spread, spread]].forEach(([dx, dy], index) => segment('terrain-facility-tower-leg', [centerX + dx, centerY + dy, .06], [centerX + dx * .46, centerY + dy * .46, height * .64], { stroke: '#758b91', width: 1.05, data: { legIndex: index + 1 } }));
      appendFacilityCircle(group, 'terrain-facility-water-tank', project(centerX, centerY, height), cellSize * Math.min(width, depth) * .24, { fill: accent, stroke: '#557681', width: .75 });
      break;
    }
    case 'water-intake': {
      appendSemanticVolume(group, project, rotation, {
        left: width * .20, top: depth * .16, width: width * .60, depth: depth * .42, height: Math.max(.42, height * .82),
      }, { ...palette, roof: '#88b6c3' }, 'terrain-facility-pump-house', { building: 'pump-house' });
      segment('terrain-facility-intake-pipe', [width * .50, depth * .55, .14], [width * .50, depth * .91, .14], { stroke: '#477f96', width: 2.25 });
      segment('terrain-facility-intake-screen', [width * .34, depth * .91, .15], [width * .66, depth * .91, .15], { stroke: '#a9d4dd', width: 2.6 });
      break;
    }
    case 'water-treatment': {
      const clarifierRadius = cellSize * Math.min(width, depth) * .15;
      [[width * .31, depth * .38], [width * .69, depth * .38]].forEach(([x, y], index) => appendFacilityCircle(group, 'terrain-facility-water-clarifier', project(x, y, .10), clarifierRadius, {
        fill: '#4c9db7', stroke: '#d0e4e4', width: .75, data: { clarifierIndex: index + 1 },
      }));
      appendSemanticVolume(group, project, rotation, {
        left: width * .18, top: depth * .70, width: width * .64, depth: depth * .17, height: Math.max(.38, height * .66),
      }, { ...palette, roof: '#9abec6' }, 'terrain-facility-water-operations-building', { building: 'operations' });
      break;
    }
    case 'landfill':
      [[.14, .16, .12], [.25, .31, .24], [.34, .43, .36]].forEach(([inset, offset, lift], index) => part('terrain-facility-landfill-layer', [[width * inset, depth * inset, lift], [width * (1 - inset), depth * inset, lift], [width * (1 - inset), depth * (1 - inset), lift], [width * inset, depth * (1 - inset), lift]], { fill: index === 2 ? '#9c845a' : '#79654d', stroke: '#5c4d3d', width: .45, data: { layerIndex: index + 1 } }));
      break;
    case 'recycling':
      [[.18, .22], [.5, .22], [.82, .22]].forEach(([u, v], index) => appendFacilityCircle(group, 'terrain-facility-recycling-bay', project(width * u, depth * v, height + .04), cellSize * .09, { fill: index === 1 ? '#dfbf5f' : '#6fa978', stroke: '#426c4b', width: .55, data: { bayIndex: index + 1 } }));
      break;
    case 'bus-stop':
      segment('terrain-facility-bus-shelter-post', [width * .18, depth * .70, .04], [width * .18, depth * .70, .62], { stroke: '#56616a', width: 1.2 });
      segment('terrain-facility-bus-shelter-post', [width * .68, depth * .70, .04], [width * .68, depth * .70, .62], { stroke: '#56616a', width: 1.2 });
      part('terrain-facility-bus-shelter-roof', [[width * .10, depth * .24, .62], [width * .76, depth * .24, .62], [width * .76, depth * .78, .62], [width * .10, depth * .78, .62]], { fill: accent, stroke: '#4c5962', width: .65 });
      segment('terrain-facility-bus-bench', [width * .21, depth * .59, .25], [width * .63, depth * .59, .25], { stroke: '#805f3e', width: 2.2 });
      segment('terrain-facility-bus-stop-sign-post', [width * .84, depth * .42, .04], [width * .84, depth * .42, .71], { stroke: '#59646b', width: 1.15 });
      appendFacilityCircle(group, 'terrain-facility-bus-stop-sign', project(width * .84, depth * .42, .73), cellSize * .065, { fill: '#e2bd52', stroke: '#564d36', width: .6 });
      break;
    case 'train-station':
      part('terrain-facility-platform', [[width * .07, depth * .50, .06], [width * .93, depth * .50, .06], [width * .93, depth * .72, .06], [width * .07, depth * .72, .06]], { fill: '#c3c0b6', stroke: '#77736c', width: .55 });
      appendSemanticVolume(group, project, rotation, { left: width * .15, top: depth * .14, width: width * .43, depth: depth * .31, height: height * .82 }, palette, 'terrain-facility-station-hall', { building: 'station-hall' });
      part('terrain-facility-station-entrance', [[width * .29, depth * .45, .04], [width * .44, depth * .45, .04], [width * .44, depth * .45, height * .50], [width * .29, depth * .45, height * .50]], { fill: '#d7d2bf', stroke: palette.outline, width: .55 });
      appendSemanticVolume(group, project, rotation, { left: width * .16, top: depth * .50, width: width * .68, depth: depth * .22, height: .10, baseHeight: height * .56 }, { ...palette, roof: accent }, 'terrain-facility-station-canopy', { canopyIndex: 1 });
      break;
    case 'subway-stop':
      part('terrain-facility-subway-stairs', [[width * .13, depth * .18, .07], [width * .70, depth * .18, .07], [width * .70, depth * .72, .07], [width * .13, depth * .72, .07]], { fill: '#454d54', stroke: '#252e34', width: .7 });
      [.31, .43, .55].forEach((ratio, index) => segment('terrain-facility-subway-stair-tread', [width * .20, depth * ratio, .09], [width * .63, depth * ratio, .09], { stroke: '#879198', width: .75, data: { treadIndex: index + 1 } }));
      segment('terrain-facility-subway-sign-post', [width * .79, depth * .30, .08], [width * .79, depth * .30, .72], { stroke: accent, width: 1.15 });
      appendFacilityCircle(group, 'terrain-facility-subway-sign', project(width * .79, depth * .30, .73), cellSize * .075, { fill: accent, stroke: '#e8dfbf', width: .6 });
      break;
    case 'green-space':
    case 'playground':
    case 'neighborhood-park':
      part('terrain-facility-park-path', [[width * .42, .08, .07], [width * .58, .08, .07], [width * .58, depth - .08, .07], [width * .42, depth - .08, .07]], { fill: '#d6c39a', stroke: '#a08b68', width: .4 });
      appendFacilityTrees(group, project, cellSize, width, depth, art.family === 'green-space' ? 2 : art.family === 'playground' ? 3 : 6);
      if (art.family === 'playground') {
        segment('terrain-facility-playground-frame', [width * .7, depth * .36, .08], [width * .7, depth * .36, .75], { stroke: accent, width: 1.25 });
        segment('terrain-facility-playground-frame', [width * .55, depth * .36, .42], [width * .85, depth * .36, .42], { stroke: accent, width: 1.25 });
      }
      break;
    default:
      if (/^civic-/.test(art.family)) {
        part('terrain-facility-civic-entry', [[width * .40, depth - .075, .06], [width * .60, depth - .075, .06], [width * .60, depth - .075, height * .58], [width * .40, depth - .075, height * .58]], { fill: accent, stroke: palette.outline, width: .5 });
        [[.2, .34], [.66, .34]].forEach(([u, v], index) => part('terrain-facility-civic-window', [[width * u, depth - .07, height * v], [width * (u + .13), depth - .07, height * v], [width * (u + .13), depth - .07, height * (v + .18)], [width * u, depth - .07, height * (v + .18)]], { fill: '#b7d9e6', stroke: '#4e7688', width: .38, data: { windowIndex: index + 1 } }));
        if (art.family === 'civic-police') {
          part('terrain-facility-police-badge', [[width * .50, depth * .16, height + .05], [width * .64, depth * .30, height + .05], [width * .50, depth * .44, height + .05], [width * .36, depth * .30, height + .05]], { fill: '#e7f2ff', stroke: '#244a77', width: .5, data: { facilityMarker: 'police-badge' } });
          appendFacilityCircle(group, 'terrain-facility-police-beacon', project(width * .5, depth * .76, height + .09), cellSize * .065, { fill: '#dff0ff', stroke: '#244a77', width: .5, data: { facilityMarker: 'police-beacon' } });
        }
        if (art.family === 'civic-fire') {
          [.18, .52].forEach((u, index) => part('terrain-facility-fire-bay', [[width * u, depth - .08, .08], [width * (u + .25), depth - .08, .08], [width * (u + .25), depth - .08, height * .48], [width * u, depth - .08, height * .48]], { fill: '#5a3030', stroke: '#f1bd86', width: .45, data: { bayIndex: index + 1 } }));
        }
        if (art.family === 'civic-fire-modern') {
          [.12, .39, .66].forEach((u, index) => part('terrain-facility-fire-modern-bay', [[width * u, depth - .08, .08], [width * (u + .20), depth - .08, .08], [width * (u + .20), depth - .08, height * .56], [width * u, depth - .08, height * .56]], { fill: '#395866', stroke: '#d7eef2', width: .42, data: { bayIndex: index + 1, bayStyle: 'glass' } }));
          appendFacilityCircle(group, 'terrain-facility-fire-modern-beacon', project(width * .5, depth * .48, height + .09), cellSize * .065, { fill: accent, stroke: '#824d1b', width: .5, data: { facilityMarker: 'roof-beacon' } });
          segment('terrain-facility-fire-modern-portal', [width * .50, depth - .085, height * .56], [width * .50, depth - .085, height * .86], { stroke: '#f2c468', width: 1.15, data: { facilityMarker: 'portal' } });
        }
        if (art.family === 'civic-health') {
          part('terrain-facility-health-cross', [[width * .44, depth * .20, height + .05], [width * .56, depth * .20, height + .05], [width * .56, depth * .48, height + .05], [width * .44, depth * .48, height + .05]], { fill: '#d85a50', stroke: '#a53634', width: .38, data: { facilityMarker: 'health-cross' } });
          part('terrain-facility-health-cross', [[width * .34, depth * .28, height + .06], [width * .66, depth * .28, height + .06], [width * .66, depth * .40, height + .06], [width * .34, depth * .40, height + .06]], { fill: '#d85a50', stroke: '#a53634', width: .38, data: { facilityMarker: 'health-cross' } });
        }
        if (art.family === 'civic-school') {
          appendVolume(group, project, rotation, { left: width * .72, top: depth * .20, width: width * .15, depth: depth * .18, height: height + .46 }, { ...palette, roof: '#f4d77b' }, 'terrain-facility-school-clock-tower', { facilityMarker: 'school-clock-tower' });
          appendFacilityCircle(group, 'terrain-facility-school-clock', project(width * .795, depth * .29, height + .49), cellSize * .055, { fill: '#f8edc8', stroke: '#6e542f', width: .45, data: { facilityMarker: 'school-clock' } });
        }
      }
  }
}

/** Render a selectable facility through the same physical world-SVG recipe. */
export function createFacilityWorldGeometry({ kind, footprint, project, cellSize, rotation = 0, data = {}, animate = true, visualVariantId = '' }) {
  const art = facilityWorldArt(kind, visualVariantId);
  if (!art) throw new Error(`No shared facility world-art recipe for ${kind}.`);
  const group = create('g');
  group.setAttribute('class', `terrain-facility-world facility-${kind}`);
  appendData(group, {
    worldRenderer: 'shared-v1',
    ...worldRecipeData('facility', kind, facilityWorldRecipeVariant(kind, visualVariantId)),
    facilityKind: kind,
    assetVisualVariantId: visualVariantId || 'built-in',
    artFamily: art.family,
    artAccessory: art.geometry.accessory || 'fallback-volume',
    renderContract: 'world-space-facility',
    ...data,
  });
  if (kind === COAL_PLANT_GEOMETRY.id) {
    group.classList.add('terrain-coal-power-plant');
    appendCoalPlant(group, project, rotation);
    return group;
  }
  const palette = art.family === 'civic-fire-modern'
    ? { roof: '#ced8dd', south: '#93a3aa', east: '#71838c', north: '#b6c5cb', west: '#85979f', outline: '#4f626a' }
    : paletteForFacility(kind);
  group.append(polygon('terrain-facility-lot', [
    project(.06, .06, .01), project(footprint.width - .06, .06, .01),
    project(footprint.width - .06, footprint.height - .06, .01), project(.06, footprint.height - .06, .01),
  ], { fill: '#665f57', stroke: 'none' }));
  const inset = Math.min(.22, Math.min(footprint.width, footprint.height) * .16);
  const groundOnly = new Set([
    'thermal-plant', 'nuclear-plant', 'wind-turbine', 'solar-field',
    'water-tower', 'water-intake', 'water-treatment',
    'landfill', 'bus-stop', 'train-station', 'subway-stop',
    'green-space', 'playground', 'neighborhood-park',
  ]);
  if (!groundOnly.has(art.family)) appendVolume(group, project, rotation, {
    left: inset, top: inset, width: Math.max(.28, footprint.width - inset * 2), depth: Math.max(.28, footprint.height - inset * 2), height: bodyHeight(kind, footprint),
  }, palette, 'terrain-facility-volume');
  appendFacilityAccessory(group, kind, footprint, project, cellSize, rotation, palette, art, { animate });
  return group;
}

/**
 * Render one canonical landfill surface cell. Unlike facilities, this is a
 * service-zone layer: its stored garbage and stage are derived from the city
 * ledger, and the very same geometry backs the catalogue thumbnail.
 */
function landfillFillStage(storedTenths, capacityTenths) {
  if (!Number.isSafeInteger(storedTenths) || storedTenths < 0 || storedTenths > capacityTenths) {
    throw new RangeError('Landfill stored waste must be an integer within its configured capacity.');
  }
  if (storedTenths === 0) return 'empty';
  if (storedTenths < capacityTenths * .25) return 'scattered';
  if (storedTenths < capacityTenths * .5) return 'low';
  if (storedTenths < capacityTenths * .75) return 'medium';
  if (storedTenths < capacityTenths) return 'high';
  return 'full';
}

export function createLandfillWorldGeometry({
  project,
  cellSize,
  rotation = 0,
  storedTenths = 0,
  capacityTenths = 10_000,
  stage,
  data = {},
}) {
  const resolvedStage = stage ?? landfillFillStage(storedTenths, capacityTenths);
  const group = create('g');
  group.setAttribute('class', 'terrain-landfill-world');
  const fillBasisPoints = capacityTenths === 0 ? 0 : Math.round(storedTenths / capacityTenths * 10_000);
  appendData(group, {
    worldRenderer: 'shared-v1',
    ...worldRecipeData('service-zone', 'landfill'),
    serviceZoneKind: 'landfill',
    artFamily: 'landfill-fill-stages',
    renderContract: 'world-space-service-zone',
    fillStage: resolvedStage,
    storedTenths,
    capacityTenths,
    fillBasisPoints,
    fillPercent: (storedTenths / capacityTenths * 100).toFixed(2),
    ...data,
  });
  group.append(polygon('terrain-landfill-soil', [
    // A small shared-edge overlap is intentional. Adjacent SVG polygons can
    // otherwise anti-alias to reveal a grass-green hairline between landfill
    // cells, especially at high zoom.
    project(-.012, -.012, .018), project(1.012, -.012, .018),
    project(1.012, 1.012, .018), project(-.012, 1.012, .018),
  ], { fill: '#b98a63', stroke: 'none' }, {
    serviceZoneKind: 'landfill', fillStage: resolvedStage, surface: 'opaque-seamless',
  }));
  if (resolvedStage === 'empty') return group;

  const refuse = [
    [.22, .24, '#bdc0a0'], [.73, .27, '#997150'], [.40, .68, '#9ba6a7'],
    [.74, .68, '#b7835d'], [.18, .61, '#d0c487'],
  ];
  const count = resolvedStage === 'scattered' ? 3 : 5;
  refuse.slice(0, count).forEach(([x, y, fill], index) => {
    group.append(polygon('terrain-landfill-refuse', [
      project(x - .055, y - .035, .05), project(x + .055, y - .035, .05),
      project(x + .055, y + .035, .05), project(x - .055, y + .035, .05),
    ], { fill, stroke: '#645448', 'stroke-width': '.34' }, {
      serviceZoneKind: 'landfill', refuseIndex: index + 1, fillStage: resolvedStage,
    }));
  });
  if (resolvedStage === 'scattered') return group;

  const moundHeight = ({ low: .18, medium: .34, high: .52, full: .66 })[resolvedStage] ?? 0;
  appendSemanticVolume(group, project, rotation, {
    left: .16, top: .18, width: .68, depth: .64, height: moundHeight, baseHeight: .04,
  }, {
    roof: resolvedStage === 'full' ? '#6e4d37' : '#876044',
    south: '#76513b', east: '#5f412f', north: '#7f5940', west: '#684833', outline: '#4d3629',
  }, 'terrain-landfill-mound', {
    serviceZoneKind: 'landfill', fillStage: resolvedStage, moundHeight,
  });
  if (resolvedStage === 'full') {
    group.append(polygon('terrain-landfill-full-marker', [
      project(.43, .43, moundHeight + .08), project(.57, .43, moundHeight + .08),
      project(.57, .57, moundHeight + .08), project(.43, .57, moundHeight + .08),
    ], { fill: '#f1d36a', stroke: '#795c26', 'stroke-width': '.55' }, {
      serviceZoneKind: 'landfill', marker: 'full', fillStage: resolvedStage,
    }));
  }
  return group;
}

// Rail stays continuous from edge to edge. This scale only narrows the
// cross-track envelope (ballast, gauge, and tie span), never its length or
// centerline: the simulation and shuttle still use the unchanged world tile
// graph.
const RAIL_CROSS_TRACK_SCALE = .9;
const RAIL_BALLAST_WIDTH = 9.4 * RAIL_CROSS_TRACK_SCALE;
const RAIL_OFFSET = 2.15 * RAIL_CROSS_TRACK_SCALE;
const RAIL_WIDTH = 1.28;
const RAIL_TIE_HALF_LENGTH = 4.45 * RAIL_CROSS_TRACK_SCALE;
const RAIL_TIE_WIDTH = 1.32;
const RAIL_JUNCTION_HALF_SPAN = 2.65 * RAIL_CROSS_TRACK_SCALE;
// Express the sleeper cadence as exact tile fractions. A tie sits one half
// spacing from either side of every shared edge, so adjoining tiles have one
// normal sleeper interval across their seam without a duplicated edge tie.
const RAIL_TIE_SPACING = 1 / 6;
const RAIL_TIE_ORIGIN = 1 / 12;
const RAIL_SEAM_EPSILON = 1e-6;

const addPoint = (point, vector, amount = 1) => ({ x: point.x + vector.x * amount, y: point.y + vector.y * amount });
const vectorBetween = (from, to) => ({ x: to.x - from.x, y: to.y - from.y });
const pointBetween = (from, to, ratio) => ({ x: from.x + (to.x - from.x) * ratio, y: from.y + (to.y - from.y) * ratio });
const distanceBetween = (from, to) => Math.hypot(to.x - from.x, to.y - from.y);

function unitVector(vector, fallback = { x: 1, y: 0 }) {
  const length = Math.hypot(vector.x, vector.y);
  return length > 0 ? { x: vector.x / length, y: vector.y / length } : fallback;
}

function railCrossUnit(segment, start, end) {
  if (segment.railCrossVector && Number.isFinite(segment.railCrossVector.x) && Number.isFinite(segment.railCrossVector.y)) {
    return unitVector(segment.railCrossVector);
  }
  // Catalog callers from older contracts still receive readable track, but
  // live map callers always supply the projected opposite grid axis.
  return unitVector({ x: start.y - end.y, y: end.x - start.x });
}

function railTieRatios(segment) {
  const axis = segment.railAxis;
  const start = segment.railWorldStart;
  const end = segment.railWorldEnd;
  if (!axis || !start || !end || !Number.isFinite(start[axis]) || !Number.isFinite(end[axis])) {
    return [1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12];
  }
  const from = start[axis];
  const to = end[axis];
  if (from === to) return [.5];
  const lower = Math.min(from, to);
  const upper = Math.max(from, to);
  const first = Math.ceil((lower - RAIL_TIE_ORIGIN) / RAIL_TIE_SPACING - RAIL_SEAM_EPSILON);
  const result = [];
  for (let index = first; RAIL_TIE_ORIGIN + index * RAIL_TIE_SPACING < upper - RAIL_SEAM_EPSILON; index += 1) {
    const coordinate = RAIL_TIE_ORIGIN + index * RAIL_TIE_SPACING;
    if (coordinate <= lower + RAIL_SEAM_EPSILON) continue;
    const ratio = (coordinate - from) / (to - from);
    if (ratio > RAIL_SEAM_EPSILON && ratio < 1 - RAIL_SEAM_EPSILON) result.push(ratio);
  }
  return result;
}

function appendRailSleeper(group, center, cross, data, art) {
  group.append(line('terrain-rail-sleeper', addPoint(center, cross, RAIL_TIE_HALF_LENGTH), addPoint(center, cross, -RAIL_TIE_HALF_LENGTH), {
    stroke: art.curb,
    width: RAIL_TIE_WIDTH,
    data,
  }));
}

function appendRailStraightSegment(group, segment, index, art, { trimAtStart = 0, trimAtEnd = 0 } = {}) {
  const rawStart = segment.start;
  const rawEnd = segment.end;
  const rawLength = distanceBetween(rawStart, rawEnd);
  const direction = unitVector({ x: rawEnd.x - rawStart.x, y: rawEnd.y - rawStart.y });
  const start = addPoint(rawStart, direction, trimAtStart);
  const end = addPoint(rawEnd, direction, -trimAtEnd);
  const cross = railCrossUnit(segment, start, end);
  const railData = {
    networkKind: 'rail',
    segmentIndex: index,
    railAxis: segment.railAxis ?? 'screen-fallback',
    tieAlignment: 'opposite-isometric-axis',
    tieCadence: '1/12+n/6-world-tiles',
    seamContract: 'continuous-world-edge',
    crossTrackScale: String(RAIL_CROSS_TRACK_SCALE),
  };
  group.append(line('terrain-rail-ballast', start, end, {
    stroke: art.surface,
    width: RAIL_BALLAST_WIDTH,
    linecap: 'butt',
    data: railData,
  }));
  // Timber sits below the steel. Painting it first leaves two continuous rails
  // legible at city scale instead of breaking them into a dotted ladder.
  const startRatio = rawLength === 0 ? 0 : trimAtStart / rawLength;
  const endRatio = rawLength === 0 ? 1 : 1 - trimAtEnd / rawLength;
  railTieRatios(segment).filter((ratio) => (
    ratio > startRatio + RAIL_SEAM_EPSILON && ratio < endRatio - RAIL_SEAM_EPSILON
  )).forEach((ratio, tieIndex) => {
    appendRailSleeper(group, pointBetween(rawStart, rawEnd, ratio), cross, {
      ...railData,
      tieIndex: tieIndex + 1,
      tiePhase: Number((ratio).toFixed(8)),
    }, art);
  });
  [-RAIL_OFFSET, RAIL_OFFSET].forEach((offset, railIndex) => {
    const railStart = addPoint(start, cross, offset);
    const railEnd = addPoint(end, cross, offset);
    group.append(line('terrain-rail-track', railStart, railEnd, {
      stroke: art.marking,
      width: RAIL_WIDTH,
      linecap: 'butt',
      data: { ...railData, railIndex: railIndex + 1 },
    }));
    // A subdued steel glint keeps the rails from reading as ink strokes while
    // retaining the user's requested near-black treatment at normal zoom.
    group.append(line('terrain-rail-track-highlight', addPoint(railStart, cross, -.22), addPoint(railEnd, cross, -.22), {
      stroke: art.highlight ?? '#4b5158',
      width: .34,
      linecap: 'butt',
      data: { ...railData, railIndex: railIndex + 1 },
    }));
  });
}

function railCurvePoint(start, control, end, ratio) {
  const inverse = 1 - ratio;
  return {
    x: inverse * inverse * start.x + 2 * inverse * ratio * control.x + ratio * ratio * end.x,
    y: inverse * inverse * start.y + 2 * inverse * ratio * control.y + ratio * ratio * end.y,
  };
}

function appendRailCorner(group, segments, center, art) {
  const [first, second] = segments;
  const firstOuter = distanceBetween(first.start, center) > distanceBetween(first.end, center) ? first.start : first.end;
  const secondOuter = distanceBetween(second.start, center) > distanceBetween(second.end, center) ? second.start : second.end;
  const firstDirection = unitVector({ x: firstOuter.x - center.x, y: firstOuter.y - center.y });
  const secondDirection = unitVector({ x: secondOuter.x - center.x, y: secondOuter.y - center.y });
  const inset = Math.min(distanceBetween(firstOuter, center), distanceBetween(secondOuter, center)) * .31;
  const firstNear = addPoint(center, firstDirection, inset);
  const secondNear = addPoint(center, secondDirection, inset);
  const firstCross = railCrossUnit(first, center, firstOuter);
  const secondCross = railCrossUnit(second, center, secondOuter);
  const middleCross = unitVector({ x: firstCross.x + secondCross.x, y: firstCross.y + secondCross.y }, firstCross);
  const curveData = {
    networkKind: 'rail',
    railTopology: 'corner',
    tieAlignment: 'world-axis-curve-transition',
    crossTrackScale: String(RAIL_CROSS_TRACK_SCALE),
  };
  const curvePath = (offset = 0) => {
    const outerA = addPoint(firstOuter, firstCross, offset);
    const nearA = addPoint(firstNear, firstCross, offset);
    const control = addPoint(center, middleCross, offset);
    const nearB = addPoint(secondNear, secondCross, offset);
    const outerB = addPoint(secondOuter, secondCross, offset);
    return `M ${outerA.x.toFixed(2)} ${outerA.y.toFixed(2)} L ${nearA.x.toFixed(2)} ${nearA.y.toFixed(2)} Q ${control.x.toFixed(2)} ${control.y.toFixed(2)} ${nearB.x.toFixed(2)} ${nearB.y.toFixed(2)} L ${outerB.x.toFixed(2)} ${outerB.y.toFixed(2)}`;
  };
  group.append(svgPath('terrain-rail-ballast terrain-rail-curve', curvePath(), {
    fill: 'none', stroke: art.surface, 'stroke-width': RAIL_BALLAST_WIDTH, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
  }, curveData));
  [.16, .34, .50, .66, .84].forEach((ratio, tieIndex) => {
    const point = railCurvePoint(firstOuter, center, secondOuter, ratio);
    const cross = unitVector({
      x: firstCross.x * (1 - ratio) + secondCross.x * ratio,
      y: firstCross.y * (1 - ratio) + secondCross.y * ratio,
    }, middleCross);
    appendRailSleeper(group, point, cross, { ...curveData, railAxis: 'corner', tieIndex: tieIndex + 1 }, art);
  });
  [-RAIL_OFFSET, RAIL_OFFSET].forEach((offset, railIndex) => {
    group.append(svgPath('terrain-rail-track terrain-rail-curve', curvePath(offset), {
      fill: 'none', stroke: art.marking, 'stroke-width': RAIL_WIDTH, 'stroke-linecap': 'butt', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke',
    }, { ...curveData, railIndex: railIndex + 1 }));
  });
}

function appendRailFrog(group, segments, center, topology, art) {
  if (!['tee', 'cross'].includes(topology) || segments.length === 0) return;
  const first = segments[0];
  const direction = unitVector({ x: first.end.x - first.start.x, y: first.end.y - first.start.y });
  const cross = railCrossUnit(first, first.start, first.end);
  group.append(polygon('terrain-rail-frog', [
    addPoint(center, direction, RAIL_JUNCTION_HALF_SPAN),
    addPoint(center, cross, RAIL_JUNCTION_HALF_SPAN),
    addPoint(center, direction, -RAIL_JUNCTION_HALF_SPAN),
    addPoint(center, cross, -RAIL_JUNCTION_HALF_SPAN),
  ], {
    fill: art.marking,
    stroke: '#08090b',
    'stroke-width': '.45',
    'vector-effect': 'non-scaling-stroke',
  }, {
    networkKind: 'rail',
    railTopology: topology,
    junction: topology === 'tee' ? 'turnout-frog' : 'diamond-crossing',
    crossTrackScale: String(RAIL_CROSS_TRACK_SCALE),
  }));
}

function appendNetworkSegment(group, kind, segment, index, { representativeRoute = false } = {}) {
  const { start, end } = segment;
  const art = networkWorldArt(kind);
  if (!art) throw new Error(`No shared network world-art recipe for ${kind}.`);
  const vector = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(vector.x, vector.y) || 1;
  const normal = { x: -vector.y / length, y: vector.x / length };
  const path = (className, a, b, stroke, width, data = {}) => group.append(line(className, a, b, { stroke, width, data }));
  const routeData = representativeRoute ? { representativeRouteSegment: true } : {};
  if (kind === 'power-line') {
    const center = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const top = { x: center.x, y: center.y - 30 };
    const lifted = (point, offset) => ({
      x: point.x + normal.x * offset,
      y: point.y - 30 + normal.y * offset,
    });
    [-8, 8].forEach((offset, conductorIndex) => {
      const support = { x: top.x + normal.x * offset, y: top.y + normal.y * offset };
      path('terrain-network terrain-network-power-line terrain-network-power-cable terrain-power-conductor', lifted(start, offset), support, art.marking, .82, {
        networkKind: kind,
        segmentIndex: index,
        conductorIndex: conductorIndex + 1,
        spanHalf: 'start',
        ...(conductorIndex === 0 ? routeData : {}),
      });
      path('terrain-network terrain-network-power-line terrain-network-power-cable terrain-power-conductor', support, lifted(end, offset), art.marking, .82, {
        networkKind: kind,
        segmentIndex: index,
        conductorIndex: conductorIndex + 1,
        spanHalf: 'end',
      });
    });
    path('terrain-network-power-pole terrain-network-power-pole-upright terrain-power-pole-shaft', center, top, art.curb, 1.45, { networkKind: kind, poleIndex: 1, catalogDetail: 'upright' });
    path('terrain-network-power-crossarm terrain-power-pole-crossbar', { x: top.x - normal.x * 10, y: top.y - normal.y * 10 }, { x: top.x + normal.x * 10, y: top.y + normal.y * 10 }, art.curb, 1.2, { networkKind: kind, poleIndex: 1, catalogDetail: 'crossarm' });
    [-8, 8].forEach((offset, insulatorIndex) => {
      group.append(circle('terrain-network-power-insulator terrain-power-insulator', { x: top.x + normal.x * offset, y: top.y + normal.y * offset }, 1.55, {
        fill: art.marking, stroke: art.surface, 'stroke-width': .45,
      }, { networkKind: kind, insulatorIndex: insulatorIndex + 1, catalogDetail: 'insulator' }));
    });
    group.append(circle('terrain-network-power-footing terrain-power-pole-footing', center, 2.4, {
      fill: art.curb, stroke: art.surface, 'stroke-width': .7,
    }, { networkKind: kind, catalogDetail: 'footing' }));
    return;
  }
  if (kind === 'road') {
    path('terrain-network terrain-network-road terrain-road-bed', start, end, art.surface, 8.2, { networkKind: kind, segmentIndex: index, ...routeData });
    const marking = line('terrain-network terrain-network-road terrain-road-marking', start, end, {
      stroke: art.marking, width: 1.15, data: { networkKind: kind, segmentIndex: index },
    });
    marking.setAttribute('stroke-dasharray', '5 4');
    group.append(marking);
    return;
  }
  if (art.family === 'rail-track') {
    appendRailStraightSegment(group, segment, index, art);
    return;
  }
  path(`terrain-network terrain-network-${kind}`, start, end, art.surface, 3.2, { networkKind: kind, artFamily: art.family, renderContract: 'world-svg-network-v1', segmentIndex: index, ...routeData });
}

/** Add canonical world-SVG network strokes. Map and thumbnails use this. */
export function appendNetworkWorldGeometry(group, {
  kind,
  segments,
  center,
  underground = false,
  representativeRoute = false,
  stationCutaway = false,
  railTopology = 'straight',
  data = {},
}) {
  const art = networkWorldArt(kind);
  if (!art) throw new Error(`No shared network world-art recipe for ${kind}.`);
  const recipe = underground && kind === 'subway'
    ? { worldRecipeId: 'network:subway:v4', worldGeometryFingerprint: 'network-subway-concrete-tube-geometry-v4' }
    : networkRecipeData(kind);
  appendData(group, {
    worldRenderer: 'shared-v1',
    ...recipe,
    networkKind: kind,
    artFamily: art.family,
    renderContract: underground && kind === 'subway'
      ? 'world-svg-underground-concrete-tube-v3'
      : underground
        ? 'world-svg-underground-network-v1'
        : 'world-svg-network-v1',
    ...(underground && kind === 'subway'
      ? { subwayStructure: stationCutaway ? 'station-cutaway-approach' : 'closed-concrete-tube' }
      : {}),
    ...(representativeRoute ? { representativeRoute: 'cardinal-straight', worldRouteAxis: 'x' } : {}),
    ...data,
  });
  if (underground && kind === 'subway' && stationCutaway) group.classList.add('underground-subway-station-approach');
  const routeData = representativeRoute ? { representativeRouteSegment: true } : {};
  if (underground) {
    segments.forEach(({ start, end }, index) => {
      if (kind === 'water-pipe') {
        group.append(line('underground-network underground-water-pipe underground-trench', start, end, { stroke: art.curb, width: 6.4, data: { networkKind: kind, segmentIndex: index, ...routeData } }));
        group.append(line('underground-network underground-water-pipe underground-water-jacket', start, end, { stroke: art.surface, width: 4.1, data: { networkKind: kind, segmentIndex: index } }));
        group.append(line('underground-network underground-water-pipe underground-water-highlight', start, end, { stroke: art.marking, width: .9, data: { networkKind: kind, segmentIndex: index } }));
      } else {
        const vector = { x: end.x - start.x, y: end.y - start.y };
        const length = Math.hypot(vector.x, vector.y) || 1;
        const normal = { x: -vector.y / length, y: vector.x / length };
        const segmentData = { networkKind: kind, segmentIndex: index, ...routeData };
        group.append(line('underground-network underground-subway underground-trench underground-subway-tube-shadow', start, end, {
          stroke: art.curb, width: 7.4, data: segmentData,
        }));
        group.append(line('underground-network underground-subway underground-subway-tube-shell', start, end, {
          stroke: art.surface, width: 5.6, data: segmentData,
        }));
        group.append(line('underground-network underground-subway underground-subway-tube-highlight', {
          x: start.x - normal.x * 1.25, y: start.y - normal.y * 1.25,
        }, {
          x: end.x - normal.x * 1.25, y: end.y - normal.y * 1.25,
        }, { stroke: art.marking, width: .85, data: segmentData }));
        if (length >= 12) {
          const seam = { x: start.x + vector.x * .5, y: start.y + vector.y * .5 };
          group.append(line('underground-network underground-subway underground-subway-tube-seam', {
            x: seam.x + normal.x * 2.85, y: seam.y + normal.y * 2.85,
          }, {
            x: seam.x - normal.x * 2.85, y: seam.y - normal.y * 2.85,
          }, { stroke: art.curb, width: .7, data: segmentData }));
        }
      }
    });
    if (!representativeRoute && kind === 'subway' && segments.length !== 1) {
      const junctionData = { networkKind: kind, connectionCount: segments.length, junctionShape: 'solid-sphere' };
      group.append(circle('underground-network underground-subway underground-subway-tube-junction-shadow underground-node', {
        x: center.x + .7, y: center.y + .9,
      }, 4.15, {
        fill: art.curb, opacity: '.82', stroke: 'none', style: `fill: ${art.curb}`,
      }, junctionData));
      group.append(circle('underground-network underground-subway underground-subway-tube-junction-sphere', center, 4.15, {
        fill: art.surface, stroke: art.curb, 'stroke-width': '.8', style: `fill: ${art.surface}`,
      }, junctionData));
      group.append(circle('underground-network underground-subway underground-subway-tube-junction-sphere-highlight', {
        x: center.x - 1.15, y: center.y - 1.25,
      }, 1.15, {
        fill: art.marking, opacity: '.72', stroke: 'none', style: `fill: ${art.marking}`,
      }, junctionData));
    } else if (!representativeRoute && kind === 'water-pipe' && segments.length !== 1) {
      group.append(circle('underground-network underground-water-pipe underground-node', center, 1.35, {
        fill: art.marking, stroke: art.curb, 'stroke-width': '.5',
      }, { networkKind: kind }));
    }
    return;
  }
  if (kind === 'rail') {
    if (!representativeRoute && railTopology === 'corner' && segments.length === 2) {
      appendRailCorner(group, segments, center, art);
      return;
    }
    const junctionTrim = !representativeRoute && ['tee', 'cross'].includes(railTopology) ? 2.2 : 0;
    segments.forEach((segment, index) => {
      const startAtCenter = distanceBetween(segment.start, center) < .01;
      const endAtCenter = distanceBetween(segment.end, center) < .01;
      appendRailStraightSegment(group, segment, index, art, {
        trimAtStart: startAtCenter ? junctionTrim : 0,
        trimAtEnd: endAtCenter ? junctionTrim : 0,
      });
    });
    appendRailFrog(group, segments, center, railTopology, art);
    return;
  }
  segments.forEach((segment, index) => appendNetworkSegment(group, kind, segment, index, { representativeRoute }));
  if (!representativeRoute && segments.length !== 1) group.append(circle(`terrain-network-node terrain-network-node-${kind}`, center, 1.15, { fill: art.marking, stroke: art.curb, 'stroke-width': '.5' }, { networkKind: kind }));
}

/**
 * Create the small code-native passenger train used by derived rail shuttles.
 * The caller supplies only a projected centre and heading; route progress and
 * pause state remain local dashboard concerns and never enter canonical state.
 */
export function createPassengerTrainWorldGeometry({ center, heading, cellSize, data = {} }) {
  const length = Math.hypot(Number(heading?.x), Number(heading?.y));
  if (!Number.isFinite(center?.x) || !Number.isFinite(center?.y) || !Number.isFinite(length) || length === 0) {
    throw new TypeError('Passenger train geometry requires a finite centre and non-zero heading.');
  }
  if (!Number.isFinite(cellSize) || cellSize <= 0) throw new RangeError('Passenger train cellSize must be positive.');
  const forward = { x: heading.x / length, y: heading.y / length };
  const normal = { x: -forward.y, y: forward.x };
  const halfLength = Math.max(5.5, cellSize * .27);
  const halfWidth = Math.max(2.1, cellSize * .09);
  const at = (along, across, lift = 0) => ({
    x: center.x + forward.x * along + normal.x * across,
    y: center.y + forward.y * along + normal.y * across - lift,
  });
  const group = create('g');
  group.setAttribute('class', 'market-train-shuttle');
  appendData(group, {
    worldRenderer: 'shared-v1',
    worldRecipeId: 'vehicle:passenger-train:v1',
    worldGeometryFingerprint: 'vehicle-passenger-train-geometry-v1',
    vehicleKind: 'passenger-train',
    renderContract: 'derived-ui-only-rail-shuttle',
    ...data,
  });
  group.append(polygon('market-train-shuttle-shadow', [
    at(halfLength + .8, -halfWidth - .4), at(halfLength + .8, halfWidth + .4),
    at(-halfLength - .8, halfWidth + .4), at(-halfLength - .8, -halfWidth - .4),
  ], { fill: 'rgba(25,31,38,.28)', stroke: 'none' }));
  group.append(polygon('market-train-shuttle-car', [
    at(halfLength, -halfWidth, 1.2), at(halfLength, halfWidth, 1.2),
    at(-halfLength, halfWidth, 1.2), at(-halfLength, -halfWidth, 1.2),
  ], { fill: '#d8d5ca', stroke: '#3d4650', 'stroke-width': '.8', 'vector-effect': 'non-scaling-stroke' }));
  group.append(polygon('market-train-shuttle-roof', [
    at(halfLength * .68, -halfWidth * .62, 2.35), at(halfLength * .68, halfWidth * .62, 2.35),
    at(-halfLength * .72, halfWidth * .62, 2.35), at(-halfLength * .72, -halfWidth * .62, 2.35),
  ], { fill: '#bf3f3b', stroke: '#772d32', 'stroke-width': '.65', 'vector-effect': 'non-scaling-stroke' }));
  [-.34, .18].forEach((longitudinal, column) => {
    [-1, 1].forEach((side, sideIndex) => {
      const along = halfLength * longitudinal;
      const across = halfWidth * side * .71;
      group.append(polygon('market-train-shuttle-window', [
        at(along + halfLength * .13, across - halfWidth * .14, 2.45),
        at(along + halfLength * .13, across + halfWidth * .14, 2.45),
        at(along - halfLength * .13, across + halfWidth * .14, 2.45),
        at(along - halfLength * .13, across - halfWidth * .14, 2.45),
      ], { fill: '#75b6cd', stroke: '#315b70', 'stroke-width': '.45', 'vector-effect': 'non-scaling-stroke' }, {
        windowIndex: column * 2 + sideIndex + 1,
      }));
    });
  });
  group.append(polygon('market-train-shuttle-cab', [
    at(halfLength + 1.1, 0, 1.55),
    at(halfLength * .67, -halfWidth * .66, 2.38),
    at(halfLength * .67, halfWidth * .66, 2.38),
  ], { fill: '#f0c85e', stroke: '#6f5729', 'stroke-width': '.65', 'vector-effect': 'non-scaling-stroke' }));
  return group;
}

/** Canonical below-ground half of a subway station, shared by map and card. */
export function createSubwayStationUndergroundGeometry({
  footprint,
  project,
  cellSize,
  rotation = 0,
  connected = true,
  connectionBits = [2, 8],
  data = {},
}) {
  const width = footprint.width;
  const depth = footprint.height;
  const requestedBits = [...new Set(connectionBits.filter((bit) => [1, 2, 4, 8].includes(bit)))];
  const activeBits = connected ? (requestedBits.length ? requestedBits : [2, 8]) : [];
  const horizontalConnections = activeBits.filter((bit) => bit === 2 || bit === 8).length;
  const verticalConnections = activeBits.filter((bit) => bit === 1 || bit === 4).length;
  const routeAxis = horizontalConnections >= verticalConnections ? 'x' : 'y';
  const group = create('g');
  group.setAttribute('class', 'underground-subway-station-world');
  if (connected) group.classList.add('underground-subway-station-cutaway');
  appendData(group, {
    worldRenderer: 'shared-v1',
    worldRecipeId: 'facility:subway-station-underground:v2',
    worldGeometryFingerprint: 'facility-subway-station-underground-geometry-v2',
    facilityKind: 'subway-station',
    artFamily: 'subway-station-underground',
    renderContract: 'world-space-underground-facility',
    tubeCutaway: connected ? 'connected' : 'none',
    connectionBits: activeBits.join(','),
    routeAxis,
    rotation,
    ...data,
  });

  group.append(polygon('underground-subway-station-chamber', [
    project(width * .06, depth * .14, -.03),
    project(width * .94, depth * .14, -.03),
    project(width * .94, depth * .86, -.03),
    project(width * .06, depth * .86, -.03),
  ], {
    fill: '#313b42', stroke: '#6f858f', 'stroke-width': '.8', 'vector-effect': 'non-scaling-stroke',
  }));
  const portalPoints = {
    1: [width * .50, depth * .14],
    2: [width * .94, depth * .50],
    4: [width * .50, depth * .86],
    8: [width * .06, depth * .50],
  };
  activeBits.forEach((bit) => {
    const [x, y] = portalPoints[bit];
    group.append(circle('underground-network underground-subway underground-subway-station-tube-portal', project(x, y, .04), Math.max(2, cellSize * .05), {
      fill: '#20282d', stroke: '#aeb8bc', 'stroke-width': '.8', 'vector-effect': 'non-scaling-stroke',
    }, { connectionBit: bit }));
  });
  const platformPoints = routeAxis === 'x'
    ? [[.08, .39], [.92, .39], [.92, .61], [.08, .61]]
    : [[.39, .08], [.61, .08], [.61, .92], [.39, .92]];
  group.append(polygon('underground-subway-station-platform', platformPoints.map(([x, y]) => project(width * x, depth * y, .03)), {
    fill: '#83949b', stroke: '#d4e4ec', 'stroke-width': '.75', 'vector-effect': 'non-scaling-stroke',
  }));
  if (connected) {
    [.27, .73].forEach((ratio, index) => {
      const start = routeAxis === 'x' ? project(0, depth * ratio, .06) : project(width * ratio, 0, .06);
      const end = routeAxis === 'x' ? project(width, depth * ratio, .06) : project(width * ratio, depth, .06);
      group.append(line(`underground-network underground-subway underground-subway-station underground-subway-rail ${index === 0 ? 'one' : 'two'}`, start, end, {
        stroke: '#c8e6ee',
        width: Math.max(1.1, cellSize * .045),
        data: { stationRail: index + 1, routeAxis },
      }));
    });
  }
  return group;
}

function rotateThumbnailPoint(point, rotation, width, height) {
  switch (((rotation % 4) + 4) % 4) {
    case 1: return { x: height - point.y, y: point.x };
    case 2: return { x: width - point.x, y: height - point.y };
    case 3: return { x: point.y, y: width - point.x };
    default: return point;
  }
}

const SINGLE_TILE_FACILITY_PREVIEWS = new Set(['bus-stop', 'subway-station']);

function catalogThumbnailFrame(kind, footprint, mode) {
  if (footprint.width !== 1 || footprint.height !== 1) return 'footprint';
  if (mode === 'network') return 'network-tile';
  if (mode === 'underground') return 'underground-network-tile';
  if (SINGLE_TILE_FACILITY_PREVIEWS.has(kind)) return 'single-tile-facility';
  return 'footprint';
}

function catalogThumbnailCellSize({ frame, viewWidth, viewHeight, maxLift }) {
  const footprintCell = Math.max(4.5, Math.min(25, 204 / (viewWidth + viewHeight), 134 / ((viewWidth + viewHeight) * .5 + maxLift * .56)));
  if (frame === 'footprint') return footprintCell;

  // A 1 x 1 placement is otherwise only a 50-by-25 viewBox-pixel diamond in
  // a 240-by-160 card.  Keep the exact map geometry, but give a one-cell
  // catalogue scene enough room to be read as the placement tile itself.
  return Math.max(footprintCell, Math.min(60, 204 / 2, 134 / (1 + maxLift * .56)));
}

function appendCatalogNetworkSurface(group, { kind, project }) {
  const art = networkWorldArt(kind);
  if (!art) throw new Error(`No shared network world-art recipe for ${kind}.`);
  if (kind === 'avenue') {
    appendData(group, {
      worldRenderer: 'shared-v1',
      worldRecipeId: 'network:avenue:v1',
      worldGeometryFingerprint: 'network-avenue-geometry-v1',
      networkKind: kind,
      artFamily: art.family,
      renderContract: 'world-svg-avenue-v1',
      representativeRoute: 'paired-cardinal-straight',
      worldRouteAxis: 'y',
      gradeCrossingCompatible: 'rail',
      drivingSide: 'right',
      atomicFootprint: 'paired-lanes',
    });
    const lanes = [
      { x: 0, travelMask: 4, pairMask: 2, laneRole: 'drawn' },
      { x: 1, travelMask: 1, pairMask: 8, laneRole: 'paired' },
    ];
    lanes.forEach((lane) => {
      const laneGroup = create('g');
      laneGroup.setAttribute('class', `catalog-thumbnail-avenue-lane catalog-thumbnail-avenue-lane-${lane.laneRole}`);
      appendAvenueWorldGeometry(laneGroup, {
        project: (x, y, lift = 0) => project(lane.x + x, y, lift),
        travelMask: lane.travelMask,
        pairMask: lane.pairMask,
        laneRole: lane.laneRole,
        tile: { x: lane.x, y: 0 },
        preview: true,
      });
      group.append(laneGroup);
    });
    return;
  }
  if (kind === 'road') {
    appendData(group, {
      worldRenderer: 'shared-v1',
      ...worldRecipeData('network', kind),
      networkKind: kind,
      artFamily: art.family,
      renderContract: 'world-svg-road-v2',
      representativeRoute: 'cardinal-straight',
      worldRouteAxis: 'x',
    });
    // A road placement is the road-covered map cell itself. Keep this as the
    // same four-corner projected tile used by renderRoadConstruction instead
    // of inventing a separate diagonal catalog band inside the cell.
    group.append(polygon('catalog-thumbnail-network-surface catalog-thumbnail-road-surface terrain-road-bed', [
      project(0, 0), project(1, 0), project(1, 1), project(0, 1),
    ], {
      fill: art.surface, stroke: 'none',
    }, { networkKind: kind, renderContract: 'world-svg-road-v2', segmentIndex: 0 }));

    const details = create('g');
    details.setAttribute('class', 'terrain-road-svg-details');
    appendData(details, { networkKind: kind, artFamily: art.family, renderContract: 'world-svg-road-v2' });
    const pointOnRoad = (along, across) => project(along, across);
    const roadLine = (className, across, start, end, stroke, width) => details.append(line(
      className,
      pointOnRoad(start, across),
      pointOnRoad(end, across),
      { stroke, width, data: { networkKind: kind, segmentIndex: 0 } },
    ));
    roadLine('terrain-road-edge-line', .14, .07, .93, '#939b9e', .56);
    roadLine('terrain-road-edge-line', .86, .07, .93, '#939b9e', .56);
    [[.09, .30], [.43, .64], [.77, .91]].forEach(([start, end]) => {
      roadLine('terrain-road-centre-line', .50, start, end, art.marking, .82);
    });
    group.append(details);
  }
}

/**
 * Produce a compact terrain scene: actual flat world terrain for the true
 * footprint only, with the shared map renderer at one yaw. The surrounding
 * card background intentionally stays flat so it does not imply extra land.
 */
export function createCatalogWorldThumbnail({ kind, footprint, mode = 'surface', rotation = 0, label, stage = 'empty', storedTenths = 0, capacityTenths = 10_000, visualVariantId = '' }) {
  const svg = create('svg');
  const normalizedRotation = ((rotation % 4) + 4) % 4;
  const swapped = normalizedRotation % 2 === 1;
  const viewWidth = swapped ? footprint.height : footprint.width;
  const viewHeight = swapped ? footprint.width : footprint.height;
  const maxLift = mode === 'service-zone'
    ? .75
    : kind === 'coal-power-plant' ? 4.8 : Math.max(1.4, bodyHeight(kind, footprint, facilityWorldArt(kind, visualVariantId)));
  const frame = catalogThumbnailFrame(kind, footprint, mode);
  const cell = catalogThumbnailCellSize({ frame, viewWidth, viewHeight, maxLift });
  // The one-cell wind rotor deliberately overhangs its ground footprint. Move
  // that complete thumbnail scene down enough viewBox pixels so the upper blade
  // stays visible without shrinking the newly legible rotor.
  const baseY = 10 + maxLift * cell * .56 + (kind === 'wind-turbine' ? 14 : 0);
  const project = (x, y, lift = 0) => {
    const rotated = rotateThumbnailPoint({ x, y }, normalizedRotation, footprint.width, footprint.height);
    const world = { x: rotated.x, y: rotated.y };
    return { x: 120 + (world.x - world.y) * cell, y: baseY + (world.x + world.y) * cell * .5 - lift * cell * .56 };
  };
  svg.setAttribute('class', 'utility-catalog-preview-svg shared-world-thumbnail');
  svg.setAttribute('viewBox', '0 0 240 160');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label ?? kind}, ${normalizedRotation === 0 ? 'north-up' : `map view rotation ${normalizedRotation + 1}`}`);
  appendData(svg, { worldRenderer: 'shared-v1', previewKind: kind, previewRotation: normalizedRotation, previewOrientation: normalizedRotation === 0 ? 'north-up' : 'rotated', previewMode: mode, previewFrame: frame, footprintWidth: footprint.width, footprintHeight: footprint.height });
  const background = create('rect');
  background.setAttribute('width', '240'); background.setAttribute('height', '160'); background.setAttribute('fill', mode === 'underground' ? '#354249' : mode === 'service-zone' ? '#8d755a' : '#759968');
  svg.append(background);
  const terrain = create('g');
  terrain.setAttribute('class', 'catalog-thumbnail-terrain');
  for (let y = 0; y < footprint.height; y += 1) for (let x = 0; x < footprint.width; x += 1) {
    const tile = polygon('catalog-thumbnail-terrain-tile', [project(x, y), project(x + 1, y), project(x + 1, y + 1), project(x, y + 1)], {
      fill: mode === 'underground' ? ((x + y) % 2 ? '#46555b' : '#4c5c62') : mode === 'service-zone' ? ((x + y) % 2 ? '#88694d' : '#956f50') : ((x + y) % 2 ? '#6f9b61' : '#7aa968'),
      stroke: mode === 'underground' ? '#71838a' : mode === 'service-zone' ? '#604733' : '#547c4d',
      'stroke-width': '.52',
      'vector-effect': 'non-scaling-stroke',
    }, { terrainX: x, terrainY: y });
    terrain.append(tile);
  }
  svg.append(terrain);
  if (mode === 'network') {
    const root = create('g');
    root.setAttribute('class', `catalog-thumbnail-world-item catalog-thumbnail-network-${kind}`);
    appendCatalogNetworkSurface(root, { kind, project });
    if (kind !== 'road' && kind !== 'avenue') {
      const segments = [{
        start: project(0, .5, .07),
        end: project(1, .5, .07),
        ...(kind === 'rail' ? {
          railAxis: 'x',
          railCrossVector: vectorBetween(project(.5, 0, .07), project(.5, 1, .07)),
          railWorldStart: { x: 0, y: .5 },
          railWorldEnd: { x: 1, y: .5 },
        } : {}),
      }];
      appendNetworkWorldGeometry(root, { kind, segments, center: project(.5, .5, .08), underground: false, representativeRoute: true });
    }
    svg.append(root);
  } else if (mode === 'underground') {
    const root = create('g');
    root.setAttribute('class', `catalog-thumbnail-world-item catalog-thumbnail-underground-${kind}`);
    const segments = [{ start: project(0, .5, .05), end: project(1, .5, .05) }];
    appendNetworkWorldGeometry(root, { kind, segments, center: project(.5, .5, .06), underground: true, representativeRoute: true });
    svg.append(root);
  } else if (mode === 'service-zone') {
    svg.append(createLandfillWorldGeometry({
      project,
      cellSize: cell,
      rotation: normalizedRotation,
      stage,
      storedTenths,
      capacityTenths,
      data: { preview: 'catalog', footprintWidth: footprint.width, footprintDepth: footprint.height },
    }));
  } else {
    svg.append(createFacilityWorldGeometry({ kind, footprint, project, cellSize: cell, rotation: normalizedRotation, animate: false, visualVariantId, data: { preview: 'catalog', footprintWidth: footprint.width, footprintDepth: footprint.height } }));
  }
  return svg;
}

/** Fixed north-up selector scene for the station's canonical underground half. */
export function createSubwayStationUndergroundThumbnail({ footprint, rotation = 0, label }) {
  const svg = create('svg');
  const normalizedRotation = 0;
  const frame = 'underground-station-tile';
  const cell = catalogThumbnailCellSize({ frame, viewWidth: footprint.width, viewHeight: footprint.height, maxLift: .8 });
  const baseY = 52;
  const project = (x, y, lift = 0) => {
    const rotated = rotateThumbnailPoint({ x, y }, normalizedRotation, footprint.width, footprint.height);
    return {
      x: 120 + (rotated.x - rotated.y) * cell,
      y: baseY + (rotated.x + rotated.y) * cell * .5 - lift * cell * .56,
    };
  };
  svg.setAttribute('class', 'utility-catalog-preview-svg shared-world-thumbnail shared-world-thumbnail-underground-station');
  svg.setAttribute('viewBox', '0 0 240 160');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${label ?? 'Subway station'}, below ground, north-up`);
  appendData(svg, {
    worldRenderer: 'shared-v1',
    previewKind: 'subway-station-underground',
    previewRotation: normalizedRotation,
    previewOrientation: 'north-up',
    previewMode: 'underground-station',
    previewFrame: frame,
    footprintWidth: footprint.width,
    footprintHeight: footprint.height,
    requestedRotation: rotation,
  });

  const background = create('rect');
  background.setAttribute('width', '240');
  background.setAttribute('height', '160');
  background.setAttribute('fill', '#303c43');
  svg.append(background);
  const terrain = create('g');
  terrain.setAttribute('class', 'catalog-thumbnail-terrain catalog-thumbnail-underground-grid');
  for (let y = 0; y < footprint.height; y += 1) for (let x = 0; x < footprint.width; x += 1) {
    terrain.append(polygon('catalog-thumbnail-terrain-tile catalog-thumbnail-underground-grid-tile', [
      project(x, y), project(x + 1, y), project(x + 1, y + 1), project(x, y + 1),
    ], {
      fill: 'transparent', stroke: '#71838a', 'stroke-width': '.7', 'vector-effect': 'non-scaling-stroke',
    }, { terrainX: x, terrainY: y }));
  }
  svg.append(terrain);
  const root = createSubwayStationUndergroundGeometry({
    footprint,
    project,
    cellSize: cell,
    rotation: normalizedRotation,
    connected: true,
    connectionBits: [2, 8],
    data: { preview: 'catalog', footprintWidth: footprint.width, footprintDepth: footprint.height },
  });
  root.classList.add('catalog-thumbnail-world-item', 'catalog-thumbnail-underground-subway-station');
  svg.append(root);
  return svg;
}

/** A build-time friendly coverage hook for the map and catalogue contracts. */
export function sharedWorldArtCoverage({ facilityKinds = [], networkKinds = [] } = {}) {
  return Object.freeze({
    missingFacilities: Object.freeze(facilityKinds.filter((kind) => !facilityWorldArt(kind))),
    missingNetworks: Object.freeze(networkKinds.filter((kind) => !networkWorldArt(kind))),
  });
}

export const SHARED_WORLD_RENDERER_VERSION = 'shared-world-svg-v1';
