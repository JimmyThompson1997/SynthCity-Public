export type AvenueExpansionSide = 'left' | 'right';

export interface AvenueRibbonLane {
  tileId: number;
  travelMask: number;
  pairMask: number;
}

export interface AvenueRibbonSuccess {
  ok: true;
  primaryTileIds: number[];
  pairedTileIds: number[];
  footprint: number[];
  lanes: AvenueRibbonLane[];
}

export interface AvenueRibbonError {
  ok: false;
  reason: string;
}

export type AvenueRibbon = AvenueRibbonSuccess | AvenueRibbonError;

interface Coordinate {
  x: number;
  y: number;
}

interface Direction {
  dx: -1 | 0 | 1;
  dy: -1 | 0 | 1;
}

const CARDINAL_BITS = new Map<string, number>([
  ['0,-1', 1],
  ['1,0', 2],
  ['0,1', 4],
  ['-1,0', 8],
]);

function coordinate(tileId: number, size: number): Coordinate {
  return { x: tileId % size, y: Math.floor(tileId / size) };
}

function tileId(point: Coordinate, size: number): number {
  return point.y * size + point.x;
}

function direction(from: Coordinate, to: Coordinate): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) + Math.abs(dy) !== 1) return null;
  return { dx: dx as Direction['dx'], dy: dy as Direction['dy'] };
}

function sameDirection(left: Direction, right: Direction): boolean {
  return left.dx === right.dx && left.dy === right.dy;
}

function normal(heading: Direction, side: AvenueExpansionSide): Direction {
  return side === 'left'
    ? { dx: heading.dy, dy: -heading.dx } as Direction
    : { dx: -heading.dy, dy: heading.dx } as Direction;
}

function offset(point: Coordinate, delta: Direction): Coordinate {
  return { x: point.x + delta.dx, y: point.y + delta.dy };
}

function inside(point: Coordinate, size: number): boolean {
  return point.x >= 0 && point.x < size && point.y >= 0 && point.y < size;
}

function connectionBit(from: number, to: number, size: number): number | null {
  const first = coordinate(from, size);
  const second = coordinate(to, size);
  return CARDINAL_BITS.get(`${second.x - first.x},${second.y - first.y}`) ?? null;
}

/**
 * Expand one ordered cardinal path into an atomic two-carriageway Avenue.
 *
 * Travel masks are directed outgoing N/E/S/W bits (1/2/4/8). The ordered
 * player route always travels forward; its companion travels back. Expansion
 * controls only which side receives that companion, never the direction the
 * player aimed. Pair masks are reciprocal median links created only between
 * the two lanes of this gesture. They are not inferred from generic Avenue
 * adjacency, so joins retain their identity.
 */
