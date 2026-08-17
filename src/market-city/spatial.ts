import {
  clamp,
  cachedTilesWithinManhattan,
  coordinateToIndex,
  indexToCoordinate,
  manhattanDistance,
  orthogonalNeighbors,
} from './math';
import { isPowerPlant, MARKET_CITY_RULES } from './rules';
import { deriveUtilities } from './utilities';
import type {
  MarketPowerComponentMetrics,
  MarketCityStateV2,
  MarketFacility,
  MarketFacilityOperationalStatus,
  MarketPowerPlantOperation,
  MarketZoneKind,
} from './types';

export interface MarketPowerResult {
  powered: boolean[];
  componentByTile: Array<string | null>;
  components: MarketPowerComponentMetrics[];
  livePlantIds: string[];
  liveCapacity: number;
  load: number;
  allocatedLoad: number;
  unservedLoad: number;
  constrainedComponentCount: number;
  headroom: number;
  plantOperations: MarketPowerPlantOperation[];
}

export interface MarketDensityCaps {
  densityCaps: number[];
  heightCaps: number[];
}

type MarketPlantKind = keyof typeof MARKET_CITY_RULES.plants;
type MarketPlantFacility = MarketFacility & { kind: MarketPlantKind };

function valueAt<T>(values: readonly T[], index: number): T {
  const value = values[index];
  if (value === undefined) throw new RangeError(`Missing market-city tile ${index}.`);
  return value;
}

function tileCount(state: MarketCityStateV2): number {
  return state.map.size * state.map.size;
}

/** Ordinary roads and Avenue carriageways form one shared road-service surface. */
export function isRoadSurface(state: MarketCityStateV2, tile: number): boolean {
  return valueAt(state.map.roads, tile) || valueAt(state.map.avenueLanes, tile);
}

/**
 * Legacy saves can contain R/C/I zoning alongside a physical map occupant.
 * These tiles retain no developable capacity until repaired with Dezone.
 * New zoning commands reject surface occupants; underground water pipes remain
 * compatible because they serve a lot from below.
 */
export function hasRciPhysicalOccupant(state: MarketCityStateV2, tile: number): boolean {
  return isRoadSurface(state, tile)
    || valueAt(state.map.rails, tile)
    || valueAt(state.map.powerLines, tile)
    || valueAt(state.map.landfillZones, tile)
    || state.map.facilities.some((facility) => facility.tiles.includes(tile));
}

function buildRowPrefix(values: readonly number[], size: number): number[] {
  const stride = size + 1;
  const prefix = Array<number>(size * stride).fill(0);
  for (let y = 0; y < size; y += 1) {
    let running = 0;
    const row = y * size;
    const prefixRow = y * stride;
    for (let x = 0; x < size; x += 1) {
      running += valueAt(values, row + x);
      prefix[prefixRow + x + 1] = running;
    }
  }
  return prefix;
}

/** Exact Manhattan-diamond sum in O(radius) using horizontal row prefixes. */
function diamondSum(
  rowPrefix: readonly number[],
  center: number,
  radius: number,
  size: number,
): number {
  const centerX = center % size;
  const centerY = Math.floor(center / size);
  const stride = size + 1;
  let total = 0;
  for (let y = Math.max(0, centerY - radius); y <= Math.min(size - 1, centerY + radius); y += 1) {
    const reach = radius - Math.abs(y - centerY);
    const minimumX = Math.max(0, centerX - reach);
    const maximumX = Math.min(size - 1, centerX + reach);
    const row = y * stride;
    total += valueAt(rowPrefix, row + maximumX + 1) - valueAt(rowPrefix, row + minimumX);
  }
  return total;
}

export function powerPlantFacilities(state: MarketCityStateV2): MarketPlantFacility[] {
  return state.map.facilities.filter((facility): facility is MarketPlantFacility => (
    isPowerPlant(facility.kind)
  ));
}

