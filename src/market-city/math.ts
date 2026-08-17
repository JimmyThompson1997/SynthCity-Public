export interface MarketCoordinate {
  x: number;
  y: number;
}

export interface MarketTargetSolution {
  margin: number;
  targets: number[];
}

function assertGridSize(size: number): void {
  if (!Number.isInteger(size) || size <= 0) {
    throw new RangeError(`Grid size must be a positive integer; received ${size}.`);
  }
}

export function clamp(value: number, min: number, max: number): number {
  if (min > max) throw new RangeError(`Clamp minimum ${min} exceeds maximum ${max}.`);
  return Math.min(max, Math.max(min, value));
}

export function coordinateToIndex(x: number, y: number, size = 48): number {
  assertGridSize(size);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= size || y >= size) {
    throw new RangeError(`Coordinate (${x}, ${y}) is outside ${size}x${size}.`);
  }
  return y * size + x;
}

export function indexToCoordinate(index: number, size = 48): MarketCoordinate {
  assertGridSize(size);
  if (!Number.isInteger(index) || index < 0 || index >= size * size) {
    throw new RangeError(`Tile ${index} is outside ${size}x${size}.`);
  }
  return { x: index % size, y: Math.floor(index / size) };
}

export function manhattanDistance(left: number, right: number, size = 48): number {
  const a = indexToCoordinate(left, size);
  const b = indexToCoordinate(right, size);
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function tilesWithinManhattan(center: number, radius: number, size = 48): number[] {
  return [...cachedTilesWithinManhattan(center, radius, size)];
}

const MANHATTAN_GEOMETRY_CACHE = new Map<string, readonly number[]>();
const MANHATTAN_KERNEL_CACHE = new Map<string, readonly MarketKernelEntry[]>();

export interface MarketKernelEntry {
  readonly tile: number;
  readonly weight: number;
}

/**
 * Immutable variant for simulation hot paths. Geometry is world-state agnostic,
 * so this module cache cannot affect saves, replay hashes, or continuation.
 */
export function cachedTilesWithinManhattan(
  center: number,
  radius: number,
  size = 48,
): readonly number[] {
  const origin = indexToCoordinate(center, size);
  if (!Number.isInteger(radius) || radius < 0) {
    throw new RangeError(`Manhattan radius must be a non-negative integer; received ${radius}.`);
  }

  const key = `${size}:${radius}:${center}`;
  const cached = MANHATTAN_GEOMETRY_CACHE.get(key);
  if (cached !== undefined) return cached;

  const tiles: number[] = [];
  const minimumY = Math.max(0, origin.y - radius);
  const maximumY = Math.min(size - 1, origin.y + radius);
  for (let y = minimumY; y <= maximumY; y += 1) {
    const horizontalReach = radius - Math.abs(y - origin.y);
    const minimumX = Math.max(0, origin.x - horizontalReach);
    const maximumX = Math.min(size - 1, origin.x + horizontalReach);
    for (let x = minimumX; x <= maximumX; x += 1) {
      tiles.push(y * size + x);
    }
  }
  const immutable = Object.freeze(tiles);
  MANHATTAN_GEOMETRY_CACHE.set(key, immutable);
  return immutable;
}

/** Immutable normalized-diamond weights for repeated diffusion passes. */
export function cachedManhattanKernel(
  center: number,
  radius: number,
  size = 48,
): readonly MarketKernelEntry[] {
  const key = `${size}:${radius}:${center}`;
  const cached = MANHATTAN_KERNEL_CACHE.get(key);
  if (cached !== undefined) return cached;
  const originX = center % size;
  const originY = Math.floor(center / size);
  const entries = cachedTilesWithinManhattan(center, radius, size).map((tile) => {
    const x = tile % size;
    const y = Math.floor(tile / size);
    return Object.freeze({
      tile,
      weight: 1 - (Math.abs(x - originX) + Math.abs(y - originY)) / (radius + 1),
    });
  });
  const immutable = Object.freeze(entries);
  MANHATTAN_KERNEL_CACHE.set(key, immutable);
  return immutable;
}

export function orthogonalNeighbors(index: number, size = 48): number[] {
  const { x, y } = indexToCoordinate(index, size);
  const neighbors: number[] = [];
  if (y > 0) neighbors.push(index - size);
  if (x > 0) neighbors.push(index - 1);
  if (x + 1 < size) neighbors.push(index + 1);
  if (y + 1 < size) neighbors.push(index + size);
  return neighbors;
}

/** Frozen unsigned 32-bit mixer. Math.imul preserves the low 32 multiply bits. */
export function mix32(input: number): number {
  let hash = (input ^ 0x9e37_79b9) >>> 0;
  hash = Math.imul(hash, 0x85eb_ca6b) >>> 0;
  hash = (hash ^ (hash >>> 13)) >>> 0;
  hash = Math.imul(hash, 0xc2b2_ae35) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}

/** Stable appearance/fire hash derived only from a tile coordinate and salt. */
export function tileHash(x: number, y: number, salt = 0): number {
  let value = (
    Math.imul(x, 73_856_093)
    ^ Math.imul(y, 19_349_663)
    ^ Math.imul(salt, 83_492_791)
  ) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 1_274_126_177) >>> 0;
  return (value >>> 7) & 0xffff;
}

