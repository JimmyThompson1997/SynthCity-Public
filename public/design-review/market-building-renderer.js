/**
 * Code-native SVG renderer for the frozen market RCI appearance contract.
 *
 * This module is deliberately a one-way view: it consumes a MarketRenderLot,
 * creates world-space SVG, and never reads or mutates simulation state.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const create = (name) => document.createElementNS(SVG_NS, name);
const clamp = (value, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const normalizedQuarterTurn = (value) => ((Math.trunc(value) % 4) + 4) % 4;
const pointString = (points) => points
  .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
  .join(' ');

function appendData(element, data = {}) {
  Object.entries(data).forEach(([key, value]) => {
    if (value !== undefined && value !== null) element.dataset[key] = String(value);
  });
}

function attributes(element, values = {}) {
  Object.entries(values).forEach(([name, value]) => {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
  });
  return element;
}

function group(className, data = {}) {
  const element = create('g');
  element.setAttribute('class', className);
  appendData(element, data);
  return element;
}

function appendLocalAnchor(element, points) {
  const localPoints = points
    .map((point) => point?.__marketLocal)
    .filter((point) => point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.elevation));
  if (!localPoints.length) return;
  const average = (key) => localPoints.reduce((total, point) => total + point[key], 0) / localPoints.length;
  appendData(element, {
    worldAnchorX: average('x').toFixed(5),
    worldAnchorY: average('y').toFixed(5),
    worldAnchorElevation: average('elevation').toFixed(5),
  });
}

function polygon(className, points, values = {}, data = {}) {
  const element = create('polygon');
  element.setAttribute('class', className);
  element.setAttribute('points', pointString(points));
  attributes(element, values);
  appendData(element, data);
  appendLocalAnchor(element, points);
  return element;
}

function line(className, start, end, values = {}, data = {}) {
  const element = create('line');
  element.setAttribute('class', className);
  attributes(element, {
    x1: start.x.toFixed(2),
    y1: start.y.toFixed(2),
    x2: end.x.toFixed(2),
    y2: end.y.toFixed(2),
    'vector-effect': 'non-scaling-stroke',
    'stroke-linecap': 'round',
    ...values,
  });
  appendData(element, data);
  appendLocalAnchor(element, [start, end]);
  return element;
}

function circle(className, center, radius, values = {}, data = {}) {
  const element = create('circle');
  element.setAttribute('class', className);
  attributes(element, {
    cx: center.x.toFixed(2),
    cy: center.y.toFixed(2),
    r: Math.max(0, radius).toFixed(2),
    ...values,
  });
  appendData(element, data);
  appendLocalAnchor(element, [center]);
  return element;
}

function ellipse(className, center, radiusX, radiusY, values = {}, data = {}) {
  const element = create('ellipse');
  element.setAttribute('class', className);
  attributes(element, {
    cx: center.x.toFixed(2),
    cy: center.y.toFixed(2),
    rx: Math.max(0, radiusX).toFixed(2),
    ry: Math.max(0, radiusY).toFixed(2),
    ...values,
  });
  appendData(element, data);
  appendLocalAnchor(element, [center]);
  return element;
}

const FOOTPRINTS = Object.freeze({
  '1x1': Object.freeze({
    width: 1,
    depth: 1,
    cells: Object.freeze([[0, 0]]),
    boundary: Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1]]),
  }),
  '1x2': Object.freeze({
    width: 2,
    depth: 1,
    cells: Object.freeze([[0, 0], [1, 0]]),
    boundary: Object.freeze([[0, 0], [2, 0], [2, 1], [0, 1]]),
  }),
  '2x1': Object.freeze({
    width: 1,
    depth: 2,
    cells: Object.freeze([[0, 0], [0, 1]]),
    boundary: Object.freeze([[0, 0], [1, 0], [1, 2], [0, 2]]),
  }),
  '2x2': Object.freeze({
    width: 2,
    depth: 2,
    cells: Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]]),
    boundary: Object.freeze([[0, 0], [2, 0], [2, 2], [0, 2]]),
  }),
  L: Object.freeze({
    width: 2,
    depth: 2,
    cells: Object.freeze([[0, 0], [0, 1], [1, 1]]),
    boundary: Object.freeze([[0, 0], [1, 0], [1, 1], [2, 1], [2, 2], [0, 2]]),
  }),
});

const VISIBLE_FACES = Object.freeze([
  Object.freeze(['south', 'east']),
  Object.freeze(['west', 'south']),
  Object.freeze(['north', 'west']),
  Object.freeze(['east', 'north']),
]);

function colorChannel(value) {
  return Math.round(clamp(Number(value) || 0, 0, 255));
}

function rgb(color) {
  return `rgb(${color.map(colorChannel).join(', ')})`;
}

function scaledColor(color, factor, mix = null, mixAmount = 0) {
  const mixed = color.map((channel, index) => (
    channel * (1 - mixAmount) + (mix?.[index] ?? channel) * mixAmount
  ));
  return rgb(mixed.map((channel) => channel * factor));
}

function palette(color, char) {
  const soot = clamp(char) * 0.48;
  const base = color.map((channel) => channel * (1 - soot));
  return {
    roof: scaledColor(base, 1.10),
    // Visible pairs are south+east, west+south, north+west, east+north, so the
    // spread has to work for each PAIR rather than across the whole set.
    north: scaledColor(base, 0.98),
    east: scaledColor(base, 0.70),
    south: scaledColor(base, 0.88),
    west: scaledColor(base, 0.74),
    outline: scaledColor(base, 0.48),
    accent: scaledColor(base, 1.24, [244, 238, 218], 0.16),
  };
}

function footprintGeometry(kind) {
  return FOOTPRINTS[kind] ?? FOOTPRINTS['1x1'];
}

function worldPointMap(footprint, pad = 0.09) {
  const scaleX = (footprint.width - pad * 2) / footprint.width;
  const scaleY = (footprint.depth - pad * 2) / footprint.depth;
  return ([x, y]) => [pad + x * scaleX, pad + y * scaleY];
}

function occupiedKey(x, y) {
  return `${x}:${y}`;
}

function outerEdges(footprint, mapPoint) {
  const occupied = new Set(footprint.cells.map(([x, y]) => occupiedKey(x, y)));
  const output = [];
  footprint.cells.forEach(([x, y]) => {
    const candidates = [
      { face: 'north', neighbor: [x, y - 1], start: [x, y], end: [x + 1, y] },
      { face: 'east', neighbor: [x + 1, y], start: [x + 1, y], end: [x + 1, y + 1] },
      { face: 'south', neighbor: [x, y + 1], start: [x + 1, y + 1], end: [x, y + 1] },
      { face: 'west', neighbor: [x - 1, y], start: [x, y + 1], end: [x, y] },
    ];
    candidates.forEach((candidate) => {
      if (!occupied.has(occupiedKey(...candidate.neighbor))) {
        output.push({ ...candidate, start: mapPoint(candidate.start), end: mapPoint(candidate.end) });
      }
    });
  });
  return output;
}

function appendVolume(target, project, rotation, box, colors, className, data = {}) {
  const left = box.left;
  const top = box.top;
  const right = left + box.width;
  const bottom = top + box.depth;
  const base = box.baseHeight ?? 0;
  const lift = base + box.height;
  const faces = {
    north: [[left, top, base], [right, top, base], [right, top, lift], [left, top, lift]],
    east: [[right, top, base], [right, bottom, base], [right, bottom, lift], [right, top, lift]],
    south: [[right, bottom, base], [left, bottom, base], [left, bottom, lift], [right, bottom, lift]],
    west: [[left, bottom, base], [left, top, base], [left, top, lift], [left, bottom, lift]],
  };
  VISIBLE_FACES[normalizedQuarterTurn(rotation)].forEach((face) => {
    target.append(polygon(`${className} ${className}-wall`, faces[face].map(([x, y, z]) => project(x, y, z)), {
      fill: colors[face],
      stroke: colors.outline,
      'stroke-width': 0.5,
      'stroke-linejoin': 'round',
      'vector-effect': 'non-scaling-stroke',
    }, { ...data, face }));
  });
  target.append(polygon(`${className} ${className}-roof`, [
    project(left, top, lift),
    project(right, top, lift),
    project(right, bottom, lift),
    project(left, bottom, lift),
  ], {
    fill: colors.roof,
    stroke: colors.outline,
    'stroke-width': 0.5,
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }, { ...data, surface: 'cap' }));
}

function appendCylinder(target, project, rotation, cylinder, colors, className, data = {}) {
  const facets = cylinder.facets ?? 10;
  const base = cylinder.baseHeight ?? 0;
  const top = base + cylinder.height;
  const ring = (index, z) => {
    const angle = (index / facets) * Math.PI * 2;
    return project(
      cylinder.x + Math.cos(angle) * cylinder.radiusX,
      cylinder.y + Math.sin(angle) * cylinder.radiusY,
      z,
    );
  };
  const normalizedRotation = normalizedQuarterTurn(rotation);
  const facetColors = [colors.south, colors.east, colors.north, colors.west];
  Array.from({ length: facets }, (_, index) => {
    const next = (index + 1) % facets;
    const angle = ((index + 0.5) / facets) * Math.PI * 2;
    const faceIndex = normalizedQuarterTurn(Math.round(angle / (Math.PI / 2)) + normalizedRotation);
    const points = [ring(index, base), ring(next, base), ring(next, top), ring(index, top)];
    return { index, points, depth: points.reduce((sum, point) => sum + point.y, 0), fill: facetColors[faceIndex] };
  }).sort((left, right) => left.depth - right.depth || left.index - right.index).forEach((facet) => {
    target.append(polygon(`${className} ${className}-facet`, facet.points, {
      fill: facet.fill,
      stroke: 'none',
    }, { ...data, facet: facet.index + 1 }));
  });
  target.append(polygon(`${className} ${className}-cap`, Array.from({ length: facets }, (_, index) => ring(index, top)), {
    fill: colors.roof,
    stroke: 'none',
  }, { ...data, surface: 'cap' }));
}

function orientedUnitPoint(u, v, orientation) {
  switch (normalizedQuarterTurn(orientation)) {
    case 1: return [1 - v, u];
    case 2: return [1 - u, 1 - v];
    case 3: return [v, 1 - u];
    default: return [u, v];
  }
}

function roofPoint(bounds, u, v, orientation) {
  const [rotatedU, rotatedV] = orientedUnitPoint(u, v, orientation);
  return [
    bounds.left + rotatedU * bounds.width,
    bounds.top + rotatedV * bounds.depth,
  ];
}

function roofBox(bounds, left, top, width, depth, orientation) {
  const corners = [
    roofPoint(bounds, left, top, orientation),
    roofPoint(bounds, left + width, top, orientation),
    roofPoint(bounds, left + width, top + depth, orientation),
    roofPoint(bounds, left, top + depth, orientation),
  ];
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    depth: Math.max(...ys) - Math.min(...ys),
  };
}

function appendGable(target, project, bounds, base, lift, orientation, colors, data) {
  const alongX = normalizedQuarterTurn(orientation) % 2 === 0;
  if (alongX) {
    const ridgeY = bounds.top + bounds.depth / 2;
    const ridgeA = project(bounds.left, ridgeY, base + lift);
    const ridgeB = project(bounds.left + bounds.width, ridgeY, base + lift);
    target.append(polygon('market-building-roof-slope market-building-gable-slope', [
      project(bounds.left, bounds.top, base), project(bounds.left + bounds.width, bounds.top, base), ridgeB, ridgeA,
    ], { fill: colors.accent, stroke: 'none' }, { ...data, roofPart: 'slope-north' }));
    target.append(polygon('market-building-roof-slope market-building-gable-slope', [
      ridgeA, ridgeB, project(bounds.left + bounds.width, bounds.top + bounds.depth, base), project(bounds.left, bounds.top + bounds.depth, base),
    ], { fill: colors.roof, stroke: 'none' }, { ...data, roofPart: 'slope-south' }));
    target.append(line('market-building-roof-ridge', ridgeA, ridgeB, { stroke: colors.outline, 'stroke-width': 0.7 }, data));
  } else {
    const ridgeX = bounds.left + bounds.width / 2;
    const ridgeA = project(ridgeX, bounds.top, base + lift);
    const ridgeB = project(ridgeX, bounds.top + bounds.depth, base + lift);
    target.append(polygon('market-building-roof-slope market-building-gable-slope', [
      project(bounds.left, bounds.top, base), ridgeA, ridgeB, project(bounds.left, bounds.top + bounds.depth, base),
    ], { fill: colors.accent, stroke: 'none' }, { ...data, roofPart: 'slope-west' }));
    target.append(polygon('market-building-roof-slope market-building-gable-slope', [
      ridgeA, project(bounds.left + bounds.width, bounds.top, base), project(bounds.left + bounds.width, bounds.top + bounds.depth, base), ridgeB,
    ], { fill: colors.roof, stroke: 'none' }, { ...data, roofPart: 'slope-east' }));
    target.append(line('market-building-roof-ridge', ridgeA, ridgeB, { stroke: colors.outline, 'stroke-width': 0.7 }, data));
  }
}

function appendPyramid(target, project, bounds, base, lift, colors, data) {
  const corners = [
    [bounds.left, bounds.top],
    [bounds.left + bounds.width, bounds.top],
    [bounds.left + bounds.width, bounds.top + bounds.depth],
    [bounds.left, bounds.top + bounds.depth],
  ];
  const apex = project(bounds.left + bounds.width / 2, bounds.top + bounds.depth / 2, base + lift);
  corners.forEach((corner, index) => {
    const next = corners[(index + 1) % corners.length];
    target.append(polygon('market-building-roof-slope market-building-pyramid-slope', [
      project(corner[0], corner[1], base), project(next[0], next[1], base), apex,
    ], { fill: index % 2 ? colors.roof : colors.accent, stroke: 'none' }, { ...data, roofPart: `slope-${index + 1}` }));
  });
}

function appendWedge(target, project, bounds, base, lift, orientation, colors, data) {
  const topCorners = [
    roofPoint(bounds, 0, 0, orientation),
    roofPoint(bounds, 1, 0, orientation),
    roofPoint(bounds, 1, 1, orientation),
    roofPoint(bounds, 0, 1, orientation),
  ];
  target.append(polygon('market-building-roof-slope market-building-wedge-slope', topCorners.map(([x, y], index) => (
    project(x, y, base + (index < 2 ? lift : 0))
  )), { fill: colors.accent, stroke: 'none' }, { ...data, roofPart: 'slope' }));
  target.append(polygon('market-building-wedge-riser', [
    project(topCorners[0][0], topCorners[0][1], base),
    project(topCorners[1][0], topCorners[1][1], base),
    project(topCorners[1][0], topCorners[1][1], base + lift),
    project(topCorners[0][0], topCorners[0][1], base + lift),
  ], { fill: colors.south, stroke: 'none' }, { ...data, roofPart: 'riser' }));
}

function appendParapet(target, project, rotation, bounds, base, lift, colors, data) {
  const thickness = 0.055;
  [
    { left: 0, top: 0, width: 1, depth: thickness },
    { left: 0, top: 1 - thickness, width: 1, depth: thickness },
    { left: 0, top: thickness, width: thickness, depth: 1 - thickness * 2 },
    { left: 1 - thickness, top: thickness, width: thickness, depth: 1 - thickness * 2 },
  ].forEach((part, index) => {
    const box = roofBox(bounds, part.left, part.top, part.width, part.depth, 0);
    appendVolume(target, project, rotation, { ...box, baseHeight: base, height: lift }, colors, 'market-building-parapet-wall', { ...data, roofPart: `parapet-${index + 1}` });
  });
}

function appendRoof(target, { lot, footprint, project, rotation, roofBase, colors }) {
  const roof = lot.roof;
  const orientation = normalizedQuarterTurn(lot.roofOrientation);
  const roofLift = Math.max(0.16, (Number(lot.roofHeight) || 1) * 0.34);
  const bounds = { left: 0.13, top: 0.13, width: footprint.width - 0.26, depth: footprint.depth - 0.26 };
  const roofData = { roofKind: roof, roofOrientation: orientation };
  const semantic = group(`market-building-roof market-building-roof-${roof}`, roofData);

  const boundaryMap = worldPointMap(footprint, 0.09);
  semantic.append(polygon('market-building-roof-surface', footprint.boundary.map(boundaryMap).map(([x, y]) => project(x, y, roofBase)), {
    fill: colors.roof,
    stroke: colors.outline,
    'stroke-width': 0.55,
    'stroke-linejoin': 'round',
    'vector-effect': 'non-scaling-stroke',
  }, { ...roofData, surface: 'roof' }));

  switch (roof) {
    case 'gable':
      appendGable(semantic, project, bounds, roofBase + 0.01, roofLift, orientation, colors, roofData);
      break;
    case 'pyramid':
      appendPyramid(semantic, project, bounds, roofBase + 0.01, roofLift, colors, roofData);
      break;
    case 'wedge':
      appendWedge(semantic, project, bounds, roofBase + 0.01, roofLift, orientation, colors, roofData);
      break;
    case 'mech': {
      // Deliberately off-centre: the source vocabulary assigns four valid
      // orientations, so a centred box would collapse 0/2 and 1/3 visually.
      const box = roofBox(bounds, 0.17, 0.22, 0.50, 0.36, orientation);
      appendVolume(semantic, project, rotation, { ...box, baseHeight: roofBase, height: roofLift * 0.72 }, colors, 'market-building-mechanical', { ...roofData, roofPart: 'mechanical-penthouse' });
      break;
    }
    case 'core': {
      const box = roofBox(bounds, 0.34, 0.20, 0.32, 0.60, orientation);
      appendVolume(semantic, project, rotation, { ...box, baseHeight: roofBase, height: roofLift }, colors, 'market-building-core', { ...roofData, roofPart: 'lift-core' });
      break;
    }
    case 'steps':
      [
        { left: 0.10, top: 0.13, width: 0.76, depth: 0.68, lift: roofLift * 0.42 },
        { left: 0.14, top: 0.18, width: 0.56, depth: 0.50, lift: roofLift * 0.78 },
        { left: 0.18, top: 0.22, width: 0.32, depth: 0.30, lift: roofLift },
      ].forEach((step, index) => {
        const box = roofBox(bounds, step.left, step.top, step.width, step.depth, orientation);
        appendVolume(semantic, project, rotation, { ...box, baseHeight: roofBase, height: step.lift }, colors, 'market-building-roof-step', { ...roofData, roofPart: `step-${index + 1}` });
      });
      break;
    case 'parapet':
      appendParapet(semantic, project, rotation, bounds, roofBase, roofLift * 0.24, colors, roofData);
      break;
    case 'sawtooth': {
      const teeth = Math.max(2, Math.round((orientation % 2 === 0 ? bounds.depth : bounds.width) * 2));
      for (let index = 0; index < teeth; index += 1) {
        if (orientation % 2 === 0) {
          const stripDepth = bounds.depth / teeth;
          const strip = { ...bounds, top: bounds.top + stripDepth * index, depth: stripDepth * 0.84 };
          appendWedge(semantic, project, strip, roofBase + 0.01, roofLift * 0.65, orientation, colors, { ...roofData, roofPart: `tooth-${index + 1}` });
        } else {
          const stripWidth = bounds.width / teeth;
          const strip = { ...bounds, left: bounds.left + stripWidth * index, width: stripWidth * 0.84 };
          appendWedge(semantic, project, strip, roofBase + 0.01, roofLift * 0.65, orientation, colors, { ...roofData, roofPart: `tooth-${index + 1}` });
        }
      }
      break;
    }
    case 'cylinder':
      appendCylinder(semantic, project, rotation, {
        x: bounds.left + bounds.width / 2,
        y: bounds.top + bounds.depth / 2,
        radiusX: bounds.width * 0.28,
        radiusY: bounds.depth * 0.28,
        baseHeight: roofBase,
        height: roofLift * 0.72,
      }, colors, 'market-building-roof-cylinder', { ...roofData, roofPart: 'tank' });
      break;
    case 'vents':
      [[0.32, 0.34], [0.68, 0.34], [0.32, 0.66], [0.68, 0.66]].forEach(([u, v], index) => {
        const [x, y] = roofPoint(bounds, u, v, orientation);
        appendCylinder(semantic, project, rotation, {
          x, y,
          radiusX: Math.max(0.055, bounds.width * 0.055),
          radiusY: Math.max(0.055, bounds.depth * 0.055),
          baseHeight: roofBase,
          height: roofLift * (0.38 + (index % 2) * 0.10),
          facets: 8,
        }, colors, 'market-building-roof-vent', { ...roofData, roofPart: `vent-${index + 1}` });
      });
      break;
    case 'silos':
      [[0.35, 0.5], [0.65, 0.5]].forEach(([u, v], index) => {
        const [x, y] = roofPoint(bounds, u, v, orientation);
        appendCylinder(semantic, project, rotation, {
          x, y,
          radiusX: Math.max(0.11, bounds.width * 0.14),
          radiusY: Math.max(0.11, bounds.depth * 0.14),
          baseHeight: roofBase,
          height: roofLift * 0.92,
          facets: 12,
        }, colors, 'market-building-roof-silo', { ...roofData, roofPart: `silo-${index + 1}` });
      });
      break;
    case 'stack': {
      const [x, y] = roofPoint(bounds, 0.62, 0.42, orientation);
      appendCylinder(semantic, project, rotation, {
        x, y,
        radiusX: Math.max(0.075, bounds.width * 0.07),
        radiusY: Math.max(0.075, bounds.depth * 0.07),
        baseHeight: roofBase,
        height: roofLift * 1.75,
        facets: 12,
      }, { ...colors, roof: '#c9b99f' }, 'market-building-roof-stack', { ...roofData, roofPart: 'smokestack' });
      semantic.append(line('market-building-stack-band', project(x - bounds.width * 0.07, y, roofBase + roofLift * 1.22), project(x + bounds.width * 0.07, y, roofBase + roofLift * 1.22), {
        stroke: '#d9b56b', 'stroke-width': 1.25,
      }, { ...roofData, roofPart: 'stack-band' }));
      break;
    }
    case 'spire': {
      const core = roofBox(bounds, 0.36, 0.34, 0.28, 0.32, orientation);
      appendVolume(semantic, project, rotation, { ...core, baseHeight: roofBase, height: roofLift * 0.62 }, colors, 'market-building-spire-core', { ...roofData, roofPart: 'spire-core' });
      const apex = project(bounds.left + bounds.width / 2, bounds.top + bounds.depth / 2, roofBase + roofLift * 1.58);
      const corners = [
        [core.left, core.top],
        [core.left + core.width, core.top],
        [core.left + core.width, core.top + core.depth],
        [core.left, core.top + core.depth],
      ];
      corners.forEach((corner, index) => {
        const next = corners[(index + 1) % 4];
        semantic.append(polygon('market-building-spire-crown', [
          project(corner[0], corner[1], roofBase + roofLift * 0.62),
          project(next[0], next[1], roofBase + roofLift * 0.62),
          apex,
        ], { fill: index % 2 ? colors.roof : colors.accent, stroke: 'none' }, { ...roofData, roofPart: `spire-face-${index + 1}` }));
      });
      break;
    }
    case 'flat':
    default:
      semantic.append(line('market-building-flat-roof-seam', project(bounds.left, bounds.top, roofBase + 0.01), project(bounds.left + bounds.width, bounds.top + bounds.depth, roofBase + 0.01), {
        stroke: colors.outline, 'stroke-width': 0.42, opacity: 0.4,
      }, { ...roofData, roofPart: 'flat-seam' }));
      break;
  }
  target.append(semantic);
}

function facadeQuad(face, bounds, alongStart, alongEnd, low, high, project) {
  const epsilon = 0.003;
  if (face === 'north' || face === 'south') {
    const y = face === 'north' ? bounds.top - epsilon : bounds.top + bounds.depth + epsilon;
    const x0 = bounds.left + bounds.width * alongStart;
    const x1 = bounds.left + bounds.width * alongEnd;
    return [project(x0, y, low), project(x1, y, low), project(x1, y, high), project(x0, y, high)];
  }
  const x = face === 'west' ? bounds.left - epsilon : bounds.left + bounds.width + epsilon;
  const y0 = bounds.top + bounds.depth * alongStart;
  const y1 = bounds.top + bounds.depth * alongEnd;
  return [project(x, y0, low), project(x, y1, low), project(x, y1, high), project(x, y0, high)];
}

function facadeLine(face, bounds, along, low, high, project) {
  const points = facadeQuad(face, bounds, along, along, low, high, project);
  return [points[0], points[3]];
}

function appendFacadeDetails(target, { detail, height, footprint, bodyHeight, project, rotation, colors }) {
  if (!detail) return;
  const semantic = group(`market-building-detail market-building-detail-${detail}`, { detail });
  const bounds = { left: 0.09, top: 0.09, width: footprint.width - 0.18, depth: footprint.depth - 0.18 };
  const faces = VISIBLE_FACES[normalizedQuarterTurn(rotation)];
  const patch = (className, face, start, end, low, high, fill, data = {}) => semantic.append(polygon(
    className,
    facadeQuad(face, bounds, start, end, low, high, project),
    { fill, stroke: colors.outline, 'stroke-width': 0.38, 'vector-effect': 'non-scaling-stroke' },
    { detail, face, ...data },
  ));

  if (detail === 'door') {
    patch('market-building-door', faces[0], 0.39, 0.61, 0.02, Math.min(0.46, bodyHeight * 0.68), '#4d4035', { detailPart: 'door' });
  } else if (detail === 'bay') {
    const bayTop = Math.min(0.52, bodyHeight * 0.70);
    patch('market-building-loading-bay', faces[0], 0.20, 0.80, 0.03, bayTop, '#5a554c', { detailPart: 'loading-bay' });
    const [start, end] = facadeLine(faces[0], bounds, 0.20, 0.08, bayTop, project);
    semantic.append(line('market-building-loading-bay-frame', start, end, { stroke: '#e5b767', 'stroke-width': 0.8 }, { detail, face: faces[0], detailPart: 'bay-frame' }));
    // Everything above the bay used to be blank wall at EVERY height, so a nine
    // storey works read as one amber slab with a door on it. Banded clerestory
    // glazing is the industrial answer to the residential window grid: it scales
    // with the storey count and gives the silhouette something to read against.
    const bands = Math.max(0, Math.min(9, Math.trunc(height) - 1));
    const shaft = bodyHeight - bayTop;
    for (let band = 0; band < bands && shaft > 0.12; band += 1) {
      const low = bayTop + shaft * ((band + 0.26) / bands);
      const high = Math.min(bodyHeight - 0.05, low + shaft * 0.36 / bands);
      if (high <= low) continue;
      faces.forEach((face) => {
        patch('market-building-strip-window', face, 0.14, 0.86, low, high, '#cfe0e6', {
          detailPart: 'strip-window',
          band: band + 1,
        });
      });
    }
  } else if (detail === 'windows') {
    const rows = Math.max(1, Math.min(10, Math.trunc(height)));
    faces.forEach((face) => {
      const columns = (face === 'north' || face === 'south' ? footprint.width : footprint.depth) > 1 ? 4 : 2;
      for (let row = 0; row < rows; row += 1) {
        const low = bodyHeight * ((row + 0.30) / rows);
        const high = Math.min(bodyHeight - 0.05, low + bodyHeight * 0.28 / rows);
        for (let column = 0; column < columns; column += 1) {
          const start = (column + 0.18) / columns;
          const end = (column + 0.74) / columns;
          patch('market-building-window', face, start, end, low, high, '#d9edf1', { detailPart: 'window', row: row + 1, column: column + 1 });
        }
      }
    });
  } else if (detail === 'curtain') {
    faces.forEach((face) => {
      patch('market-building-curtain', face, 0.07, 0.93, 0.10, bodyHeight - 0.08, '#8dc8d8', { detailPart: 'curtain-wall' });
      [0.28, 0.50, 0.72].forEach((along, index) => {
        const [start, end] = facadeLine(face, bounds, along, 0.10, bodyHeight - 0.08, project);
        semantic.append(line('market-building-curtain-mullion', start, end, { stroke: '#e5f5f4', 'stroke-width': 0.48, opacity: 0.78 }, { detail, face, detailPart: 'mullion', mullion: index + 1 }));
      });
      const rows = Math.max(2, Math.min(8, Math.trunc(height)));
      for (let row = 1; row < rows; row += 1) {
        const z = 0.10 + (bodyHeight - 0.18) * row / rows;
        const quad = facadeQuad(face, bounds, 0.07, 0.93, z, z, project);
        semantic.append(line('market-building-curtain-floor', quad[0], quad[1], { stroke: '#45778c', 'stroke-width': 0.42, opacity: 0.75 }, { detail, face, detailPart: 'floor-line', row }));
      }
    });
  }
  target.append(semantic);
}

function appendChar(target, { lot, footprint, project, roofBase }) {
  const char = clamp(Number(lot.char) || 0);
  if (char <= 0) return;
  const semantic = group('market-building-char', { char });
  const boundaryMap = worldPointMap(footprint, 0.088);
  semantic.append(polygon('market-building-char-surface', footprint.boundary.map(boundaryMap).map(([x, y]) => project(x, y, roofBase + 0.008)), {
    fill: '#17191a',
    opacity: (0.16 + char * 0.62).toFixed(3),
    stroke: 'none',
  }, { char, surface: 'char' }));
  target.append(semantic);
}

const FLAME_HOT = [255, 226, 130];
const FLAME_MID = [247, 158, 46];
const FLAME_LOW = [206, 78, 32];
const SMOKE_ROOT = [24, 22, 24];
const SMOKE_MIDDLE = [112, 112, 120];
const SMOKE_TOP = [188, 190, 198];
const FIRE_WIND = 0.30;
const FIRE_PUFFS_PER_LEVEL = 3;

function interpolateColor(left, right, amount) {
  return left.map((channel, index) => channel + ((right[index] ?? channel) - channel) * clamp(amount));
}

function appendFlameTongue(target, base, width, height, color, data = {}) {
  target.append(polygon('market-building-flame market-building-flame-tongue', [
    { x: base.x - width, y: base.y + width * 0.30 },
    { x: base.x + width, y: base.y + width * 0.30 },
    { x: base.x + width * 0.30, y: base.y - height * 0.55 },
    { x: base.x + width * 0.35, y: base.y - height },
    { x: base.x - width * 0.45, y: base.y - height * 0.45 },
  ], { fill: rgb(color), stroke: 'none' }, data));
}

function appendFireFlames(target, { lot, footprint, project, roofBase, size, rotation, phase = 0 }) {
  const intensity = Math.max(0, Number(lot.fireIntensity) || 0);
  if (intensity < 0.30) return;
  const semantic = group('market-building-fire market-building-fire-flames', {
    fireIntensity: intensity,
    fireStage: intensity < 0.70 ? 'climbing' : 'fully-involved',
  });
  const halfWidth = Math.max(2, size * Math.max(1, Math.min(2, footprint.width + footprint.depth)) * 0.21);
  const storeyHeight = size * 0.28;
  const reach = clamp((intensity - 0.30) / 0.55);
  const litStoreys = Math.round(Math.max(1, Number(lot.height) || 1) * reach);
  const visibleFaces = new Set(VISIBLE_FACES[normalizedQuarterTurn(rotation)]);
  const boundaryMap = worldPointMap(footprint, 0.09);
  outerEdges(footprint, boundaryMap).forEach((edge) => {
    if (!visibleFaces.has(edge.face)) return;
    for (let storey = 0; storey < litStoreys; storey += 1) {
      for (const [positionIndex, along] of [0.34, 0.70].entries()) {
        const x = edge.start[0] + (edge.end[0] - edge.start[0]) * along;
        const y = edge.start[1] + (edge.end[1] - edge.start[1]) * along;
        const z = Math.max(0.04, roofBase - (storey + 0.55) * (roofBase / Math.max(1, Number(lot.height) || 1)));
        appendFlameTongue(
          semantic,
          project(x, y, z),
          halfWidth * 0.085,
          storeyHeight * (0.42 + 0.18 * reach),
          (storey + positionIndex) % 2 ? FLAME_MID : FLAME_LOW,
          { wallFlame: storey + 1, face: edge.face },
        );
      }
    }
  });

  const center = project(footprint.width * 0.5, footprint.depth * 0.5, roofBase + 0.04);
  if (intensity < 0.70) {
    const progress = (intensity - 0.30) / 0.40;
    [
      [-0.34, 0.15, 0.8 + 0.5 * progress, FLAME_LOW],
      [0.30, 0.13, 0.7 + 0.6 * progress, FLAME_MID],
      [-0.02, 0.17, 1.1 + 0.7 * progress, FLAME_MID],
    ].forEach(([offset, width, height, color], index) => appendFlameTongue(
      semantic,
      { x: center.x + halfWidth * offset, y: center.y },
      halfWidth * width,
      storeyHeight * height,
      color,
      { roofFlame: index + 1, layout: 'climbing' },
    ));
  } else {
    const progress = (intensity - 0.70) / 0.30;
    const layouts = [
      [[-0.46, 0.15, 1.2, FLAME_LOW], [0.44, 0.14, 1.4, FLAME_LOW], [-0.20, 0.19, 1.9, FLAME_MID], [0.18, 0.18, 1.8, FLAME_MID], [-0.01, 0.15, 2.4, FLAME_HOT]],
      [[-0.42, 0.14, 1.5, FLAME_LOW], [0.47, 0.16, 1.1, FLAME_LOW], [-0.14, 0.18, 1.7, FLAME_MID], [0.24, 0.20, 2.0, FLAME_MID], [0.04, 0.16, 2.6, FLAME_HOT]],
      [[-0.49, 0.16, 1.3, FLAME_LOW], [0.40, 0.13, 1.6, FLAME_LOW], [-0.24, 0.20, 2.1, FLAME_MID], [0.13, 0.17, 1.6, FLAME_MID], [-0.06, 0.14, 2.3, FLAME_HOT]],
    ];
    layouts.forEach((layout, layoutIndex) => {
      const layoutGroup = group('market-building-fire-flame-layout', { marketFireLayout: layoutIndex });
      layout.forEach(([offset, width, height, color], index) => appendFlameTongue(
        layoutGroup,
        { x: center.x + halfWidth * offset, y: center.y },
        halfWidth * width,
        storeyHeight * (height + 0.8 * progress),
        color,
        { roofFlame: index + 1, layout: layoutIndex + 1 },
      ));
      semantic.append(layoutGroup);
    });
  }
  target.append(semantic);
  setMarketFireVisualPhase(semantic, phase);
}

/** Apply the frozen visual-only phase without reading or mutating city state. */
export function setMarketFireVisualPhase(root, phase) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const visualPhase = Number.isFinite(phase) ? phase : 0;
  const layoutIndex = ((Math.trunc(visualPhase * 3) % 3) + 3) % 3;
  root.querySelectorAll('[data-market-fire-layout]').forEach((layout) => {
    layout.style.display = Number(layout.dataset.marketFireLayout) === layoutIndex ? '' : 'none';
  });
  root.querySelectorAll('[data-smoke-angle-base]').forEach((puff) => {
    const angle = Number(puff.dataset.smokeAngleBase) + visualPhase * Math.PI * 2;
    const centerX = Number(puff.dataset.smokeCenterX);
    const centerY = Number(puff.dataset.smokeCenterY);
    const spread = Number(puff.dataset.smokeSpread);
    const radius = spread * (0.52 + 0.30 * (0.5 + 0.5 * Math.sin(angle * 2.3)));
    attributes(puff, {
      cx: (centerX + Math.sin(angle) * spread * 0.46).toFixed(2),
      cy: (centerY + Math.cos(angle * 1.7) * spread * 0.30).toFixed(2),
      rx: radius.toFixed(2),
      ry: (radius * 0.74).toFixed(2),
    });
  });
}