function validTiles(facility: MarketFacility, count: number): number[] {
  return facility.tiles.filter((tile) => Number.isInteger(tile) && tile >= 0 && tile < count);
}

/**
 * Road access is a market-service field, so only zoned cells receive it. A road
 * anywhere in the inclusive Manhattan-radius-three diamond is sufficient; it
 * need not connect to the map edge or to another road.
 */
export function deriveRoadAccess(state: MarketCityStateV2): boolean[] {
  const count = tileCount(state);
  const roadAccess = Array<boolean>(count).fill(false);
  const radius = MARKET_CITY_RULES.roadReach;

  for (let tile = 0; tile < count; tile += 1) {
    if (valueAt(state.map.zones, tile) === null) continue;
    roadAccess[tile] = cachedTilesWithinManhattan(tile, radius, state.map.size)
      .some((candidate) => isRoadSurface(state, candidate));
  }

  return roadAccess;
}

/**
 * Whether any valid footprint tile currently reaches the shared road surface
 * through the Manhattan service radius. Persisted service fields are ignored.
 */
export function hasFacilityRoadAccess(
  state: MarketCityStateV2,
  facility: MarketFacility,
): boolean {
  const count = tileCount(state);
  return validTiles(facility, count).some((footprintTile) => (
    cachedTilesWithinManhattan(footprintTile, MARKET_CITY_RULES.roadReach, state.map.size)
      .some((candidate) => isRoadSurface(state, candidate))
  ));
}

/** Backward-compatible name retained for the existing market-service callers. */
export function hasFacilityRoadReach(
  state: MarketCityStateV2,
  facility: MarketFacility,
  _roadTiles?: readonly number[],
): boolean {
  return hasFacilityRoadAccess(state, facility);
}

function bridgeDestination(
  state: MarketCityStateV2,
  from: number,
  road: number,
): number | null {
  const fromCoordinate = indexToCoordinate(from, state.map.size);
  const roadCoordinate = indexToCoordinate(road, state.map.size);
  const x = roadCoordinate.x + (roadCoordinate.x - fromCoordinate.x);
  const y = roadCoordinate.y + (roadCoordinate.y - fromCoordinate.y);
  if (x < 0 || y < 0 || x >= state.map.size || y >= state.map.size) return null;
  return coordinateToIndex(x, y, state.map.size);
}

/**
 * Zones, lines, power-plant footprints, and Train Station footprints conduct orthogonally. Two conductive
 * cells may also be connected through one road cell when they are collinear on
 * opposite sides. Capacity never crosses a component boundary. Within a
 * component, positive-load consumers are allocated atomically, with previously
 * powered tiles first and stable tile order breaking ties.
 */
/**
 * Low-level electrical topology and allocation for a caller-provided set of
 * operating plants. The utility resolver owns eligibility, including thermal
 * water reservations; callers should normally use derivePower().
 */
