import type {
  MarketCityStateV2,
  MarketCityWorldCommand,
  MarketFacilityKind,
  MarketTerrainMaterial,
  MarketZoneKind,
} from '../market-city/types';

export interface DashboardCommandTranslationSuccess {
  ok: true;
  sourceType: string;
  command: MarketCityWorldCommand;
}

export interface DashboardCommandTranslationFailure {
  ok: false;
  sourceType: string;
  reason: string;
}

export type DashboardCommandTranslation =
  | DashboardCommandTranslationSuccess
  | DashboardCommandTranslationFailure;

type PlainRecord = Record<string, unknown>;

const ACTIVE_FACILITIES = new Set<MarketFacilityKind>([
  'coal-power-plant',
  'gas-power-plant',
  'nuclear-power-plant',
  'wind-turbine',
  'solar-plant',
  'fire-station',
  'police-station',
  'train-station',
  'subway-station',
  'water-tower',
  'coastal-water-pump',
  'water-treatment-plant',
]);

const ZONE_MAP: Readonly<Record<string, MarketZoneKind>> = Object.freeze({
  residential: 'R',
  commercial: 'C',
  industrial: 'I',
  R: 'R',
  C: 'C',
  I: 'I',
});

const MATERIAL_MAP: Readonly<Record<string, MarketTerrainMaterial>> = Object.freeze({
  'grass-light': 'grass',
  'grass-dark': 'earth',
  'dry-ground': 'sand',
  snow: 'rock',
  grass: 'grass',
  earth: 'earth',
  sand: 'sand',
  rock: 'rock',
});

function record(value: unknown): PlainRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as PlainRecord
    : null;
}

function failure(sourceType: string, reason: string): DashboardCommandTranslationFailure {
  return { ok: false, sourceType, reason };
}

function success(sourceType: string, command: MarketCityWorldCommand): DashboardCommandTranslationSuccess {
  return { ok: true, sourceType, command };
}

function coordinateTile(value: unknown, size: number): number | string {
  const coordinate = record(value);
  const x = coordinate?.x;
  const y = coordinate?.y;
  if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) return 'A tile coordinate must contain integer x and y values.';
  const column = x as number;
  const row = y as number;
  if (column < 0 || row < 0 || column >= size || row >= size) {
    return `Tile coordinate (${column}, ${row}) is outside the ${size} by ${size} map.`;
  }
  return row * size + column;
}

function coordinateTiles(value: unknown, size: number): number[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'The command must contain at least one tile coordinate.';
  const result: number[] = [];
  for (const coordinate of value) {
    const tileId = coordinateTile(coordinate, size);
    if (typeof tileId === 'string') return tileId;
    if (!result.includes(tileId)) result.push(tileId);
  }
  return result.sort((left, right) => left - right);
}

/** Route order is semantic for directed networks and must never be sorted. */
function orderedCoordinateTiles(value: unknown, size: number): number[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'The command must contain at least one route coordinate.';
  const result: number[] = [];
  for (const coordinate of value) {
    const tileId = coordinateTile(coordinate, size);
    if (typeof tileId === 'string') return tileId;
    if (result.at(-1) !== tileId) result.push(tileId);
  }
  return result;
}

function selectionTiles(value: unknown, size: number): number[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'The terrain command must contain at least one selection.';
  return coordinateTiles(value.map((selection) => record(selection)?.cell), size);
}

/**
 * Translate the retained square-grid gesture vocabulary into the clean market
 * command contract. Unsupported legacy systems fail closed and can never
 * re-enter canonical state through the compatibility-shaped rendering shell.
 */
