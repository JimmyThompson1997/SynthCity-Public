import { MARKET_CITY_RULES } from './rules';
import type {
  MarketBuildingDetail,
  MarketBuildingStructure,
  MarketCityStateV2,
  MarketLotFootprint,
  MarketRenderLot,
  MarketRenderRubble,
  MarketRoofKind,
  MarketZoneKind,
} from './types';

export const MARKET_BUILDING_PALETTES = Object.freeze({
  R: Object.freeze([112, 204, 124] as const),
  C: Object.freeze([96, 166, 240] as const),
  I: Object.freeze([238, 178, 80] as const),
} satisfies Record<MarketZoneKind, readonly [number, number, number]>);

type RoofWeight = readonly [MarketRoofKind, number];
interface RoofBand {
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  readonly bag: readonly RoofWeight[];
}

const ROOF_VOCABULARY = Object.freeze({
  R: Object.freeze([
    Object.freeze({ minimumHeight: 1, maximumHeight: 2, bag: Object.freeze([['gable', 4], ['pyramid', 4], ['wedge', 3], ['flat', 3]] as const) }),
    Object.freeze({ minimumHeight: 3, maximumHeight: 5, bag: Object.freeze([['gable', 2], ['wedge', 2], ['mech', 2], ['flat', 6]] as const) }),
    Object.freeze({ minimumHeight: 6, maximumHeight: 99, bag: Object.freeze([['mech', 3], ['core', 2], ['steps', 1], ['flat', 7]] as const) }),
  ]),
  C: Object.freeze([
    Object.freeze({ minimumHeight: 1, maximumHeight: 2, bag: Object.freeze([['parapet', 5], ['flat', 6], ['mech', 1]] as const) }),
    Object.freeze({ minimumHeight: 3, maximumHeight: 6, bag: Object.freeze([['parapet', 3], ['steps', 2], ['mech', 2], ['flat', 6]] as const) }),
    Object.freeze({ minimumHeight: 7, maximumHeight: 99, bag: Object.freeze([['steps', 4], ['mech', 3], ['core', 2], ['flat', 4]] as const) }),
  ]),
  I: Object.freeze([
    Object.freeze({ minimumHeight: 1, maximumHeight: 2, bag: Object.freeze([['sawtooth', 4], ['cylinder', 2], ['vents', 2], ['flat', 4]] as const) }),
    Object.freeze({ minimumHeight: 3, maximumHeight: 4, bag: Object.freeze([['silos', 3], ['stack', 3], ['cylinder', 2], ['core', 2], ['vents', 2], ['flat', 3]] as const) }),
    Object.freeze({ minimumHeight: 5, maximumHeight: 99, bag: Object.freeze([['stack', 4], ['silos', 3], ['core', 2], ['vents', 2], ['flat', 2]] as const) }),
  ]),
} satisfies Record<MarketZoneKind, readonly RoofBand[]>);

const ROOF_ORIENTATION_COUNTS = Object.freeze({
  wedge: 4,
  gable: 2,
  steps: 4,
  sawtooth: 4,
  core: 2,
  mech: 4,
  vents: 4,
  stack: 4,
  silos: 1,
} satisfies Partial<Record<MarketRoofKind, number>>);

const RECTANGLE_ONLY_ROOFS = new Set<MarketRoofKind>([
  'gable',
  'sawtooth',
  'parapet',
  'steps',
  'wedge',
]);

export const MARKET_BUILDING_VISIBLE_DENSITY = 0.05;

interface BuildingRoof {
  roof: MarketRoofKind;
  roofHeight: number;
  roofOrientation: number;
}

/** One legal, renderer-ready appearance offered by the live RCI vocabulary. */
export interface MarketBuildingAppearanceVariant {
  readonly zone: MarketZoneKind;
  readonly height: number;
  readonly footprint: MarketLotFootprint;
  readonly roof: MarketRoofKind;
  readonly roofOrientation: number;
  readonly detail: MarketBuildingDetail;
  readonly landmark: boolean;
}

interface CandidateFootprint {
  footprint: MarketLotFootprint;
  offsets: readonly (readonly [number, number])[];
}

const FOOTPRINTS = Object.freeze({
  '1x1': Object.freeze([[0, 0]] as const),
  '1x2': Object.freeze([[0, 0], [1, 0]] as const),
  '2x1': Object.freeze([[0, 0], [0, 1]] as const),
  '2x2': Object.freeze([[0, 0], [1, 0], [0, 1], [1, 1]] as const),
  L: Object.freeze([[0, 0], [0, 1], [1, 1]] as const),
} satisfies Record<MarketLotFootprint, readonly (readonly [number, number])[]>);

interface PreliminaryLot {
  id: string;
  tileIds: number[];
  zone: MarketZoneKind;
  height: number;
  footprint: MarketLotFootprint;
  originX: number;
  originY: number;
}