/**
 * Render one derived market lot into an SVG group.
 *
 * `project(x, y, lift)` owns camera/world projection. `size` is the projected
 * tile scale used only for legible fire effects and non-scaling details.
 */
export function createMarketBuildingWorldGeometry({
  lot,
  size = 24,
  project,
  rotation = 0,
  phase = 0,
  data = {},
}) {
  if (!lot || typeof lot !== 'object') throw new TypeError('A MarketRenderLot is required.');
  if (typeof project !== 'function') throw new TypeError('A world projection function is required.');

  const footprint = footprintGeometry(lot.footprint);
  const height = Math.max(1, Number(lot.height) || 1);
  const bodyHeight = Math.max(0.58, height * 0.56);
  const safeSize = Math.max(1, Number(size) || 24);
  const colors = palette(lot.color ?? [128, 128, 128], lot.char);
  const root = group(`market-building-world market-zone-${lot.zone} market-footprint-${lot.footprint}`);
  appendData(root, data);
  appendData(root, {
    worldRenderer: 'market-rci-v1',
    renderContract: 'market-rci-svg-v1',
    marketLotId: lot.id,
    incidentId: lot.incidentId,
    tileIds: (lot.tileIds ?? []).join(','),
    zone: lot.zone,
    height,
    footprint: lot.footprint,
    roofKind: lot.roof,
    roofOrientation: normalizedQuarterTurn(lot.roofOrientation),
    detail: lot.detail ?? 'none',
    landmark: Boolean(lot.landmark),
    fireIntensity: Math.max(0, Number(lot.fireIntensity) || 0),
    char: clamp(Number(lot.char) || 0),
    plume: clamp(Number(lot.plume) || 0),
  });
  attributes(root, {
    role: 'img',
    'aria-label': `${lot.zone} building, ${height} storeys, ${lot.footprint} footprint, ${lot.roof} roof${Number(lot.fireIntensity) > 0 ? `, burning at intensity ${Number(lot.fireIntensity).toFixed(2)}` : ''}`,
    style: `--market-building-color: ${rgb(lot.color ?? [128, 128, 128])}; --market-building-height: ${height};`,
  });

  const mapPoint = worldPointMap(footprint, 0.09);
  const lotLayer = group('market-building-lot', { footprint: lot.footprint });
  footprint.cells.forEach(([x, y], index) => {
    lotLayer.append(polygon('market-building-footprint-cell', [
      project(x, y, 0.018), project(x + 1, y, 0.018),
      project(x + 1, y + 1, 0.018), project(x, y + 1, 0.018),
    ], { fill: 'transparent', stroke: 'none', 'pointer-events': 'none' }, {
      footprintCell: index + 1,
      footprintCellX: x,
      footprintCellY: y,
    }));
  });
  root.append(lotLayer);

  const body = group('market-building-body', { zone: lot.zone });
  const visibleFaces = new Set(VISIBLE_FACES[normalizedQuarterTurn(rotation)]);
  outerEdges(footprint, mapPoint).forEach((edge, index) => {
    if (!visibleFaces.has(edge.face)) return;
    body.append(polygon('market-building-wall', [
      project(edge.start[0], edge.start[1], 0.035),
      project(edge.end[0], edge.end[1], 0.035),
      project(edge.end[0], edge.end[1], bodyHeight),
      project(edge.start[0], edge.start[1], bodyHeight),
    ], { fill: colors[edge.face], stroke: 'none' }, {
      surface: 'wall',
      face: edge.face,
      wallSegment: index + 1,
    }));
  });
  root.append(body);

  appendFacadeDetails(root, {
    detail: lot.detail,
    height,
    footprint,
    bodyHeight,
    project,
    rotation,
    colors,
  });
  appendRoof(root, {
    lot,
    footprint,
    project,
    rotation,
    roofBase: bodyHeight,
    colors,
  });
  appendChar(root, { lot, footprint, project, roofBase: bodyHeight });
  appendFireFlames(root, { lot, footprint, project, roofBase: bodyHeight, size: safeSize, rotation, phase });
  return root;
}