export function translateDashboardCommand(
  state: MarketCityStateV2,
  value: unknown,
): DashboardCommandTranslation {
  const input = record(value);
  const sourceType = typeof input?.type === 'string' ? input.type : 'unknown';
  if (!input) return failure(sourceType, 'Dashboard command must be a plain object.');
  const size = state.map.size;

  if (sourceType === 'zone') {
    const zone = typeof input.kind === 'string' ? ZONE_MAP[input.kind] : undefined;
    const tileIds = coordinateTiles(input.cells, size);
    if (!zone) return failure(sourceType, 'Zone kind is unsupported.');
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    return success(sourceType, { type: 'zone', zone, tileIds });
  }

  if (sourceType === 'set-crime-funding') {
    const funding = Number(input.funding);
    if (!Number.isInteger(funding)) return failure(sourceType, 'Police funding must be a whole step.');
    return success(sourceType, { type: 'set-crime-funding', funding });
  }

  if (sourceType === 'zone-landfill') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    return success(sourceType, { type: 'zone-landfill', tileIds });
  }

  if (sourceType === 'dezone' || sourceType === 'demolish') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (sourceType === 'demolish') {
      if (input.layer !== undefined && input.layer !== 'surface' && input.layer !== 'underground') {
        return failure(sourceType, 'Demolition layer must be surface or underground.');
      }
      return success(sourceType, {
        type: 'demolish',
        tileIds,
        ...(input.layer === undefined ? {} : { layer: input.layer }),
      });
    }
    return success(sourceType, { type: sourceType, tileIds });
  }

  if (sourceType === 'place-network') {
    if (input.network === 'avenue') {
      if (input.expansionSide !== 'left' && input.expansionSide !== 'right') {
        return failure(sourceType, 'Avenue expansion side must be left or right.');
      }
      const path = orderedCoordinateTiles(input.route ?? input.cells, size);
      if (typeof path === 'string') return failure(sourceType, path);
      return success(sourceType, {
        type: 'place-avenue',
        path,
        expansionSide: input.expansionSide,
      });
    }
    if (input.network === 'rail') {
      const path = orderedCoordinateTiles(input.route ?? input.cells, size);
      if (typeof path === 'string') return failure(sourceType, path);
      return success(sourceType, { type: 'place-rail', path });
    }
    if (input.network === 'subway') {
      const path = orderedCoordinateTiles(input.route ?? input.cells, size);
      if (typeof path === 'string') return failure(sourceType, path);
      return success(sourceType, { type: 'place-subway', path });
    }
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (input.network === 'road') {
      const path = orderedCoordinateTiles(input.route ?? input.cells, size);
      if (typeof path === 'string') return failure(sourceType, path);
      return success(sourceType, { type: 'place-road', path });
    }
    if (input.network === 'power-line') return success(sourceType, { type: 'place-power-line', tileIds });
    if (input.network === 'water-pipe') return success(sourceType, { type: 'place-water-pipe', tileIds });
    return failure(sourceType, `${String(input.network)} is preserved as art but inactive in this release.`);
  }

  if (sourceType === 'place-facility') {
    const kind = input.facility as MarketFacilityKind;
    if (!ACTIVE_FACILITIES.has(kind)) {
      return failure(sourceType, `${String(input.facility)} is preserved as art but inactive in this release.`);
    }
    const anchor = coordinateTile(input.anchor, size);
    if (typeof anchor === 'string') return failure(sourceType, anchor);
    return success(sourceType, { type: 'place-facility', kind, anchor });
  }

  if (sourceType === 'paint-terrain-surface') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (input.surface !== 'water' && input.surface !== 'land') return failure(sourceType, 'Terrain surface must be water or land.');
    return success(sourceType, { type: 'paint-terrain', tileIds, water: input.surface === 'water' });
  }

  if (sourceType === 'paint-terrain-material') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    const material = typeof input.material === 'string' ? MATERIAL_MAP[input.material] : undefined;
    if (!material) return failure(sourceType, 'Terrain material is unsupported.');
    return success(sourceType, { type: 'paint-terrain', tileIds, material });
  }

  if (sourceType === 'adjust-tree-cover') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (!Number.isFinite(input.delta)) return failure(sourceType, 'Tree-cover delta must be finite.');
    return success(sourceType, { type: 'adjust-trees', tileIds, delta: Number(input.delta) });
  }

  if (sourceType === 'sculpt-terrain') {
    const tileIds = selectionTiles(input.selections, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (input.direction !== 1 && input.direction !== -1) return failure(sourceType, 'Terrain sculpt direction must be 1 or -1.');
    return success(sourceType, { type: 'adjust-elevation', tileIds, delta: input.direction });
  }

  if (sourceType === 'level-terrain') {
    const tileIds = coordinateTiles(input.cells, size);
    if (typeof tileIds === 'string') return failure(sourceType, tileIds);
    if (!Number.isFinite(input.height)) return failure(sourceType, 'Terrain level height must be finite.');
    return success(sourceType, { type: 'set-elevation', tileIds, elevation: Number(input.height) - 2 });
  }

  if (sourceType === 'reset-terrain-elevation') {
    return success(sourceType, { type: 'reset-elevation' });
  }

  return failure(sourceType, `Unsupported dashboard command ${JSON.stringify(sourceType)}.`);
}