/** Stable unsigned 32-bit mixer used by deterministic building appearance. */
export function mix32(input: number): number {
  let value = (input ^ 0x9e3779b9) >>> 0;
  value = Math.imul(value, 0x85ebca6b) >>> 0;
  value = (value ^ (value >>> 13)) >>> 0;
  value = Math.imul(value, 0xc2b2ae35) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

/** Stable appearance hash derived only from an origin coordinate and salt. */
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

/** Reference height jitter. It is stable by tile and deliberately not seeded by playback. */
export function heightJitter01(tileId: number, seed = 12_345): number {
  let value = (seed ^ Math.imul(tileId, 0x9e3779b1)) >>> 0;
  value = (value ^ (value >>> 15)) >>> 0;
  value = Math.imul(value, 0x2c1b3c6d) >>> 0;
  value = (value ^ (value >>> 12)) >>> 0;
  return (value & 0xffff) / 65_535;
}

function expandedRoofBag(zone: MarketZoneKind, height: number): MarketRoofKind[] {
  const band = ROOF_VOCABULARY[zone].find((candidate) => (
    height >= candidate.minimumHeight && height <= candidate.maximumHeight
  ));
  if (!band) return ['flat'];
  const roofs: MarketRoofKind[] = [];
  for (const [roof, weight] of band.bag) {
    for (let index = 0; index < weight; index += 1) roofs.push(roof);
  }
  return roofs;
}

/** Selects roof, cap height, and orientation without drawing or simulation feedback. */
export function pickBuildingRoof(
  zone: MarketZoneKind,
  height: number,
  hash: number,
  landmark = false,
): BuildingRoof {
  if (height <= 0) return { roof: 'flat', roofHeight: 1, roofOrientation: 0 };
  if (landmark && zone === 'C') return { roof: 'spire', roofHeight: 2, roofOrientation: 0 };

  const bag = expandedRoofBag(zone, height);
  const roof = bag[mix32(hash) % bag.length] ?? 'flat';
  const orientationCount = ROOF_ORIENTATION_COUNTS[roof as keyof typeof ROOF_ORIENTATION_COUNTS] ?? 1;
  return {
    roof,
    roofHeight: 1,
    roofOrientation: mix32(hash + 101) % orientationCount,
  };
}

export function selectBuildingDetail(
  zone: MarketZoneKind,
  height: number,
  wide = false,
): MarketBuildingDetail {
  if (height <= 0) return null;
  if (zone === 'I') return 'bay';
  if (height <= 3) return 'door';
  if (zone === 'C') return height >= 7 || wide ? 'curtain' : 'windows';
  // Four is a WINDOWS storey, not a hole. `door` covered 1-3 and `windows`
  // started at 5, so a four storey residential block asked for no facade at all
  // and rendered as blank wall on every side. A hundred of them were standing
  // in one test city. Nothing above ground is detail-free now.
  return height >= 4 ? 'windows' : null;
}

/**
 * Enumerates every legal visual variation directly from the same private roof
 * vocabulary and footprint constraints used by derived market render lots.
 * It is intentionally presentation-only: no density, demand, or city state
 * participates in the result.
 */
export function deriveBuildingAppearanceVariants(maximumHeight = 10): readonly MarketBuildingAppearanceVariant[] {
  const heightLimit = Math.max(1, Math.floor(maximumHeight));
  const footprints: readonly MarketLotFootprint[] = ['1x1', '1x2', '2x1', '2x2', 'L'];
  const variants: MarketBuildingAppearanceVariant[] = [];
  const seen = new Set<string>();
  const add = (variant: MarketBuildingAppearanceVariant): void => {
    const key = [
      variant.zone,
      variant.height,
      variant.footprint,
      variant.roof,
      variant.roofOrientation,
      variant.detail ?? 'none',
      variant.landmark ? 'landmark' : 'ordinary',
    ].join(':');
    if (seen.has(key)) return;
    seen.add(key);
    variants.push(Object.freeze(variant));
  };

  (['R', 'C', 'I'] as const).forEach((zone) => {
    for (let height = 1; height <= heightLimit; height += 1) {
      const legalRoofs = new Set(expandedRoofBag(zone, height));
      footprints.forEach((footprint) => {
        const detail = selectBuildingDetail(zone, height, footprint !== '1x1');
        legalRoofs.forEach((candidateRoof) => {
          const roof = footprint === 'L' && RECTANGLE_ONLY_ROOFS.has(candidateRoof)
            ? 'flat'
            : candidateRoof;
          const orientations = ROOF_ORIENTATION_COUNTS[roof as keyof typeof ROOF_ORIENTATION_COUNTS] ?? 1;
          for (let roofOrientation = 0; roofOrientation < orientations; roofOrientation += 1) {
            add({ zone, height, footprint, roof, roofOrientation, detail, landmark: false });
          }
        });
      });
    }
  });

  for (let height = 1; height <= heightLimit; height += 1) {
    footprints.forEach((footprint) => {
      add({
        zone: 'C',
        height,
        footprint,
        roof: 'spire',
        roofOrientation: 0,
        detail: selectBuildingDetail('C', height, footprint !== '1x1'),
        landmark: true,
      });
    });
  }

  return Object.freeze(variants);
}

export function shadeColor(
  color: readonly [number, number, number],
  hash: number,
  spread = 0.10,
): [number, number, number] {
  const valueFactor = 1 + spread * (((mix32(hash + 202) % 1000) / 1000) * 2 - 1);
  const greenFactor = 1 + spread * 0.4 * (((mix32(hash + 303) % 1000) / 1000) * 2 - 1);
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.trunc(value)));
  return [
    channel(color[0] * valueFactor),
    channel(color[1] * valueFactor * greenFactor),
    channel(color[2] * valueFactor),
  ];
}