export function derivePowerForLivePlants(
  state: MarketCityStateV2,
  livePlantIds: readonly string[],
): MarketPowerResult {
  const count = tileCount(state);
  const plants = powerPlantFacilities(state);
  const livePlantIdSet = new Set(livePlantIds);
  const livePlants = plants.filter((facility) => livePlantIdSet.has(facility.id));
  const canonicalLivePlantIds = livePlants.map((facility) => facility.id);
  const livePlantIdsByTile = new Map<number, string[]>();
  const conductive = Array<boolean>(count).fill(false);

  for (let tile = 0; tile < count; tile += 1) {
    conductive[tile] = valueAt(state.map.zones, tile) !== null
      || valueAt(state.map.powerLines, tile) === true;
  }
  for (const facility of plants) {
    for (const tile of validTiles(facility, count)) {
      conductive[tile] = true;
      if (!livePlantIdSet.has(facility.id)) continue;
      const ids = livePlantIdsByTile.get(tile) ?? [];
      ids.push(facility.id);
      livePlantIdsByTile.set(tile, ids);
    }
  }
  for (const facility of state.map.facilities) {
    if (facility.kind !== 'train-station'
      && facility.kind !== 'fire-station'
      && facility.kind !== 'police-station'
      && facility.kind !== 'water-tower'
      && facility.kind !== 'coastal-water-pump'
      && facility.kind !== 'water-treatment-plant') continue;
    for (const tile of validTiles(facility, count)) conductive[tile] = true;
  }

  const powered = Array<boolean>(count).fill(false);
  const trainStationTiles = new Set(state.map.facilities
    .filter((facility) => facility.kind === 'train-station')
    .flatMap((facility) => validTiles(facility, count)));
  const componentByTile = Array<string | null>(count).fill(null);
  const components: MarketPowerComponentMetrics[] = [];
  const seen = Array<boolean>(count).fill(false);
  let allocatedLoad = 0;

  for (let start = 0; start < count; start += 1) {
    if (!conductive[start] || seen[start]) continue;

    const queue = [start];
    const component: number[] = [];
    const bridgedRoads = new Set<number>();
    const componentLivePlantIds = new Set<string>();
    seen[start] = true;

    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const current = valueAt(queue, cursor);
      component.push(current);
      for (const plantId of livePlantIdsByTile.get(current) ?? []) {
        componentLivePlantIds.add(plantId);
      }

      for (const neighbor of orthogonalNeighbors(current, state.map.size)) {
        if (valueAt(conductive, neighbor)) {
          if (!valueAt(seen, neighbor)) {
            seen[neighbor] = true;
            queue.push(neighbor);
          }
          continue;
        }

        if (!isRoadSurface(state, neighbor)) continue;
        const beyond = bridgeDestination(state, current, neighbor);
        if (beyond === null || !valueAt(conductive, beyond)) continue;
        bridgedRoads.add(neighbor);
        if (!valueAt(seen, beyond)) {
          seen[beyond] = true;
          queue.push(beyond);
        }
      }
    }

    const componentId = `power:${Math.min(...component)}`;
    for (const tile of component) componentByTile[tile] = componentId;
    for (const tile of bridgedRoads) componentByTile[tile] = componentId;

    const sortedPlantIds = [...componentLivePlantIds].sort((left, right) => left.localeCompare(right));
    const capacity = livePlants.reduce((total, facility) => (
      componentLivePlantIds.has(facility.id)
        ? total + MARKET_CITY_RULES.plants[facility.kind].capacity
        : total
    ), 0);
    const componentTiles = new Set(component);
    const consumers: Array<{
      tile: number;
      tiles: number[];
      load: number;
      previouslyPowered: boolean;
    }> = component
      .filter((tile) => valueAt(state.map.zones, tile) !== null)
      .map((tile) => {
        const zone = valueAt(state.map.zones, tile);
        if (zone === null) throw new Error(`Power consumer ${tile} must be zoned.`);
        return {
          tile,
          tiles: [tile],
          load: valueAt(state.economy.density, tile) * MARKET_CITY_RULES.zonePowerLoad[zone],
          previouslyPowered: valueAt(state.environment.powered, tile),
        };
      });
    for (const facility of state.map.facilities) {
      if (facility.kind !== 'train-station') continue;
      const tiles = validTiles(facility, count);
      if (tiles.length === 0 || !tiles.every((tile) => componentTiles.has(tile))) continue;
      consumers.push({
        tile: facility.anchor,
        tiles,
        load: MARKET_CITY_RULES.transit.trainStationPowerLoad,
        previouslyPowered: tiles.every((tile) => valueAt(state.environment.powered, tile)),
      });
    }
    const demand = consumers.reduce((total, consumer) => total + consumer.load, 0);
    let remaining = capacity;
    let allocated = 0;
    const positiveConsumers = consumers
      .filter(({ load }) => load > 1e-12)
      .sort((left, right) => (
        Number(right.previouslyPowered) - Number(left.previouslyPowered)
        || left.tile - right.tile
      ));

    for (const consumer of positiveConsumers) {
      if (consumer.load > remaining + 1e-12) continue;
      for (const tile of consumer.tiles) powered[tile] = true;
      allocated += consumer.load;
      remaining = Math.max(0, remaining - consumer.load);
    }

    if (capacity > 0) {
      for (const tile of component) {
        if (valueAt(state.map.zones, tile) === null && !trainStationTiles.has(tile)) powered[tile] = true;
      }
      for (const tile of bridgedRoads) powered[tile] = true;
    }
    if (remaining > 1e-12) {
      for (const consumer of consumers) {
        if (consumer.load <= 1e-12) for (const tile of consumer.tiles) powered[tile] = true;
      }
    }

    allocatedLoad += allocated;
    components.push({
      id: componentId,
      livePlantIds: sortedPlantIds,
      capacity,
      demand,
      allocated,
      remaining,
      constrained: demand - allocated > 1e-12,
      utilization: capacity > 0 ? clamp(allocated / capacity, 0, 1) : 0,
    });
  }

  const liveCapacity = livePlants.reduce((total, facility) => (
    total + MARKET_CITY_RULES.plants[facility.kind].capacity
  ), 0);
  let load = state.map.facilities
    .filter((facility) => facility.kind === 'train-station')
    .reduce((total) => total + MARKET_CITY_RULES.transit.trainStationPowerLoad, 0);
  for (let tile = 0; tile < count; tile += 1) {
    const zone = valueAt(state.map.zones, tile);
    if (zone === null) continue;
    load += valueAt(state.economy.density, tile) * MARKET_CITY_RULES.zonePowerLoad[zone];
  }

  return {
    powered,
    componentByTile,
    components,
    livePlantIds: canonicalLivePlantIds,
    liveCapacity,
    load,
    allocatedLoad,
    unservedLoad: Math.max(0, load - allocatedLoad),
    constrainedComponentCount: components.filter(({ constrained }) => constrained).length,
    headroom: liveCapacity > 0 ? 1 - load / liveCapacity : 0,
    plantOperations: [],
  };
}

