/** Visual-only RCI service-warning categories, ordered for stable rendering. */
export const SERVICE_WARNING_KINDS = ['road', 'power', 'water'] as const;

/** Only power and water are aggregated across multiple zoned tiles. */
export const GROUPED_SERVICE_WARNING_KINDS = ['power', 'water'] as const;

export type ServiceWarningKind = typeof SERVICE_WARNING_KINDS[number];

export interface ServiceWarningAreaInput {
  width: number;
  zones: readonly unknown[];
  roadAccess: readonly boolean[];
  powered: readonly boolean[];
  watered: readonly boolean[];
}

export interface ServiceWarningArea {
  /** Stable description of this exact visual component. */
  id: string;
  kind: ServiceWarningKind;
  /** Ascending canonical tile ids in this failed contiguous zoned area. */
  tileIds: number[];
  /** Number of affected zoned tiles, retained directly for renderer consumers. */
  memberCount: number;
  /** Member tile nearest the area's geometric centre; ties favour lower ids. */
  anchorTileId: number;
}

function assertInput(input: ServiceWarningAreaInput): void {
  if (!Number.isInteger(input.width) || input.width < 1) throw new RangeError('Warning-area width must be a positive integer.');
  const tileCount = input.zones.length;
  if (tileCount % input.width !== 0) throw new RangeError('Warning-area zones must form a complete rectangular grid.');
  for (const values of [input.roadAccess, input.powered, input.watered]) {
    if (values.length !== tileCount) throw new RangeError('Warning-area service arrays must match the zone array length.');
  }
}

function warningMissingAt(input: ServiceWarningAreaInput, kind: ServiceWarningKind, tileId: number): boolean {
  const zone = input.zones[tileId];
  const rendererZoneKind = typeof zone === 'object' && zone !== null && 'kind' in zone
    ? (zone as { kind?: unknown }).kind
    : null;
  if (zone !== 'R' && zone !== 'C' && zone !== 'I'
    && rendererZoneKind !== 'residential' && rendererZoneKind !== 'commercial' && rendererZoneKind !== 'industrial') return false;
  switch (kind) {
    case 'road': return input.roadAccess[tileId] !== true;
    case 'power': return input.powered[tileId] !== true;
    case 'water': return input.watered[tileId] !== true;
  }
}

function cardinalNeighborIds(tileId: number, width: number, tileCount: number): number[] {
  const x = tileId % width;
  const result: number[] = [];
  if (tileId >= width) result.push(tileId - width);
  if (x + 1 < width) result.push(tileId + 1);
  if (tileId + width < tileCount) result.push(tileId + width);
  if (x > 0) result.push(tileId - 1);
  return result;
}

function centreAnchor(tileIds: readonly number[], width: number): number {
  const centre = tileIds.reduce(
    (sum, tileId) => ({ x: sum.x + tileId % width, y: sum.y + Math.floor(tileId / width) }),
    { x: 0, y: 0 },
  );
  const centreX = centre.x / tileIds.length;
  const centreY = centre.y / tileIds.length;
  let selected = tileIds[0]!;
  let selectedDistance = Number.POSITIVE_INFINITY;
  for (const tileId of tileIds) {
    const x = tileId % width;
    const y = Math.floor(tileId / width);
    const distance = (x - centreX) ** 2 + (y - centreY) ** 2;
    if (distance < selectedDistance || (distance === selectedDistance && tileId < selected)) {
      selected = tileId;
      selectedDistance = distance;
    }
  }
  return selected;
}

function areasForKind(input: ServiceWarningAreaInput, kind: ServiceWarningKind): ServiceWarningArea[] {
  const tileCount = input.zones.length;
  const visited = new Uint8Array(tileCount);
  const areas: ServiceWarningArea[] = [];
  for (let start = 0; start < tileCount; start += 1) {
    if (visited[start] || !warningMissingAt(input, kind, start)) continue;
    const tileIds: number[] = [];
    const queue = [start];
    visited[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = queue[cursor]!;
      tileIds.push(current);
      for (const neighbor of cardinalNeighborIds(current, input.width, tileCount)) {
        if (visited[neighbor] || !warningMissingAt(input, kind, neighbor)) continue;
        visited[neighbor] = 1;
        queue.push(neighbor);
      }
    }
    tileIds.sort((left, right) => left - right);
    areas.push({
      id: `${kind}:${tileIds.join('.')}`,
      kind,
      tileIds,
      memberCount: tileIds.length,
      anchorTileId: centreAnchor(tileIds, input.width),
    });
  }
  return areas;
}

/**
 * Road access needs a precise cell-level explanation. Keep one stable marker
 * for every failed zoning cell instead of letting a large connected area hide
 * which lots are actually detached from the road network.
 */
export function deriveRoadWarningAreas(input: ServiceWarningAreaInput): ServiceWarningArea[] {
  assertInput(input);
  const areas: ServiceWarningArea[] = [];
  for (let tileId = 0; tileId < input.zones.length; tileId += 1) {
    if (!warningMissingAt(input, 'road', tileId)) continue;
    areas.push({
      id: `road:${tileId}`,
      kind: 'road',
      tileIds: [tileId],
      memberCount: 1,
      anchorTileId: tileId,
    });
  }
  return areas;
}