interface MarginEvent {
  level: number;
  slopeDelta: number;
}

function validateMarketInputs(
  values: readonly number[],
  caps: readonly number[],
  demand: number,
  k: number,
): void {
  if (values.length !== caps.length) {
    throw new RangeError(`Market values (${values.length}) and caps (${caps.length}) must have equal length.`);
  }
  if (values.some((value) => !Number.isFinite(value))) {
    throw new TypeError('Every market value must be finite.');
  }
  if (caps.some((cap) => !Number.isFinite(cap))) {
    throw new TypeError('Every market cap must be finite.');
  }
  if (!Number.isFinite(demand)) throw new TypeError('Market demand must be finite.');
  if (!Number.isFinite(k)) throw new TypeError('Market shape k must be finite.');
  if (k <= 0) throw new RangeError(`Market shape k must be positive; received ${k}.`);
}

function targetsAtMargin(
  values: readonly number[],
  caps: readonly number[],
  margin: number,
  k: number,
): number[] {
  return values.map((value, index) => {
    const cap = Math.max(0, caps[index] ?? 0);
    return cap * clamp((value - margin) / k, 0, 1);
  });
}

/**
 * Solve the piecewise-linear market equation exactly by sweeping its breakpoints.
 *
 * Each lot enters the marginal set at `value`, leaves it saturated at `value-k`,
 * and contributes a slope of `cap/k` between those levels. Tracking saturated
 * capacity is the critical correction missing from the original Python solver.
 */
export function solveMarketTargets(
  values: readonly number[],
  caps: readonly number[],
  demand: number,
  k = 0.35,
): MarketTargetSolution {
  validateMarketInputs(values, caps, demand, k);
  if (values.length === 0) return { margin: 0, targets: [] };

  const positiveCaps = caps.map((cap) => Math.max(0, cap));
  const totalCapacity = positiveCaps.reduce((total, cap) => total + cap, 0);
  const wanted = Math.min(Math.max(0, demand), totalCapacity);
  const emptyMargin = Math.max(...values) + k;

  if (wanted === 0 || totalCapacity === 0) {
    return { margin: emptyMargin, targets: positiveCaps.map(() => 0) };
  }

  if (wanted === totalCapacity) {
    const margin = values.reduce(
      (lowest, value, index) => (positiveCaps[index] ?? 0) > 0 ? Math.min(lowest, value - k) : lowest,
      Number.POSITIVE_INFINITY,
    );
    return { margin, targets: positiveCaps };
  }

  const events: MarginEvent[] = [];
  values.forEach((value, index) => {
    const cap = positiveCaps[index] ?? 0;
    if (cap <= 0) return;
    const slope = cap / k;
    events.push({ level: value, slopeDelta: slope });
    events.push({ level: value - k, slopeDelta: -slope });
  });
  events.sort((left, right) => (
    right.level - left.level || left.slopeDelta - right.slopeDelta
  ));

  let previousLevel = events[0]!.level;
  let allocated = 0;
  let activeSlope = 0;
  let cursor = 0;

  while (cursor < events.length) {
    const level = events[cursor]!.level;
    const allocationAtLevel = allocated + activeSlope * (previousLevel - level);
    if (activeSlope > 0 && wanted <= allocationAtLevel) {
      const margin = previousLevel - (wanted - allocated) / activeSlope;
      return { margin, targets: targetsAtMargin(values, positiveCaps, margin, k) };
    }

    allocated = allocationAtLevel;
    let slopeDelta = 0;
    while (cursor < events.length && events[cursor]!.level === level) {
      slopeDelta += events[cursor]!.slopeDelta;
      cursor += 1;
    }
    activeSlope += slopeDelta;
    const slopeTolerance = Number.EPSILON * Math.max(1, totalCapacity / k);
    if (activeSlope < 0 && activeSlope >= -slopeTolerance) activeSlope = 0;
    previousLevel = level;
  }

  // The only mathematical way to reach this fallback is round-off at full capacity.
  const margin = values.reduce(
    (lowest, value, index) => (positiveCaps[index] ?? 0) > 0 ? Math.min(lowest, value - k) : lowest,
    Number.POSITIVE_INFINITY,
  );
  return { margin, targets: positiveCaps };
}