export function shadeBuildingColor(
  zone: MarketZoneKind,
  hash: number,
): [number, number, number] {
  return shadeColor(MARKET_BUILDING_PALETTES[zone], hash);
}

/**
 * Derives visible storeys from filled density. Desirability has already done
 * its work in the market solver; it never re-ranks the visual skyline.
 */
export function deriveBuildingHeights(
  state: MarketCityStateV2,
  densityCaps: readonly number[],
): number[] {
  const count = state.map.size * state.map.size;
  const heights = Array<number>(count).fill(0);
  for (let tileId = 0; tileId < count; tileId += 1) {
    if (state.map.zones[tileId] === null) continue;
    const density = state.economy.density[tileId] ?? 0;
    if (density <= MARKET_BUILDING_VISIBLE_DENSITY) continue;
    const heightCap = Math.max(0, Math.floor((densityCaps[tileId] ?? 0) * 10 + 1e-9));
    heights[tileId] = Math.min(heightCap, Math.max(1, Math.round(density * 10)));
  }

  return heights;
}

function candidateFootprint(roll: number): CandidateFootprint {
  if (roll < 14) return { footprint: '2x2', offsets: FOOTPRINTS['2x2'] };
  if (roll < 30) return { footprint: 'L', offsets: FOOTPRINTS.L };
  if (roll < 50) return { footprint: '1x2', offsets: FOOTPRINTS['1x2'] };
  if (roll < 66) return { footprint: '2x1', offsets: FOOTPRINTS['2x1'] };
  return { footprint: '1x1', offsets: FOOTPRINTS['1x1'] };
}

function mergeDevelopedLots(
  state: MarketCityStateV2,
  heights: readonly number[],
  reservedTiles: ReadonlySet<number>,
): PreliminaryLot[] {
  const size = state.map.size;
  const claimed = new Set<number>();
  const facilityTiles = new Set(state.map.facilities.flatMap((facility) => facility.tiles));
  const lots: PreliminaryLot[] = [];

  const canClaim = (
    x: number,
    y: number,
    zone: MarketZoneKind,
    height: number,
  ): boolean => {
    if (x < 0 || y < 0 || x >= size || y >= size) return false;
    const tileId = y * size + x;
    return !claimed.has(tileId)
      && !reservedTiles.has(tileId)
      && !facilityTiles.has(tileId)
      && state.map.roads[tileId] !== true
      && state.map.zones[tileId] === zone
      && heights[tileId] === height;
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const originTileId = y * size + x;
      const zone = state.map.zones[originTileId];
      const height = heights[originTileId] ?? 0;
      if (
        zone == null
        || height <= 0
        || claimed.has(originTileId)
        || reservedTiles.has(originTileId)
        || facilityTiles.has(originTileId)
        || state.map.roads[originTileId] === true
      ) continue;

      const preferred = candidateFootprint(tileHash(x, y, 7) % 100);
      const offsets = preferred.offsets.every(([dx, dy]) => canClaim(x + dx, y + dy, zone, height))
        ? preferred.offsets
        : FOOTPRINTS['1x1'];
      const footprint = offsets === preferred.offsets ? preferred.footprint : '1x1';
      const tileIds = offsets.map(([dx, dy]) => (y + dy) * size + x + dx);
      for (const tileId of tileIds) claimed.add(tileId);
      lots.push({
        id: `lot${lots.length}`,
        tileIds,
        zone,
        height,
        footprint,
        originX: x,
        originY: y,
      });
    }
  }
  return lots;
}

export function deriveFirePlume(intensity: number, age: number): number {
  if (intensity <= 0) return 0;
  return Math.min(1, 0.15 + 0.85 * (age / MARKET_CITY_RULES.fire.fullPlumeAge));
}