/** Canonical power status, including thermal water and renewable exceptions. */
export function derivePower(state: MarketCityStateV2): MarketPowerResult {
  return deriveUtilities(state).power;
}

export interface MarketFireStationOperation {
  id: string;
  anchor: number;
  tileIds: number[];
  road: boolean;
  power: boolean;
  operational: boolean;
  inactiveReason: string | null;
}


/**
 * A station is not itself a conductor, so its own tile is only ever powered by
 * coincidence — sitting inside a blob it did not join. Like any building, it
 * draws from the grid it TOUCHES, so an adjacent live line or plant counts.
 *
 * Without this the power gate was effectively unreachable: a line laid right
 * beside a station left it dark.
 */
export function facilityHasPower(
  state: MarketCityStateV2,
  facility: MarketFacility,
  powered: readonly boolean[],
): boolean {
  for (const tile of facility.tiles) {
    if (powered[tile] === true) return true;
    for (const neighbour of orthogonalNeighbors(tile, state.map.size)) {
      if (powered[neighbour] === true) return true;
    }
  }
  return false;
}

export function deriveFireStationOperations(
  state: MarketCityStateV2,
  // Recomputes power by default. The persisted field is only written by
  // stepMonth, so a paused city that has never ticked has none — and the
  // planning views a mayor uses before pressing play are exactly the ones that
  // must not wait a month to tell the truth. Hot paths inside the monthly loop
  // pass the field they already hold.
  powered: readonly boolean[] = derivePower(state).powered,
): MarketFireStationOperation[] {
  return state.map.facilities
    .filter((facility) => facility.kind === 'fire-station')
    .map((facility) => {
      const road = hasFacilityRoadAccess(state, facility);
      const power = facilityHasPower(state, facility, powered);
      return {
        id: facility.id,
        anchor: facility.anchor,
        tileIds: [...facility.tiles],
        road,
        power,
        // A station needs BOTH a road to drive out on and power to run on.
        operational: road && power,
        inactiveReason: !road
          ? `No road access within ${MARKET_CITY_RULES.roadReach} tiles.`
          : !power ? 'No power.' : null,
      };
    });
}

