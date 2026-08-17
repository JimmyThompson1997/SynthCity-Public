/**
 * Review-page network gesture model.
 *
 * This is deliberately about one pointer gesture only. It knows nothing about
 * the persisted city graph, so a route may still enter a cell occupied by an
 * already-committed road or utility.  The player supplies two endpoints; the
 * model then returns one straight cardinal segment or one clean, shortest
 * orthogonal L route. It never renders or commits an alternate route.
 */

function isCell(value) {
  return Number.isInteger(value?.x) && Number.isInteger(value?.y);
}

function cellKey(cell) {
  return `${cell.x},${cell.y}`;
}

function copyCell(cell) {
  return { x: cell.x, y: cell.y };
}

export function isCardinalNeighbor(from, to) {
  return isCell(from)
    && isCell(to)
    && Math.abs(from.x - to.x) + Math.abs(from.y - to.y) === 1;
}

/**
 * Returns every cell crossed by a same-axis pointer move. Diagonal pointer
 * samples never invent an arbitrary L turn: the player must physically pass
 * through the turning cell.
 */
export function cardinalSegment(from, to) {
  if (!isCell(from) || !isCell(to)) return { accepted: false, reason: 'Network route must stay on city tiles.', cells: [] };
  if (from.x !== to.x && from.y !== to.y) {
    return { accepted: false, reason: 'Network route must move through shared tile sides.', cells: [] };
  }
  const cells = [];
  if (from.x === to.x) {
    const direction = Math.sign(to.y - from.y);
    for (let y = from.y; direction === 0 ? y === from.y : direction > 0 ? y <= to.y : y >= to.y; y += direction || 1) {
      cells.push({ x: from.x, y });
      if (direction === 0) break;
    }
  } else {
    const direction = Math.sign(to.x - from.x);
    for (let x = from.x; direction > 0 ? x <= to.x : x >= to.x; x += direction) cells.push({ x, y: from.y });
  }
  return { accepted: true, cells };
}

function concatenateSegments(first, second) {
  return [...first.cells, ...second.cells.slice(1)];
}

/**
 * Computes the two shortest right-angle candidates so the endpoint pointer
 * half can deterministically select exactly one of them.
 */
export function endpointRouteCandidates(from, to) {
  if (!isCell(from) || !isCell(to)) return { accepted: false, kind: null, candidates: [], reason: 'Network route must stay on city tiles.' };
  const straight = cardinalSegment(from, to);
  if (straight.accepted) return { accepted: true, kind: 'straight', candidates: [{ variant: 'straight', corner: null, cells: straight.cells.map(copyCell) }] };
  const candidate = (variant, corner) => ({
    variant,
    corner: copyCell(corner),
    cells: concatenateSegments(cardinalSegment(from, corner), cardinalSegment(corner, to)).map(copyCell)
  });
  return {
    accepted: true,
    kind: 'orthogonal',
    candidates: [candidate('x-first', { x: to.x, y: from.y }), candidate('y-first', { x: from.x, y: to.y })]
  };
}

/**
 * Selects the route whose final approach is on the same visual side of B as
 * the pointer. Projected predecessor centers make this camera-relative rather
 * than coupling screen-left to one world-axis route. The hysteresis band keeps
 * the current candidate stable while the pointer crosses the center seam.
 */
export function endpointRouteVariantForPointer(
  tileBounds,
  clientX,
  fallback = 'x-first',
  predecessorCenterX = null,
  hysteresisPx = 3
) {
  const left = Number(tileBounds?.left);
  const width = Number(tileBounds?.width);
  const pointerX = Number(clientX);
  if (!Number.isFinite(left) || !Number.isFinite(width) || width <= 0 || !Number.isFinite(pointerX)) return fallback;
  const center = left + width / 2;
  const hysteresis = Math.max(0, Number.isFinite(Number(hysteresisPx)) ? Number(hysteresisPx) : 0);
  if (Math.abs(pointerX - center) <= hysteresis) return fallback;

  const projected = predecessorCenterX && typeof predecessorCenterX === 'object'
    ? ['x-first', 'y-first'].map((variant) => ({
        variant,
        centerX: Number(predecessorCenterX[variant])
      })).filter(({ centerX }) => Number.isFinite(centerX))
    : [];
  if (projected.length === 2 && projected[0].centerX !== projected[1].centerX) {
    projected.sort((a, b) => a.centerX - b.centerX);
    return pointerX < center ? projected[0].variant : projected[1].variant;
  }
  return pointerX < center ? 'x-first' : 'y-first';
}