function pointKey(point) {
  return `${Number(point.x).toFixed(2)},${Number(point.y).toFixed(2)}`;
}

function localPointsForElement(element, localPointByScreenPoint) {
  const collected = [];
  const add = (x, y) => {
    const local = localPointByScreenPoint.get(`${Number(x).toFixed(2)},${Number(y).toFixed(2)}`);
    if (local) collected.push(local);
  };
  const visit = (node) => {
    const localAnchor = {
      x: Number(node.dataset?.worldAnchorX),
      y: Number(node.dataset?.worldAnchorY),
      elevation: Number(node.dataset?.worldAnchorElevation),
    };
    if (Number.isFinite(localAnchor.x) && Number.isFinite(localAnchor.y) && Number.isFinite(localAnchor.elevation)) {
      collected.push(localAnchor);
      return;
    }
    if (node.tagName === 'polygon') {
      const values = (node.getAttribute('points') || '').trim().split(/[\s,]+/).map(Number);
      for (let index = 0; index + 1 < values.length; index += 2) add(values[index], values[index + 1]);
    } else if (node.tagName === 'line') {
      add(node.getAttribute('x1'), node.getAttribute('y1'));
      add(node.getAttribute('x2'), node.getAttribute('y2'));
    } else if (node.tagName === 'circle' || node.tagName === 'ellipse') {
      add(node.getAttribute('cx'), node.getAttribute('cy'));
    }
    [...node.children].forEach(visit);
  };
  visit(element);
  return collected;
}