/**
 * Potential planning coverage is deliberately road-only. It ignores active
 * incidents, power, water, and station overlap magnitude at its call sites.
 */
export function derivePotentialFireCoverage(state: MarketCityStateV2): number[] {
  const coverage = Array<number>(tileCount(state)).fill(0);
  const { stationPower, stationRadius } = MARKET_CITY_RULES.fire;
  for (const station of deriveFireStationOperations(state)) {
    if (!station.operational) continue;
    for (const tile of cachedTilesWithinManhattan(station.anchor, stationRadius, state.map.size)) {
      const distance = manhattanDistance(station.anchor, tile, state.map.size);
      coverage[tile] = (coverage[tile] ?? 0) + stationPower * (1 - distance / (stationRadius + 1));
    }
  }
  return coverage;
}

/** Congestion exists only on roads and reads the opening density field. */
export function deriveCongestion(state: MarketCityStateV2): number[] {
  const count = tileCount(state);
  const congestion = Array<number>(count).fill(0);

  for (let tile = 0; tile < count; tile += 1) {
    if (!valueAt(state.map.roads, tile)) continue;
    const localDensity = cachedTilesWithinManhattan(
      tile,
      MARKET_CITY_RULES.roadReach,
      state.map.size,
    ).reduce((total, candidate) => (
      valueAt(state.map.zones, candidate) === null
        ? total
        : total + valueAt(state.economy.density, candidate)
    ), 0);
    congestion[tile] = clamp(localDensity / MARKET_CITY_RULES.congestionCapacity, 0, 1);
  }

  return congestion;
}

/**
 * Produces the next pollution field. The radius-six kernel is normalized for
 * every destination, including corners, then existing pollution approaches that
 * weighted field by fifteen percent.
 */