function finalizeLots(preliminaryLots: PreliminaryLot[]): MarketRenderLot[] {
  let landmarkId: string | null = null;
  for (const lot of preliminaryLots) {
    if (lot.zone !== 'C') continue;
    const current = landmarkId === null
      ? undefined
      : preliminaryLots.find((candidate) => candidate.id === landmarkId);
    if (
      !current
      || lot.height > current.height
      || (lot.height === current.height && lot.originY < current.originY)
      || (lot.height === current.height && lot.originY === current.originY && lot.originX < current.originX)
    ) landmarkId = lot.id;
  }

  return preliminaryLots.map((lot): MarketRenderLot => {
    const hash = tileHash(lot.originX, lot.originY, 11);
    const landmark = lot.id === landmarkId;
    let roof = pickBuildingRoof(lot.zone, lot.height, hash, landmark);
    if (lot.footprint === 'L' && RECTANGLE_ONLY_ROOFS.has(roof.roof)) {
      roof = { roof: 'flat', roofHeight: 1, roofOrientation: 0 };
    }
    return {
      id: lot.id,
      tileIds: [...lot.tileIds],
      zone: lot.zone,
      height: lot.height,
      footprint: lot.footprint,
      roof: roof.roof,
      roofHeight: roof.roofHeight,
      roofOrientation: roof.roofOrientation,
      detail: selectBuildingDetail(lot.zone, lot.height, lot.tileIds.length > 1),
      color: shadeBuildingColor(lot.zone, hash),
      landmark,
      incidentId: null,
      fireIntensity: 0,
      fireDamage: 0,
      fireAge: 0,
      char: 0,
      plume: 0,
    };
  });
}

/** Shared simulation/rendering building units. Active incident cells are reserved. */
export function deriveBuildingUnits(
  state: MarketCityStateV2,
  densityCaps: readonly number[],
): MarketRenderLot[] {
  const heights = deriveBuildingHeights(state, densityCaps);
  const reservedTiles = new Set(state.fire.incidents.flatMap((incident) => incident.tileIds));
  return finalizeLots(mergeDevelopedLots(state, heights, reservedTiles));
}

export function captureBuildingStructure(lot: MarketRenderLot): MarketBuildingStructure {
  return {
    footprint: lot.footprint,
    originTile: Math.min(...lot.tileIds),
    height: lot.height,
    roof: lot.roof,
    roofHeight: lot.roofHeight,
    roofOrientation: lot.roofOrientation,
    detail: lot.detail,
    color: [lot.color[0], lot.color[1], lot.color[2]],
    landmark: lot.landmark,
  };
}

/**
 * Produces stable, appearance-only building groups. Simulation tiles remain
 * authoritative even when several equal lots are rendered as one footprint.
 */
export function deriveRenderLots(
  state: MarketCityStateV2,
  densityCaps: readonly number[],
): MarketRenderLot[] {
  const normal = deriveBuildingUnits(state, densityCaps).map((lot) => ({
    ...lot,
    char: lot.tileIds.reduce((maximum, tile) => Math.max(maximum, state.fire.char[tile] ?? 0), 0),
  }));
  const burning = state.fire.incidents
    .filter((incident) => incident.status === 'burning')
    .map((incident): MarketRenderLot => ({
      id: `incident-${incident.id}`,
      tileIds: [...incident.tileIds],
      zone: incident.zone,
      height: incident.structure.height,
      footprint: incident.structure.footprint,
      roof: incident.structure.roof,
      roofHeight: incident.structure.roofHeight,
      roofOrientation: incident.structure.roofOrientation,
      detail: incident.structure.detail,
      color: [...incident.structure.color],
      landmark: incident.structure.landmark,
      incidentId: incident.id,
      fireIntensity: incident.intensity,
      fireDamage: incident.damage,
      fireAge: incident.age,
      char: incident.tileIds.reduce((maximum, tile) => Math.max(maximum, state.fire.char[tile] ?? 0), 0),
      plume: deriveFirePlume(incident.intensity, incident.age),
    }));
  return [...normal, ...burning];
}

export function deriveRenderRubble(state: MarketCityStateV2): MarketRenderRubble[] {
  return state.fire.incidents
    .filter((incident) => incident.status === 'rubble')
    .map((incident) => ({
      id: `rubble-${incident.id}`,
      incidentId: incident.id,
      tileIds: [...incident.tileIds],
      zone: incident.zone,
      structure: { ...incident.structure, color: [...incident.structure.color] },
      char: incident.tileIds.reduce((maximum, tile) => Math.max(maximum, state.fire.char[tile] ?? 0), 0),
      rubbleMonthsRemaining: incident.rubbleMonthsRemaining,
    }));
}