export function deriveAvenueRibbon(
  size: number,
  path: readonly number[],
  expansionSide: AvenueExpansionSide,
): AvenueRibbon {
  if (!Number.isSafeInteger(size) || size <= 0) {
    return { ok: false, reason: 'Avenue map size must be a positive integer.' };
  }
  if (expansionSide !== 'left' && expansionSide !== 'right') {
    return { ok: false, reason: 'Avenue expansion side must be left or right.' };
  }
  if (path.length === 0) return { ok: false, reason: 'Avenue path must include at least one tile.' };
  if (path.length === 1) {
    return { ok: false, reason: 'Avenue requires a two-tile drag to create a 2 × 2 paired-lane block.' };
  }

  const maximum = size * size;
  const seen = new Set<number>();
  for (const tile of path) {
    if (!Number.isSafeInteger(tile) || tile < 0 || tile >= maximum) {
      return { ok: false, reason: `Avenue path tile ${String(tile)} is outside the map.` };
    }
    if (seen.has(tile)) return { ok: false, reason: 'Avenue path tiles must be unique and ordered.' };
    seen.add(tile);
  }

  const points = path.map((tile) => coordinate(tile, size));
  const directions: Direction[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const step = direction(points[index - 1]!, points[index]!);
    if (step === null) return { ok: false, reason: 'Avenue path must use cardinally adjacent tiles.' };
    directions.push(step);
  }

  const firstHeading = directions[0] ?? ({ dx: 0, dy: -1 } as Direction);
  let cornerIndex: number | null = null;
  let secondHeading: Direction | null = null;
  for (let index = 1; index < directions.length; index += 1) {
    const step = directions[index]!;
    if (sameDirection(step, firstHeading)) {
      if (secondHeading !== null) {
        return { ok: false, reason: 'Avenue path may contain only one cardinal bend.' };
      }
      continue;
    }
    if (step.dx === -firstHeading.dx && step.dy === -firstHeading.dy) {
      return { ok: false, reason: 'Avenue path cannot reverse direction.' };
    }
    if (secondHeading === null) {
      secondHeading = step;
      cornerIndex = index;
      continue;
    }
    if (!sameDirection(step, secondHeading)) {
      return { ok: false, reason: 'Avenue path may contain only one cardinal bend.' };
    }
  }

  const firstNormal = normal(firstHeading, expansionSide);
  const rawPaired: Coordinate[] = [];
  if (cornerIndex === null || secondHeading === null) {
    rawPaired.push(...points.map((point) => offset(point, firstNormal)));
  } else {
    const secondNormal = normal(secondHeading, expansionSide);
    for (let index = 0; index <= cornerIndex; index += 1) {
      rawPaired.push(offset(points[index]!, firstNormal));
    }
    const corner = points[cornerIndex]!;
    rawPaired.push({
      x: corner.x + firstNormal.dx + secondNormal.dx,
      y: corner.y + firstNormal.dy + secondNormal.dy,
    });
    for (let index = cornerIndex; index < points.length; index += 1) {
      rawPaired.push(offset(points[index]!, secondNormal));
    }
  }

  const primary = new Set(path);
  const pairedTileIds: number[] = [];
  const pairedSeen = new Set<number>();
  for (const point of rawPaired) {
    if (!inside(point, size)) return { ok: false, reason: 'Avenue paired lane is outside the map.' };
    const paired = tileId(point, size);
    if (primary.has(paired) || pairedSeen.has(paired)) continue;
    pairedSeen.add(paired);
    pairedTileIds.push(paired);
  }
  if (pairedTileIds.length === 0) return { ok: false, reason: 'Avenue paired lane has no buildable tiles.' };
  for (let index = 1; index < pairedTileIds.length; index += 1) {
    if (connectionBit(pairedTileIds[index - 1]!, pairedTileIds[index]!, size) === null) {
      return { ok: false, reason: 'Avenue paired lane is not cardinally contiguous.' };
    }
  }

  const laneMasks = new Map<number, { travelMask: number; pairMask: number }>();
  for (const lane of [...path, ...pairedTileIds]) laneMasks.set(lane, { travelMask: 0, pairMask: 0 });

  const addTravel = (ordered: readonly number[]): void => {
    for (let index = 0; index + 1 < ordered.length; index += 1) {
      const from = ordered[index]!;
      const bit = connectionBit(from, ordered[index + 1]!, size);
      if (bit === null) continue;
      laneMasks.get(from)!.travelMask |= bit;
    }
  };
  addTravel(path);
  addTravel([...pairedTileIds].reverse());

  for (const primaryTile of path) {
    for (const pairedTile of pairedTileIds) {
      const bit = connectionBit(primaryTile, pairedTile, size);
      if (bit === null) continue;
      const opposite = connectionBit(pairedTile, primaryTile, size)!;
      laneMasks.get(primaryTile)!.pairMask |= bit;
      laneMasks.get(pairedTile)!.pairMask |= opposite;
    }
  }

  const footprint = [...laneMasks.keys()].sort((left, right) => left - right);
  return {
    ok: true,
    primaryTileIds: [...path],
    pairedTileIds,
    footprint,
    lanes: footprint.map((lane) => ({ tileId: lane, ...laneMasks.get(lane)! })),
  };
}