export function derivePollution(
  state: MarketCityStateV2,
  power: MarketPowerResult,
  openingCongestion = deriveCongestion(state),
  /**
   * A uniform citywide term, in the same units as the emission field.
   *
   * It belongs to the FIELD the stock approaches, not to the stock. Added
   * afterwards it was re-injected every month on top of a stock that only
   * relaxes by `pollutionApproach`, so a nominal ceiling of ten settled at
   * ten divided by 0.15 -- about 67 of the 0-100 scale, two thirds of the
   * range, from uncollected rubbish alone.
   */
  uniformField = 0,
): number[] {
  const count = tileCount(state);
  const emissions = Array<number>(count).fill(0);
  const livePlantIds = new Set(power.livePlantIds);
  const utilizationByPlantId = new Map<string, number>();
  for (const component of power.components) {
    for (const plantId of component.livePlantIds) {
      utilizationByPlantId.set(plantId, component.utilization);
    }
  }

  for (let tile = 0; tile < count; tile += 1) {
    const zone = valueAt(state.map.zones, tile);
    if (zone !== null) {
      emissions[tile] = valueAt(emissions, tile)
        + MARKET_CITY_RULES.zoneEmission[zone] * valueAt(state.economy.density, tile);
    }
    if (valueAt(state.map.roads, tile)) {
      emissions[tile] = valueAt(emissions, tile)
        + MARKET_CITY_RULES.roadEmission * valueAt(openingCongestion, tile);
    }
  }

  for (const facility of powerPlantFacilities(state)) {
    if (!livePlantIds.has(facility.id)) continue;
    const plantEmission = MARKET_CITY_RULES.zoneEmission.I
      * MARKET_CITY_RULES.plants[facility.kind].pollutionMultiplier
      * (utilizationByPlantId.get(facility.id) ?? 0);
    for (const tile of validTiles(facility, count)) {
      emissions[tile] = valueAt(emissions, tile) + plantEmission;
    }
  }

  const pollution = Array<number>(count).fill(0);
  const radius = MARKET_CITY_RULES.pollutionRadius;
  const size = state.map.size;
  for (let target = 0; target < count; target += 1) {
    const targetX = target % size;
    const targetY = Math.floor(target / size);
    const minimumY = Math.max(0, targetY - radius);
    const maximumY = Math.min(size - 1, targetY + radius);
    let weightedEmission = 0;
    let totalWeight = 0;
    // Keep the canonical y-then-x kernel order while avoiding 2,304 repeated
    // object-walks through cached entries on every simulated month. This is the
    // exact same normalized Manhattan field, including its edge normalization.
    for (let y = minimumY; y <= maximumY; y += 1) {
      const verticalDistance = Math.abs(y - targetY);
      const horizontalReach = radius - verticalDistance;
      const minimumX = Math.max(0, targetX - horizontalReach);
      const maximumX = Math.min(size - 1, targetX + horizontalReach);
      for (let x = minimumX; x <= maximumX; x += 1) {
        const weight = 1 - (verticalDistance + Math.abs(x - targetX)) / (radius + 1);
        weightedEmission += emissions[y * size + x]! * weight;
        totalWeight += weight;
      }
    }
    const field = (totalWeight > 0 ? weightedEmission / totalWeight : 0) + uniformField;
    const previous = valueAt(state.environment.pollution, target);
    pollution[target] = clamp(
      previous + MARKET_CITY_RULES.pollutionApproach * (field - previous),
      0,
      100,
    );
  }

  return pollution;
}

/**
 * Road-and-power operational status for one station, for the inspector.
 *
 * The renderer reads operational/inactiveReason off the facility record and
 * falls back to "served" when they are missing, so a station without a status
 * here does not read as unknown: it reads as WORKING. A police station on an
 * empty map claimed a road and power it did not have until this existed.
 */
export function derivePoliceStationStatus(
  state: MarketCityStateV2,
  station: MarketFacility,
): MarketFacilityOperationalStatus {
  if (station.kind !== 'police-station') {
    throw new TypeError(`Facility ${station.id} is not a Police Station.`);
  }
  const operation = derivePoliceStationOperations(state).find(({ id }) => id === station.id);
  return {
    operational: operation?.operational ?? false,
    inactiveReason: operation === undefined
      ? 'Police station state is unavailable.'
      : operation.inactiveReason,
  };
}

/** Road-and-power operational status for police stations, mirroring fire. */
export function derivePoliceStationOperations(
  state: MarketCityStateV2,
  powered: readonly boolean[] = derivePower(state).powered,
): MarketFireStationOperation[] {
  return state.map.facilities
    .filter((facility) => facility.kind === 'police-station')
    .map((facility) => {
      const road = hasFacilityRoadAccess(state, facility);
      const power = facilityHasPower(state, facility, powered);
      return {
        id: facility.id,
        anchor: facility.anchor,
        tileIds: [...facility.tiles],
        road,
        power,
        operational: road && power,
        inactiveReason: !road
          ? `No road access within ${MARKET_CITY_RULES.roadReach} tiles.`
          : !power ? 'No power.' : null,
      };
    });
}

/** Tiles inside the Manhattan radius of an operational police station. */
export function derivePoliceCoverage(state: MarketCityStateV2): boolean[] {
  const covered = Array<boolean>(tileCount(state)).fill(false);
  const radius = MARKET_CITY_RULES.police.stationRadius;
  for (const station of derivePoliceStationOperations(state)) {
    if (!station.operational) continue;
    for (const tile of cachedTilesWithinManhattan(station.anchor, radius, state.map.size)) {
      covered[tile] = true;
    }
  }
  return covered;
}