/** Resolves one atomic endpoint gesture; intermediate pointer samples never become route cells. */
export function proposeEndpointNetworkRoute(from, to, requestedVariant = 'x-first') {
  const candidates = endpointRouteCandidates(from, to);
  if (!candidates.accepted) return { accepted: false, route: [], reason: candidates.reason };
  const selected = candidates.candidates.find((item) => item.variant === requestedVariant) || candidates.candidates[0];
  const validation = validateSimpleNetworkRoute(selected.cells);
  if (!validation.accepted) return { accepted: false, route: [], reason: validation.reason };
  return {
    accepted: true,
    kind: candidates.kind,
    variant: selected.variant,
    corner: selected.corner ? copyCell(selected.corner) : null,
    route: selected.cells.map(copyCell)
  };
}

export function validateSimpleNetworkRoute(cells) {
  if (!Array.isArray(cells) || !cells.length) return { accepted: false, reason: 'Choose a city tile to start the network route.' };
  const visited = new Set();
  for (let index = 0; index < cells.length; index += 1) {
    const cell = cells[index];
    if (!isCell(cell)) return { accepted: false, reason: 'Network route must stay on city tiles.' };
    const key = cellKey(cell);
    if (visited.has(key)) return { accepted: false, reason: 'Network route cannot retrace, branch, cross, or loop within one gesture.' };
    visited.add(key);
    if (index > 0 && !isCardinalNeighbor(cells[index - 1], cell)) {
      return { accepted: false, reason: 'Network route must move through shared tile sides.' };
    }
  }
  return { accepted: true };
}

/**
 * Extends one in-progress route from its endpoint. A rejected pointer sample
 * leaves the accepted route immutable, allowing the page to render a red
 * preview and reject the complete gesture atomically on pointer-up.
 */
export function proposeNetworkRouteExtension(route, to) {
  const current = Array.isArray(route) ? route.map(copyCell) : [];
  const currentValidation = current.length ? validateSimpleNetworkRoute(current) : { accepted: true };
  if (!currentValidation.accepted) return { accepted: false, route: current, reason: currentValidation.reason };
  if (!current.length) {
    if (!isCell(to)) return { accepted: false, route: current, reason: 'Network route must stay on city tiles.' };
    return { accepted: true, changed: true, route: [copyCell(to)] };
  }
  const segment = cardinalSegment(current[current.length - 1], to);
  if (!segment.accepted) return { accepted: false, route: current, reason: segment.reason };
  const additions = segment.cells.slice(1);
  if (!additions.length) return { accepted: true, changed: false, route: current };
  const existing = new Set(current.map(cellKey));
  if (additions.some((cell) => existing.has(cellKey(cell)))) {
    return {
      accepted: false,
      route: current,
      reason: 'Network route cannot retrace, branch, cross, or loop within one gesture.'
    };
  }
  const candidate = [...current, ...additions];
  const validation = validateSimpleNetworkRoute(candidate);
  return validation.accepted
    ? { accepted: true, changed: true, route: candidate }
    : { accepted: false, route: current, reason: validation.reason };
}

const CARDINAL_BIT = Object.freeze({ '0,-1': 1, '1,0': 2, '0,1': 4, '-1,0': 8 });

function directionBetween(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return { dx, dy, bit: CARDINAL_BIT[`${dx},${dy}`] || 0 };
}

function oppositeBit(bit) {
  return ({ 1: 4, 2: 8, 4: 1, 8: 2 })[bit] || 0;
}

function avenueNormal(direction, expansionSide) {
  return expansionSide === 'left'
    ? { x: direction.dy, y: -direction.dx }
    : { x: -direction.dy, y: direction.dx };
}