function localAnchorForElement(element, localPointByScreenPoint, fallback) {
  const points = localPointsForElement(element, localPointByScreenPoint);
  if (!points.length) return fallback;
  return {
    x: points.reduce((total, point) => total + point.x, 0) / points.length,
    y: points.reduce((total, point) => total + point.y, 0) / points.length,
    elevation: points.reduce((total, point) => total + point.elevation, 0) / points.length,
  };
}

function marketWorldPartKind(element) {
  const className = element.getAttribute('class') || '';
  if (className.includes('market-building-lot')) return 'lot';
  if (className.includes('market-building-body') || className.includes('market-building-wall')) return 'wall';
  if (className.includes('market-building-detail') || className.includes('market-building-window') || className.includes('market-building-door')) return 'detail';
  if (className.includes('market-building-roof') || className.includes('market-building-parapet') || className.includes('market-building-spire')) return 'roof';
  if (className.includes('market-building-char')) return 'char';
  if (className.includes('market-building-fire')) return 'fire';
  return 'detail';
}

function marketWorldPartSublayer(kind) {
  return ({ lot: 1, wall: 2, detail: 3, roof: 4, char: 5, fire: 6 })[kind] ?? 3;
}

/**
 * Build the same RCI SVG as createMarketBuildingWorldGeometry, but expose its
 * opaque visual primitives as independently depth-addressable paint items.
 * The live city uses this path so a roof facet may paint behind a nearer wall
 * without taking the rest of its building with it.
 */