/** Citywide height modifier for a derelict share, from the stepped table. */
export function crimeHeightModifier(derelictShare: number): number {
  const share = Math.max(0, derelictShare);
  for (const step of MARKET_CITY_RULES.police.heightSteps) {
    if (share <= step.upTo) return step.modifier;
  }
  return MARKET_CITY_RULES.police.heightSteps[
    MARKET_CITY_RULES.police.heightSteps.length - 1
  ]!.modifier;
}

/**
 * Every contribution to one tile's height cap, kept separate.
 *
 * Height is composed, not computed in one place: a universal base the player
 * sets, local bumps from services whose radius reaches the tile, and a citywide
 * shift from how the city is running. Keeping the terms apart is what lets the
 * inspector say WHY a lot is L6, and lets a new service be added by appending
 * one field rather than editing a formula.
 */
export interface MarketHeightStack {
  base: number;
  fire: number;
  police: number;
  crime: number;
  total: number;
}

/**
 * The crime share that actually governs this state, or null when the layer is
 * not running because nothing is built yet.
 *
 * This is a DEFAULT rather than something every caller passes, and that is the
 * whole point. It used to be an optional argument defaulting to neutral, and
 * three of the four call sites forgot it: the simulation capped development
 * WITH the crime term while the render adapter, the inspector and both queries
 * showed the player a cap WITHOUT it. At vertical level 6 with a blighted city
 * the inspector read 6 while development was actually governed by 3. The floor
 * hid the gap at level 1, which is why it survived review.
 *
 * Duplicating the population sweep rather than importing crimePopulation is
 * deliberate: crime.ts already imports this module, so the dependency can only
 * run one way.
 */
function governingCrimeShare(state: MarketCityStateV2): number | null {
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    if (state.map.zones[tile] === null) continue;
    if ((state.economy.density[tile] ?? 0) > 0) return state.crime.share;
  }
  return null;
}

export function deriveHeightStack(
  state: MarketCityStateV2,
  derelictShare: number | null = governingCrimeShare(state),
): MarketHeightStack[] {
  const count = tileCount(state);
  const fireCoverage = derivePotentialFireCoverage(state);
  const policeCoverage = derivePoliceCoverage(state);
  const base = state.market.verticalDevelopmentLevel;
  // A null share means the crime layer is not running, which must be NEUTRAL.
  // Treating it as zero derelicts awarded the clean-city +1 to every city in
  // the game and silently doubled density everywhere.
  const crime = derelictShare === null ? 0 : crimeHeightModifier(derelictShare);
  const bonus = MARKET_CITY_RULES.police.heightBonus;

  const stacks: MarketHeightStack[] = [];
  for (let tile = 0; tile < count; tile += 1) {
    const fire = (fireCoverage[tile] ?? 0) > 0 ? 1 : 0;
    const police = policeCoverage[tile] === true ? bonus : 0;
    stacks.push({
      base,
      fire,
      police,
      crime,
      // Downside protection: crime can strip every bonus a city earned but can
      // never stop it building. One storey is the floor.
      total: Math.max(1, Math.min(10, base + fire + police + crime)),
    });
  }
  return stacks;
}

export function deriveDensityCaps(
  state: MarketCityStateV2,
  derelictShare: number | null = governingCrimeShare(state),
): MarketDensityCaps {
  const count = tileCount(state);
  const densityCaps = Array<number>(count).fill(0);
  const heightCaps = Array<number>(count).fill(0);
  const stacks = deriveHeightStack(state, derelictShare);

  for (let tile = 0; tile < count; tile += 1) {
    const zone = valueAt(state.map.zones, tile);
    if (zone === null || hasRciPhysicalOccupant(state, tile)) continue;
    const height = stacks[tile]!.total;
    heightCaps[tile] = height;
    densityCaps[tile] = height / 10;
  }

  return { densityCaps, heightCaps };
}

