/**
 * Review-page-only shared-corner terrain model.
 *
 * This deliberately has no dependency on the X-City simulation.  Its values
 * are screen-sandbox elevations, not world-unit measurements or persisted
 * game state.
 */
export const TERRAIN_CELLS = 60;
export const TERRAIN_VERTICES = TERRAIN_CELLS + 1;
export const DEFAULT_HEIGHT = 2;
export const MIN_HEIGHT = 0;
export const MAX_HEIGHT = 4;
export const TERRAIN_SCULPT_TARGETS = Object.freeze([
  'center', 'north', 'east', 'south', 'west', 'nw', 'ne', 'se', 'sw'
]);

/** @typedef {{ x: number, y: number }} TerrainCell */
/** @typedef {{ cells: number, baseline: number, heights: Int8Array }} LandscapeState */

function vertexIndex(x, y, cells = TERRAIN_CELLS) {
  return y * (cells + 1) + x;
}

function isIntegerCell(cell, cells) {
  return Number.isInteger(cell?.x) && Number.isInteger(cell?.y)
    && cell.x >= 0 && cell.y >= 0 && cell.x < cells && cell.y < cells;
}

function uniqueCells(cells, size) {
  const found = new Map();
  for (const cell of cells) {
    if (!isIntegerCell(cell, size)) return { accepted: false, reason: 'Landscape edits must stay inside the 60 by 60 map.' };
    found.set(`${cell.x},${cell.y}`, { x: cell.x, y: cell.y });
  }
  return { accepted: true, cells: [...found.values()] };
}

function copyState(state) {
  return { cells: state.cells, baseline: state.baseline, heights: new Int8Array(state.heights) };
}

export function createLandscapeState({ cells = TERRAIN_CELLS, baseline = DEFAULT_HEIGHT } = {}) {
  if (!Number.isInteger(cells) || cells < 1) throw new Error('Terrain cell count must be a positive integer.');
  if (!Number.isInteger(baseline) || baseline < MIN_HEIGHT || baseline > MAX_HEIGHT) throw new Error('Terrain baseline is outside the supported range.');
  return { cells, baseline, heights: new Int8Array((cells + 1) ** 2).fill(baseline) };
}

export function resetLandscapeState(state) {
  return createLandscapeState({ cells: state.cells, baseline: state.baseline });
}

export function heightAt(state, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x > state.cells || y > state.cells) return undefined;
  return state.heights[vertexIndex(x, y, state.cells)];
}

export function tileHeights(state, cell) {
  if (!isIntegerCell(cell, state.cells)) return undefined;
  return {
    nw: heightAt(state, cell.x, cell.y),
    ne: heightAt(state, cell.x + 1, cell.y),
    se: heightAt(state, cell.x + 1, cell.y + 1),
    sw: heightAt(state, cell.x, cell.y + 1)
  };
}

/**
 * Classifies a cell after edge safety has been checked.  A saddle is the one
 * alternating, diagonally-opposed high/low topology that this sandbox bans.
 */
export function classifyTile(state, cell) {
  const heights = tileHeights(state, cell);
  if (!heights) return { kind: 'invalid', reason: 'Tile is outside the landscape.' };
  const { nw, ne, se, sw } = heights;
  const edgeHeights = [Math.abs(nw - ne), Math.abs(ne - se), Math.abs(se - sw), Math.abs(sw - nw)];
  if (edgeHeights.some((difference) => difference > 1)) return { kind: 'invalid', reason: 'Terrain step is too steep.' };
  if (nw === se && ne === sw && nw !== ne) return { kind: 'invalid', reason: 'Terrain saddle is not allowed.' };
  if (nw === ne && ne === se && se === sw) return { kind: 'flat', height: nw, heights };
  if (nw === sw && ne === se) return { kind: 'ramp-x', axis: 'x', low: Math.min(nw, ne), high: Math.max(nw, ne), heights };
  if (nw === ne && sw === se) return { kind: 'ramp-y', axis: 'y', low: Math.min(nw, sw), high: Math.max(nw, sw), heights };
  return { kind: 'shoulder', heights };
}