/**
 * Presentation-only paired-lane footprint for an in-progress gesture. The
 * command engine remains authoritative; this helper ensures even a rejected
 * transaction can show every cell the atomic avenue attempted to occupy.
 */
export function deriveAvenuePreviewRibbon(route, width, height, expansionSide) {
  const validation = validateSimpleNetworkRoute(route);
  if (!validation.accepted) return { accepted: false, reason: validation.reason, cells: [] };
  if (expansionSide !== 'left' && expansionSide !== 'right') {
    return { accepted: false, reason: 'Avenue expansion side must be left or right.', cells: [] };
  }
  if (route.length === 1) {
    return {
      accepted: false,
      reason: 'Avenue requires a two-tile drag to create a 2 × 2 paired-lane block.',
      reasonCode: 'avenue-requires-two-route-tiles',
      cells: [{ ...copyCell(route[0]), laneRole: 'drawn', travelMask: 0, pairMask: 0 }],
    };
  }

  const records = new Map();
  const drawnKeys = new Set(route.map(cellKey));
  const put = (cell, laneRole) => {
    const key = cellKey(cell);
    const current = records.get(key);
    if (current) {
      if (laneRole === 'drawn') current.laneRole = 'drawn';
      return current;
    }
    const record = { x: cell.x, y: cell.y, laneRole, travelMask: 0, pairMask: 0 };
    records.set(key, record);
    return record;
  };

  route.forEach((cell) => put(cell, 'drawn'));

  const segmentNormals = [];
  const pairedPath = [];
  const appendPairedPathCell = (cell) => {
    if (drawnKeys.has(cellKey(cell))) return;
    put(cell, 'paired');
    if (!pairedPath.length || cellKey(pairedPath.at(-1)) !== cellKey(cell)) pairedPath.push(copyCell(cell));
  };
  const pair = (drawn, paired) => {
    if (drawnKeys.has(cellKey(paired))) return;
    const direction = directionBetween(drawn, paired);
    if (!direction.bit) return;
    put(drawn, 'drawn').pairMask |= direction.bit;
    put(paired, 'paired').pairMask |= oppositeBit(direction.bit);
  };
  for (let index = 1; index < route.length; index += 1) {
    const from = route[index - 1];
    const to = route[index];
    const direction = directionBetween(from, to);
    const normal = avenueNormal(direction, expansionSide);
    segmentNormals.push(normal);
    const shiftedFrom = { x: from.x + normal.x, y: from.y + normal.y };
    const shiftedTo = { x: to.x + normal.x, y: to.y + normal.y };
    if (index > 1) {
      const before = segmentNormals[index - 2];
      if (before.x !== normal.x || before.y !== normal.y) {
        appendPairedPathCell({ x: from.x + before.x + normal.x, y: from.y + before.y + normal.y });
      }
    }
    appendPairedPathCell(shiftedFrom);
    appendPairedPathCell(shiftedTo);
    pair(from, shiftedFrom);
    pair(to, shiftedTo);
  }

  const applyTravel = (path, forward) => {
    const ordered = forward ? path : [...path].reverse();
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const direction = directionBetween(ordered[index], ordered[index + 1]);
      if (direction.bit) put(ordered[index], drawnKeys.has(cellKey(ordered[index])) ? 'drawn' : 'paired').travelMask |= direction.bit;
    }
  };
  // The ordered route is always the forward, right-hand carriageway. Which
  // side contains its companion must not reverse the direction the player
  // just aimed—edge mirroring is a placement fallback, not a U-turn.
  applyTravel(route, true);
  applyTravel(pairedPath, false);

  const cells = [...records.values()];
  const outside = cells.find((cell) => cell.x < 0 || cell.y < 0 || cell.x >= width || cell.y >= height);
  return {
    accepted: !outside,
    reason: outside ? 'The paired avenue footprint extends outside the city map.' : null,
    reasonCode: outside ? 'paired-lane-outside-map' : null,
    cells: cells.map((cell) => ({ ...cell })),
  };
}