export function createMarketBuildingWorldParts(options) {
  if (!options || typeof options.project !== 'function') throw new TypeError('A world projection function is required.');
  const localPointByScreenPoint = new Map();
  const sourceProject = options.project;
  const trackingProject = (x, y, elevation = 0) => {
    const point = sourceProject(x, y, elevation);
    localPointByScreenPoint.set(pointKey(point), { x, y, elevation });
    return { ...point, __marketLocal: { x, y, elevation } };
  };
  const root = createMarketBuildingWorldGeometry({ ...options, project: trackingProject });
  const rootData = { ...root.dataset };
  const rootClassName = root.getAttribute('class') || 'market-building-world';
  const rootStyle = root.getAttribute('style');
  const rootRole = root.getAttribute('role');
  const rootLabel = root.getAttribute('aria-label');
  const footprint = footprintGeometry(options.lot?.footprint);
  const bodyHeight = Math.max(0.58, Math.max(1, Number(options.lot?.height) || 1) * 0.56);
  const fallback = { x: footprint.width / 2, y: footprint.depth / 2, elevation: bodyHeight / 2 };
  const parts = [];
  let partIndex = 0;

  const appendPart = (source, sourceKind, inheritedData = {}) => {
    const kind = sourceKind || marketWorldPartKind(source);
    const part = group(`${rootClassName} market-building-world-part market-building-world-part-${kind}`);
    appendData(part, rootData);
    appendData(part, inheritedData);
    appendData(part, source.dataset);
    appendData(part, {
      worldPart: `${kind}-${partIndex + 1}`,
      worldPartKind: kind,
      worldFace: source.dataset.face,
    });
    // Every fragment keeps the interaction identity, but only the lot slab
    // is announced as the semantic building to assistive technology.
    attributes(part, kind === 'lot'
      ? { role: rootRole, 'aria-label': rootLabel, style: rootStyle }
      : { 'aria-hidden': 'true', style: rootStyle });
    // Preserve semantic data on the primitive too.  This keeps selectors such
    // as `[data-incident-id] [data-fire-stage]` and event delegation working
    // after a semantic SVG group is split across painter items.
    appendData(source, inheritedData);
    part.append(source);
    const anchor = localAnchorForElement(source, localPointByScreenPoint, fallback);
    partIndex += 1;
    parts.push({
      id: `${kind}-${partIndex}`,
      kind,
      sublayer: marketWorldPartSublayer(kind),
      anchor,
      element: part,
    });
  };

  [...root.children].forEach((semantic) => {
    const semanticKind = marketWorldPartKind(semantic);
    if (semanticKind === 'lot' || semanticKind === 'char') {
      appendPart(semantic, semanticKind);
      return;
    }
    const children = [...semantic.children];
    if (!children.length) {
      appendPart(semantic, semanticKind);
      return;
    }
    children.forEach((child) => appendPart(child, semanticKind, semantic.dataset));
  });
  return parts;
}