export function validateLandscapeState(state) {
  const { cells, heights } = state;
  if (!(heights instanceof Int8Array) || heights.length !== (cells + 1) ** 2) return { accepted: false, reason: 'Landscape heightfield has an invalid shape.' };
  for (let y = 0; y <= cells; y += 1) {
    for (let x = 0; x <= cells; x += 1) {
      const height = heightAt(state, x, y);
      if (!Number.isInteger(height) || height < MIN_HEIGHT || height > MAX_HEIGHT) return { accepted: false, reason: 'Landscape height is outside the supported range.' };
      if (x < cells && Math.abs(height - heightAt(state, x + 1, y)) > 1) return { accepted: false, reason: 'Terrain step is too steep.' };
      if (y < cells && Math.abs(height - heightAt(state, x, y + 1)) > 1) return { accepted: false, reason: 'Terrain step is too steep.' };
    }
  }
  for (let y = 0; y < cells; y += 1) {
    for (let x = 0; x < cells; x += 1) {
      const classification = classifyTile(state, { x, y });
      if (classification.kind === 'invalid') return { accepted: false, reason: classification.reason, cell: { x, y } };
    }
  }
  return { accepted: true };
}

function cellCornerIndices(state, cells) {
  const indexes = new Set();
  for (const cell of cells) {
    indexes.add(vertexIndex(cell.x, cell.y, state.cells));
    indexes.add(vertexIndex(cell.x + 1, cell.y, state.cells));
    indexes.add(vertexIndex(cell.x + 1, cell.y + 1, state.cells));
    indexes.add(vertexIndex(cell.x, cell.y + 1, state.cells));
  }
  return indexes;
}

const TARGET_CORNERS = Object.freeze({
  center: ['nw', 'ne', 'se', 'sw'],
  north: ['nw', 'ne'],
  east: ['ne', 'se'],
  south: ['se', 'sw'],
  west: ['sw', 'nw'],
  nw: ['nw'],
  ne: ['ne'],
  se: ['se'],
  sw: ['sw']
});

function selectionCornerIndex(state, cell, corner) {
  const offset = {
    nw: [0, 0], ne: [1, 0], se: [1, 1], sw: [0, 1]
  }[corner];
  return vertexIndex(cell.x + offset[0], cell.y + offset[1], state.cells);
}

function uniqueSculptSelections(selections, size) {
  if (!Array.isArray(selections)) return { accepted: false, reason: 'Landscape sculpting needs one or more target selections.' };
  const found = new Map();
  for (const selection of selections) {
    const cell = selection?.cell;
    const target = selection?.target;
    if (!isIntegerCell(cell, size)) return { accepted: false, reason: 'Landscape edits must stay inside the 60 by 60 map.' };
    if (!Object.hasOwn(TARGET_CORNERS, target)) return { accepted: false, reason: 'Choose a terrain centre, edge, or corner target.' };
    found.set(`${cell.x},${cell.y},${target}`, { cell: { x: cell.x, y: cell.y }, target });
  }
  return { accepted: true, selections: [...found.values()] };
}

function resultFor(candidate, changedVertices) {
  const validation = validateLandscapeState(candidate);
  return validation.accepted
    ? { accepted: true, state: candidate, changedVertices: [...changedVertices] }
    : { accepted: false, reason: validation.reason, cell: validation.cell };
}

/** Applies a one-step raise/lower to the unique corners touched by the gesture. */
export function proposeTerrainDelta(state, cells, delta) {
  if (delta !== 1 && delta !== -1) return { accepted: false, reason: 'Landscape edits must raise or lower exactly one step.' };
  const normalized = uniqueCells(cells, state.cells);
  if (!normalized.accepted) return normalized;
  if (!normalized.cells.length) return { accepted: false, reason: 'Choose at least one landscape tile.' };
  const candidate = copyState(state);
  const changedVertices = cellCornerIndices(candidate, normalized.cells);
  for (const index of changedVertices) {
    const nextHeight = candidate.heights[index] + delta;
    if (nextHeight < MIN_HEIGHT || nextHeight > MAX_HEIGHT) return { accepted: false, reason: `Landscape height must remain between ${MIN_HEIGHT} and ${MAX_HEIGHT}.` };
    candidate.heights[index] = nextHeight;
  }
  return resultFor(candidate, changedVertices);
}

/**
 * Applies centre, edge, or corner terrain sculpting from one heightfield
 * snapshot. Centre edits terrace a slope toward its high/low side; edge and
 * corner edits change only their selected shared vertices by one step.
 */