const NEARBY_SECTOR: Readonly<Record<MarketZoneKind, MarketZoneKind>> = Object.freeze({
  R: 'C',
  C: 'R',
  I: 'I',
});

const NEARBY_WEIGHT: Readonly<Record<MarketZoneKind, number>> = Object.freeze({
  R: MARKET_CITY_RULES.desirabilityWeights.R.C,
  C: MARKET_CITY_RULES.desirabilityWeights.C.R,
  I: MARKET_CITY_RULES.desirabilityWeights.I.I,
});

/**
 * Sector desirability follows the frozen implementation literally: compute a
 * sector-specific quality on every zoned neighbor, assign zero to empty cells,
 * average across the complete radius-six diamond, then apply independent road
 * and power penalties to the candidate lot.
 */
export function deriveDesirability(
  state: MarketCityStateV2,
  roadAccess: readonly boolean[] = deriveRoadAccess(state),
  powered: readonly boolean[] = derivePower(state).powered,
  contributingZones: readonly (MarketZoneKind | null)[] = state.map.zones,
): number[] {
  const count = tileCount(state);
  const desirability = Array<number>(count).fill(0);

  for (const sector of ['R', 'C', 'I'] as const) {
    const weights = MARKET_CITY_RULES.desirabilityWeights[sector];
    const nearbySector = NEARBY_SECTOR[sector];
    const qualities = Array<number>(count).fill(0);

    for (let tile = 0; tile < count; tile += 1) {
      if (valueAt(contributingZones, tile) === null) continue;
      const clean = clamp(1 - valueAt(state.environment.pollution, tile) / 100, 0, 1);
      const nearbyDensity = valueAt(contributingZones, tile) === nearbySector
        ? valueAt(state.economy.density, tile)
        : 0;
      const wealth = clamp(
        valueAt(state.economy.wealth, tile) / MARKET_CITY_RULES.maximumIncome,
        0,
        1,
      );
      qualities[tile] = weights.clean * clean
        + NEARBY_WEIGHT[sector] * nearbyDensity
        + weights.wealth * wealth
        + weights.services * MARKET_CITY_RULES.serviceBaseline;
    }
    const qualityPrefix = buildRowPrefix(qualities, state.map.size);

    for (let tile = 0; tile < count; tile += 1) {
      if (valueAt(state.map.zones, tile) !== sector) continue;
      const neighborhood = cachedTilesWithinManhattan(
        tile,
        MARKET_CITY_RULES.desirabilityRadius,
        state.map.size,
      );
      let value = diamondSum(
        qualityPrefix,
        tile,
        MARKET_CITY_RULES.desirabilityRadius,
        state.map.size,
      ) / neighborhood.length;
      if (!valueAt(roadAccess, tile)) value -= 0.5;
      if (!valueAt(powered, tile)) value -= 0.5;
      if (!valueAt(state.environment.watered, tile)) value -= 0.5;
      desirability[tile] = value;
    }
  }

  return desirability;
}

/**
 * Empty, inaccessible permissions must not re-rank active buildings. This pure
 * projection is the single desirability authority for market bidding, lot
 * grouping, fire ignition, inspection, and rendering.
 */
export function deriveActiveMarketDesirability(
  state: MarketCityStateV2,
  roadAccess: readonly boolean[] = deriveRoadAccess(state),
  powered: readonly boolean[] = derivePower(state).powered,
): number[] {
  let changed = false;
  const zones = state.map.zones.map((zone, tile) => {
    if (zone !== null
      && (state.economy.density[tile] ?? 0) === 0
      && (!roadAccess[tile] || !powered[tile] || !state.environment.watered[tile])) {
      changed = true;
      return null;
    }
    return zone;
  });
  if (!changed) return deriveDesirability(state, roadAccess, powered);
  return deriveDesirability(state, roadAccess, powered, zones);
}