/** Smoke is emitted separately so no nearer structure can overpaint it. */
export function createMarketFireSmokeGeometry({ lot, size = 24, project, phase, data = {} }) {
  if (!lot || typeof lot !== 'object') throw new TypeError('A burning MarketRenderLot is required.');
  if (typeof project !== 'function') throw new TypeError('A world projection function is required.');
  const intensity = Math.max(0, Number(lot.fireIntensity) || 0);
  if (intensity <= 0) return group('market-fire-smoke-empty');
  const footprint = footprintGeometry(lot.footprint);
  const safeSize = Math.max(1, Number(size) || 24);
  const plume = clamp(Number(lot.plume) || Math.min(1, intensity));
  const visualPhase = Number.isFinite(phase) ? phase : (Number(lot.fireAge) || 0) * 0.37;
  const roofBase = Math.max(1, Number(lot.height) || 1) * 0.56;
  const center = project(footprint.width * 0.5, footprint.depth * 0.5, roofBase + 0.24);
  const width = Math.max(2, safeSize * Math.max(1, footprint.width + footprint.depth) * 0.20);
  const levelHeight = safeSize * 0.50;
  const levels = Math.max(6, Math.trunc(12 + 40 * plume));
  const root = group('market-building-smoke market-building-fire-motion', {
    incidentId: lot.incidentId,
    plume,
    smokeLevels: levels,
    puffsPerLevel: FIRE_PUFFS_PER_LEVEL,
  });
  appendData(root, data);
  attributes(root, { role: 'img', 'aria-label': `Smoke plume above burning ${lot.zone} building` });
  for (let level = 0; level < levels; level += 1) {
    const progress = (level + 1) / levels;
    const rise = levelHeight * (2 + 19 * plume) * progress;
    const spread = width * (0.13 + 1.05 * progress ** 1.25) * (0.55 + 0.85 * plume);
    const centerX = center.x + FIRE_WIND * rise * progress ** 1.35;
    const centerY = center.y - rise;
    const colorProgress = progress ** 1.7;
    const color = colorProgress < 0.55
      ? interpolateColor(SMOKE_ROOT, SMOKE_MIDDLE, colorProgress / 0.55)
      : interpolateColor(SMOKE_MIDDLE, SMOKE_TOP, (colorProgress - 0.55) / 0.45);
    for (let puff = 0; puff < FIRE_PUFFS_PER_LEVEL; puff += 1) {
      const angle = level * 2.399 + puff * 2.094 + visualPhase * Math.PI * 2;
      const jitterX = Math.sin(angle) * spread * 0.46;
      const jitterY = Math.cos(angle * 1.7) * spread * 0.30;
      const radius = spread * (0.52 + 0.30 * (0.5 + 0.5 * Math.sin(angle * 2.3)));
      const puffElement = ellipse('market-building-smoke-puff', {
        x: centerX + jitterX,
        y: centerY + jitterY,
      }, radius, radius * 0.74, {
        fill: rgb(color),
        opacity: (0.86 - progress * 0.08).toFixed(3),
        stroke: 'none',
      }, {
        smokeLevel: level + 1,
        smokePuff: puff + 1,
        smokeAngleBase: level * 2.399 + puff * 2.094,
        smokeCenterX: centerX,
        smokeCenterY: centerY,
        smokeSpread: spread,
      });
      root.append(puffElement);
    }
  }
  setMarketFireVisualPhase(root, visualPhase);
  return root;
}