export function proposeTerrainSculpt(state, selections, direction) {
  if (direction !== 1 && direction !== -1) return { accepted: false, reason: 'Landscape sculpting must raise or lower exactly one step.' };
  const normalized = uniqueSculptSelections(selections, state.cells);
  if (!normalized.accepted) return normalized;
  if (!normalized.selections.length) return { accepted: false, reason: 'Choose at least one landscape target.' };

  const requestedHeights = new Map();
  const requestHeight = (index, height) => {
    if (height < MIN_HEIGHT || height > MAX_HEIGHT) return false;
    const previous = requestedHeights.get(index);
    requestedHeights.set(index, previous == null
      ? height
      : direction === 1 ? Math.max(previous, height) : Math.min(previous, height));
    return true;
  };

  for (const { cell, target } of normalized.selections) {
    const heights = tileHeights(state, cell);
    const classification = classifyTile(state, cell);
    if (classification.kind === 'invalid') return { accepted: false, reason: classification.reason, cell };
    const corners = TARGET_CORNERS[target];
    const targetHeight = target === 'center'
      ? (classification.kind === 'flat'
        ? classification.height + direction
        : direction === 1 ? Math.max(...Object.values(heights)) : Math.min(...Object.values(heights)))
      : null;
    for (const corner of corners) {
      const nextHeight = targetHeight == null ? heights[corner] + direction : targetHeight;
      if (!requestHeight(selectionCornerIndex(state, cell, corner), nextHeight)) {
        return { accepted: false, reason: `Landscape height must remain between ${MIN_HEIGHT} and ${MAX_HEIGHT}.` };
      }
    }
  }

  const candidate = copyState(state);
  const changedVertices = [];
  for (const [index, height] of requestedHeights) {
    if (candidate.heights[index] !== height) changedVertices.push(index);
    candidate.heights[index] = height;
  }
  return resultFor(candidate, changedVertices);
}

/** Stamps a flat source elevation onto each selected cell's shared corners. */
export function proposeTerrainLevel(state, cells, level) {
  if (!Number.isInteger(level) || level < MIN_HEIGHT || level > MAX_HEIGHT) return { accepted: false, reason: 'Level source must be a valid terrain height.' };
  const normalized = uniqueCells(cells, state.cells);
  if (!normalized.accepted) return normalized;
  if (!normalized.cells.length) return { accepted: false, reason: 'Choose at least one landscape tile.' };
  const candidate = copyState(state);
  const changedVertices = cellCornerIndices(candidate, normalized.cells);
  for (const index of changedVertices) candidate.heights[index] = level;
  return resultFor(candidate, changedVertices);
}

function roadDirection(a, b) {
  if (!a || !b) return null;
  if (a.y === b.y && Math.abs(a.x - b.x) === 1) return 'x';
  if (a.x === b.x && Math.abs(a.y - b.y) === 1) return 'y';
  return null;
}

/**
 * Validates only the route's grade/topology.  Existing construction is page
 * policy and is checked by the review page before placement.
 */
export function validateRoadGrade(state, route) {
  const normalized = uniqueCells(route, state.cells);
  if (!normalized.accepted) return normalized;
  const cells = normalized.cells;
  if (!cells.length) return { accepted: false, reason: 'Draw a road route first.' };
  for (let index = 1; index < cells.length; index += 1) {
    if (!roadDirection(cells[index - 1], cells[index])) return { accepted: false, reason: 'Roads in this sandbox follow one map axis at a time.' };
  }
  for (let index = 0; index < cells.length; index += 1) {
    const classification = classifyTile(state, cells[index]);
    if (classification.kind === 'invalid') return { accepted: false, reason: classification.reason };
    const incoming = roadDirection(cells[index - 1], cells[index]);
    const outgoing = roadDirection(cells[index], cells[index + 1]);
    if (incoming && outgoing && incoming !== outgoing && classification.kind !== 'flat') {
      return { accepted: false, reason: 'Road turns and junctions require flat terrain.' };
    }
    if (classification.kind === 'ramp-x' || classification.kind === 'ramp-y') {
      const directions = [incoming, outgoing].filter(Boolean);
      if (!directions.length || directions.some((direction) => direction !== classification.axis)) {
        return { accepted: false, reason: 'Road ramp must run uphill or downhill along the slope.' };
      }
    } else if (classification.kind === 'shoulder') {
      return { accepted: false, reason: 'Roads require a flat tile or a one-step planar ramp.' };
    }
  }
  return { accepted: true, cells };
}

export function landscapeSnapshot(state) {
  return { cells: state.cells, baseline: state.baseline, heights: Array.from(state.heights) };
}
