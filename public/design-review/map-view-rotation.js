export const CITY_CELLS = 60;
export const CAMERA_HEADINGS = Object.freeze(['south', 'west', 'north', 'east']);

export function normalizeRotation(rotation) {
  return ((rotation % 4) + 4) % 4;
}

/** Rotates a canonical terrain cell into the active quarter-turn view. */
export function rotateCell({ x, y }, rotation, cells = CITY_CELLS) {
  switch (normalizeRotation(rotation)) {
    case 1: return { x: cells - 1 - y, y: x };
    case 2: return { x: cells - 1 - x, y: cells - 1 - y };
    case 3: return { x: y, y: cells - 1 - x };
    default: return { x, y };
  }
}

/** Restores a view-space terrain cell to its unchanged canonical location. */
export function viewToWorldCell({ x, y }, rotation, cells = CITY_CELLS) {
  return rotateCell({ x, y }, -rotation, cells);
}

/** Rotates a canonical shared terrain vertex.  Vertices have 61 positions per side. */
export function rotateVertex({ x, y }, rotation, cells = CITY_CELLS) {
  switch (normalizeRotation(rotation)) {
    case 1: return { x: cells - y, y: x };
    case 2: return { x: cells - x, y: cells - y };
    case 3: return { x: y, y: cells - x };
    default: return { x, y };
  }
}

/** Restores a view-space shared terrain vertex to its canonical grid point. */
export function viewToWorldVertex({ x, y }, rotation, cells = CITY_CELLS) {
  return rotateVertex({ x, y }, -rotation, cells);
}

/** CSS matrix coefficients for the existing 2:1 isometric projection after yaw. */
export function projectionForRotation(rotation) {
  switch (normalizeRotation(rotation)) {
    case 1: return { a: -1, b: .5, c: -1, d: -.5 };
    case 2: return { a: -1, b: -.5, c: 1, d: -.5 };
    case 3: return { a: 1, b: -.5, c: 1, d: .5 };
    default: return { a: 1, b: .5, c: -1, d: .5 };
  }
}

export function projectionCss(rotation) {
  const { a, b, c, d } = projectionForRotation(rotation);
  return `matrix(${a}, ${b}, ${c}, ${d}, 0, 0)`;
}

/**
 * Local-space compensation for a world-space vertical lift.
 *
 * The review page keeps its 2:1 isometric ground plane as a CSS matrix.  A
 * map turn changes that matrix, but it must never turn gravity with it.  This
 * returns the pre-projection local vector that becomes a straight upward
 * screen-space lift after the active quarter-turn matrix is applied.
 */
export function elevationOffsetForRotation(rotation, lift) {
  switch (normalizeRotation(rotation)) {
    case 1: return { x: -lift, y: lift };
    case 2: return { x: lift, y: lift };
    case 3: return { x: lift, y: -lift };
    default: return { x: -lift, y: -lift };
  }
}

/** Applies a projection matrix to a relative local vector for direct tests. */
export function projectLocalVector(vector, rotation) {
  const { a, b, c, d } = projectionForRotation(rotation);
  return {
    x: a * vector.x + c * vector.y,
    y: b * vector.x + d * vector.y
  };
}

/** Rotates a continuous world point around the square map centre. */
export function rotateWorldPoint({ x, y }, rotation, cells = CITY_CELLS) {
  switch (normalizeRotation(rotation)) {
    case 1: return { x: cells - y, y: x };
    case 2: return { x: cells - x, y: cells - y };
    case 3: return { x: y, y: cells - x };
    default: return { x, y };
  }
}

/**
 * Fixed 2:1 isometric projection of a canonical world point.
 *
 * `height` is expressed in visual terrain steps above the baseline. The
 * returned point is in cell-size units in a 2*cells by cells surface frame:
 * x spans the complete diamond and y is always screen-up for positive height.
 */
export function projectWorldPoint({ x, y, height = 0 }, rotation, cells = CITY_CELLS) {
  const view = rotateWorldPoint({ x, y }, rotation, cells);
  return {
    x: cells + view.x - view.y,
    y: (view.x + view.y) / 2 - height
  };
}

export function cameraHeadingForRotation(rotation) {
  return CAMERA_HEADINGS[normalizeRotation(rotation)];
}

/** Visible foundation faces, expressed as world borders under each yaw. */
export function nearWorldEdges(rotation) {
  switch (normalizeRotation(rotation)) {
    case 1: return { left: 'east', right: 'north' };
    case 2: return { left: 'north', right: 'west' };
    case 3: return { left: 'west', right: 'south' };
    default: return { left: 'south', right: 'east' };
  }
}