export function createMarketRubbleWorldGeometry({ rubble, project, rotation = 0, data = {} }) {
  if (!rubble || typeof rubble !== 'object') throw new TypeError('A MarketRenderRubble is required.');
  if (typeof project !== 'function') throw new TypeError('A world projection function is required.');
  const footprint = footprintGeometry(rubble.structure.footprint);
  const mapPoint = worldPointMap(footprint, 0.08);
  const root = group(`market-building-rubble market-footprint-${rubble.structure.footprint}`, {
    incidentId: rubble.incidentId,
    rubbleMonthsRemaining: rubble.rubbleMonthsRemaining,
  });
  appendData(root, data);
  attributes(root, {
    role: 'img',
    'aria-label': `Charred ${rubble.structure.footprint} rubble, ${rubble.rubbleMonthsRemaining} months remaining`,
  });
  root.append(polygon('market-rubble-slab', footprint.boundary.map(mapPoint).map(([x, y]) => project(x, y, 0.025)), {
    fill: '#2e2a28', stroke: '#151414', 'stroke-width': 0.75, 'vector-effect': 'non-scaling-stroke',
  }));
  const seed = Number(rubble.structure.originTile) || 0;
  footprint.cells.forEach(([cellX, cellY], index) => {
    const fragmentHeight = 0.10 + ((seed + index * 17) % 5) * 0.045;
    const left = cellX + 0.18 + ((seed + index * 13) % 4) * 0.08;
    const top = cellY + 0.20 + ((seed + index * 7) % 3) * 0.09;
    appendVolume(root, project, rotation, {
      left, top, width: 0.22, depth: 0.18, baseHeight: 0.03, height: fragmentHeight,
    }, {
      roof: '#242120', north: '#35302d', east: '#1c1a19', south: '#302b29', west: '#211f1e',
      outline: '#111010', accent: '#443b36',
    }, 'market-rubble-debris', { debris: index + 1 });
    root.append(line('market-rubble-crack', project(cellX + 0.12, cellY + 0.24, 0.035), project(cellX + 0.72, cellY + 0.68, 0.037), {
      stroke: '#0d0d0d', 'stroke-width': 0.7,
    }, { crack: index + 1 }));
  });
  return root;
}