/**
 * Derive renderer-only warning components. No canonical city state is mutated,
 * and all service calculations remain owned by the market simulation.
 */
export function deriveServiceWarningAreas(input: ServiceWarningAreaInput): ServiceWarningArea[] {
  assertInput(input);
  return GROUPED_SERVICE_WARNING_KINDS.flatMap((kind) => areasForKind(input, kind));
}

export interface FacilityWarningInput {
  /** Facilities that stop working without power, with their occupied tiles. */
  facilities: ReadonlyArray<{ id: string; tiles: readonly number[] }>;
  powered: readonly boolean[];
  /** Grid width, so the adjacency rule here matches the engine's exactly. */
  width: number;
}

/**
 * A dark service station carries its own warning.
 *
 * The zoned-tile warnings above group contiguous RCI land; a station is a
 * single facility that either has power or does not, so it gets one marker of
 * its own rather than joining a neighbourhood's area.
 */
export function deriveFacilityPowerWarningAreas(
  input: FacilityWarningInput,
): ServiceWarningArea[] {
  const areas: ServiceWarningArea[] = [];
  const total = input.powered.length;
  // A station draws from the grid it TOUCHES, so this must test neighbours too.
  // Testing only the station's own tile left the marker up on a station the
  // engine had already brought online.
  const connected = (tiles: readonly number[]): boolean => tiles.some((tile) => {
    if (input.powered[tile] === true) return true;
    const x = tile % input.width;
    const candidates = [
      x > 0 ? tile - 1 : -1,
      x < input.width - 1 ? tile + 1 : -1,
      tile - input.width,
      tile + input.width,
    ];
    return candidates.some((next) => next >= 0 && next < total && input.powered[next] === true);
  });
  for (const facility of input.facilities) {
    if (facility.tiles.length === 0) continue;
    if (connected(facility.tiles)) continue;
    const tileIds = [...facility.tiles].sort((left, right) => left - right);
    areas.push({
      id: `power:facility:${facility.id}`,
      kind: 'power',
      tileIds,
      memberCount: tileIds.length,
      anchorTileId: tileIds[0]!,
    });
  }
  return areas;
}

/**
 * Facility gates remain individual markers rather than joining adjacent RCI
 * warnings. Only the player-requested operational prerequisites are surfaced:
 * thermal road/water and water-facility road/power.
 */
export function deriveFacilityUtilityWarningAreas(input: {
  thermalPlants: ReadonlyArray<{
    id: string;
    tiles: readonly number[];
    roadAccess: boolean | null;
    waterAccess: boolean | null;
  }>;
  waterFacilities: ReadonlyArray<{
    id: string;
    tiles: readonly number[];
    roadAccess: boolean | null;
    powerAccess: boolean | null;
  }>;
}): ServiceWarningArea[] {
  const areas: ServiceWarningArea[] = [];
  const append = (kind: ServiceWarningKind, id: string, tiles: readonly number[]): void => {
    if (tiles.length === 0) return;
    const tileIds = [...tiles].sort((left, right) => left - right);
    areas.push({
      id: `${kind}:facility:${id}`,
      kind,
      tileIds,
      memberCount: tileIds.length,
      anchorTileId: tileIds[0]!,
    });
  };
  for (const plant of input.thermalPlants) {
    if (plant.roadAccess !== true) append('road', plant.id, plant.tiles);
    if (plant.waterAccess !== true) append('water', plant.id, plant.tiles);
  }
  for (const facility of input.waterFacilities) {
    if (facility.roadAccess !== true) append('road', facility.id, facility.tiles);
    if (facility.powerAccess !== true) append('power', facility.id, facility.tiles);
  }
  return areas.sort((left, right) => (
    left.anchorTileId - right.anchorTileId
      || left.kind.localeCompare(right.kind)
      || left.id.localeCompare(right.id)
  ));
}

/**
 * Train Stations are allocated as atomic utility consumers. Unlike a source
 * facility, a neighbouring lit wire cannot prove that its reservation fit, so
 * their markers read the canonical allocation result directly.
 */
export function deriveTrainStationUtilityWarningAreas(input: {
  facilities: ReadonlyArray<{
    id: string;
    tiles: readonly number[];
    powerAccess: boolean | null;
    waterAccess: boolean | null;
  }>;
}): ServiceWarningArea[] {
  const areas: ServiceWarningArea[] = [];
  for (const facility of input.facilities) {
    if (facility.tiles.length === 0) continue;
    const tileIds = [...facility.tiles].sort((left, right) => left - right);
    for (const [kind, served] of [
      ['power', facility.powerAccess],
      ['water', facility.waterAccess],
    ] as const) {
      if (served === true) continue;
      areas.push({
        id: `${kind}:facility:${facility.id}`,
        kind,
        tileIds,
        memberCount: tileIds.length,
        anchorTileId: tileIds[0]!,
      });
    }
  }
  return areas;
}
