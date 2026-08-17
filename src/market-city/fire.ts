import { captureBuildingStructure, deriveBuildingUnits } from './appearance';
import { cachedTilesWithinManhattan, manhattanDistance, orthogonalNeighbors } from './math';
import { MARKET_CITY_RULES } from './rules';
import { deriveDensityCaps, deriveFireStationOperations } from './spatial';
import type {
  MarketCityStateV2,
  MarketFireHistoryEntry,
  MarketFireIncident,
  MarketFacility,
  MarketFacilityOperationalStatus,
  MarketRenderLot,
} from './types';

const UINT32_RANGE = 4_294_967_296;
const FIRE_RANDOM_SALT = 1;
const INITIAL_INTENSITY = 0.04;
const IGNITION_DENSITY_THRESHOLD = 0.02;
export const MARKET_FIRE_STATION_NO_ROAD_REASON =
  `No road access within ${MARKET_CITY_RULES.roadReach} tiles.`;

/** Road-only operational status for the shared station inspector/renderer contract. */
export function deriveFireStationStatus(
  state: MarketCityStateV2,
  station: MarketFacility,
): MarketFacilityOperationalStatus {
  if (station.kind !== 'fire-station') {
    throw new TypeError(`Facility ${station.id} is not a Fire Station.`);
  }
  const operation = deriveFireStationOperations(state).find(({ id }) => id === station.id);
  return {
    operational: operation?.operational ?? false,
    inactiveReason: operation === undefined
      ? 'Fire station state is unavailable.'
      : operation.inactiveReason,
  };
}

/** The unsigned 32-bit mixer used by the frozen fire source. */
export function mix32(value: number): number {
  let mixed = (value ^ 0x9e3779b9) >>> 0;
  mixed = Math.imul(mixed, 0x85ebca6b) >>> 0;
  mixed = (mixed ^ (mixed >>> 13)) >>> 0;
  mixed = Math.imul(mixed, 0xc2b2ae35) >>> 0;
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

/** A deterministic draw in [0, 1), keyed only by canonical tile, month, and salt. */
export function deterministicFireRandom(tile: number, month: number, salt = 0): number {
  const key = (
    Math.imul(tile, 73_856_093)
    ^ Math.imul(month, 19_349_663)
    ^ Math.imul(salt, 83_492_791)
  ) >>> 0;
  return mix32(key) / UINT32_RANGE;
}

export function marketFireIncidentId(startedMonth: number, originTile: number): string {
  return `fire-m${startedMonth}-t${originTile}`;
}

function tileCount(state: MarketCityStateV2): number {
  return state.map.size * state.map.size;
}

function distanceToFootprint(anchor: number, tileIds: readonly number[], size: number): number {
  return tileIds.reduce(
    (nearest, tile) => Math.min(nearest, manhattanDistance(anchor, tile, size)),
    Number.POSITIVE_INFINITY,
  );
}

function activeIncidents(state: MarketCityStateV2): MarketFireIncident[] {
  return state.fire.incidents.filter((incident) => incident.status === 'burning');
}

function operationalStations(state: MarketCityStateV2) {
  // Recomputes power rather than trusting the persisted field. That field is
  // only written by stepMonth, so any caller that has not ticked — a unit
  // fixture, a paused city — would see every station as dark. This runs twice
  // a month, not per tile.
  return deriveFireStationOperations(state)
    .filter((station) => station.operational);
}

export { derivePotentialFireCoverage } from './spatial';

/**
 * Current suppression field. Each operational station splits its fixed power
 * across unique reachable building incidents, never across incident tiles.
 */
export function deriveFireStationCoverage(state: MarketCityStateV2): number[] {
  const coverage = Array<number>(tileCount(state)).fill(0);
  const incidents = activeIncidents(state);
  const { stationPower, stationRadius } = MARKET_CITY_RULES.fire;

  for (const station of operationalStations(state)) {
    const reachable = incidents.filter((incident) => (
      distanceToFootprint(station.anchor, incident.tileIds, state.map.size) <= stationRadius
    ));
    const split = stationPower / Math.max(1, reachable.length);
    for (const tile of cachedTilesWithinManhattan(station.anchor, stationRadius, state.map.size)) {
      const distance = manhattanDistance(station.anchor, tile, state.map.size);
      coverage[tile] = (coverage[tile] ?? 0) + split * (1 - distance / (stationRadius + 1));
    }
  }
  return coverage;
}

export function deriveIncidentSuppression(state: MarketCityStateV2): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  const incidents = activeIncidents(state);
  const { stationPower, stationRadius } = MARKET_CITY_RULES.fire;
  for (const incident of incidents) result.set(incident.id, 0);

  for (const station of operationalStations(state)) {
    const reachable = incidents.filter((incident) => (
      distanceToFootprint(station.anchor, incident.tileIds, state.map.size) <= stationRadius
    ));
    const split = stationPower / Math.max(1, reachable.length);
    for (const incident of reachable) {
      const distance = distanceToFootprint(station.anchor, incident.tileIds, state.map.size);
      const contribution = split * (1 - distance / (stationRadius + 1));
      result.set(incident.id, (result.get(incident.id) ?? 0) + contribution);
    }
  }
  return result;
}

export function fireIncidentAtTile(
  state: MarketCityStateV2,
  tileId: number,
): MarketFireIncident | undefined {
  return state.fire.incidents.find((incident) => incident.tileIds.includes(tileId));
}

export function protectedFireTiles(state: MarketCityStateV2): ReadonlySet<number> {
  return new Set(state.fire.incidents.flatMap((incident) => incident.tileIds));
}

function appendHistory(
  history: MarketFireHistoryEntry[],
  month: number,
  incident: MarketFireIncident,
  event: MarketFireHistoryEntry['event'],
): void {
  history.push({
    sequence: history.length + 1,
    month,
    incidentId: incident.id,
    event,
    tileIds: [...incident.tileIds],
    zone: incident.zone,
    intensity: incident.intensity,
    damage: incident.damage,
    rubbleMonthsRemaining: incident.rubbleMonthsRemaining,
  });
}

function sharedBurningEdges(
  state: MarketCityStateV2,
  lot: MarketRenderLot,
  burningByTile: ReadonlyMap<number, MarketFireIncident>,
): MarketFireIncident[] {
  const edges: MarketFireIncident[] = [];
  const own = new Set(lot.tileIds);
  for (const tile of lot.tileIds) {
    for (const neighbour of orthogonalNeighbors(tile, state.map.size)) {
      if (own.has(neighbour)) continue;
      const incident = burningByTile.get(neighbour);
      if (incident) edges.push(incident);
    }
  }
  return edges;
}

export interface MarketHistoricalFireOverlay {
  incidentId: string;
  event: 'ignition' | 'burning' | 'suppression' | 'collapse' | 'rubble';
  tileIds: number[];
  zone: MarketFireIncident['zone'];
  intensity: number;
  damage: number;
  rubbleMonthsRemaining: number;
}

/** Reconstructs compact, read-only map overlays without touching live state. */
export function reconstructFireHistoryAtMonth(
  state: MarketCityStateV2,
  month: number,
): MarketHistoricalFireOverlay[] {
  const selected = Math.max(0, Math.min(state.clock.month, Math.trunc(month)));
  const byIncident = new Map<string, MarketHistoricalFireOverlay>();
  const eventMonths = new Map<string, number>();
  for (const entry of state.fire.history) {
    if (entry.month > selected) break;
    if (entry.event === 'rubble-cleared') {
      byIncident.delete(entry.incidentId);
      eventMonths.delete(entry.incidentId);
      continue;
    }
    const event = entry.event === 'ignited'
      ? 'ignition'
      : entry.event === 'suppressed'
        ? 'suppression'
        : entry.event === 'collapsed'
          ? 'collapse'
          : 'burning';
    byIncident.set(entry.incidentId, {
      incidentId: entry.incidentId,
      event,
      tileIds: [...entry.tileIds],
      zone: entry.zone,
      intensity: entry.intensity,
      damage: entry.damage,
      rubbleMonthsRemaining: entry.rubbleMonthsRemaining,
    });
    eventMonths.set(entry.incidentId, entry.month);
  }

  for (const [incidentId, overlay] of byIncident) {
    const eventMonth = eventMonths.get(incidentId) ?? selected;
    if ((overlay.event === 'ignition' || overlay.event === 'suppression') && eventMonth !== selected) {
      byIncident.delete(incidentId);
      continue;
    }
    if (overlay.event !== 'collapse') continue;
    const collapse = state.fire.history.find((entry) => (
      entry.incidentId === incidentId && entry.event === 'collapsed'
    ));
    if (!collapse) continue;
    const elapsed = selected - collapse.month;
    if (elapsed > 0 && elapsed <= MARKET_CITY_RULES.fire.rubbleMonths) {
      overlay.event = 'rubble';
      overlay.rubbleMonthsRemaining = Math.max(0, MARKET_CITY_RULES.fire.rubbleMonths - elapsed);
    }
  }
  return [...byIncident.values()];
}

/** Advance the authoritative building-unit fire state by one displayed month. */
export function stepMarketFire(
  state: MarketCityStateV2,
  suppliedUnits?: readonly MarketRenderLot[],
): MarketCityStateV2 {
  const rules = MARKET_CITY_RULES.fire;
  const difficulty = rules.difficulty[state.clock.fireDifficulty];
  const fireMonth = state.clock.month + 1;
  const density = [...state.economy.density];
  const wealth = [...state.economy.wealth];
  const history = state.fire.history.map((entry) => ({ ...entry, tileIds: [...entry.tileIds] }));
  const openingRubbleTiles = new Set(
    state.fire.incidents.filter((incident) => incident.status === 'rubble').flatMap((incident) => incident.tileIds),
  );
  const char = state.fire.char.map((value, tile) => (
    openingRubbleTiles.has(tile) ? value : Math.max(0, value - rules.charDecay)
  ));
  const suppression = deriveIncidentSuppression(state);
  const incidents: MarketFireIncident[] = [];
  let collapsedTotal = state.fire.collapsedTotal;
  let suppressedTotal = state.fire.suppressedTotal;

  for (const opening of state.fire.incidents) {
    const incident: MarketFireIncident = {
      ...opening,
      tileIds: [...opening.tileIds],
      structure: { ...opening.structure, color: [...opening.structure.color] },
    };
    if (incident.status === 'rubble') {
      incident.rubbleMonthsRemaining -= 1;
      for (const tile of incident.tileIds) {
        density[tile] = 0;
        wealth[tile] = 0;
        char[tile] = 1;
      }
      if (incident.rubbleMonthsRemaining <= 0) {
        incident.rubbleMonthsRemaining = 0;
        appendHistory(history, fireMonth, incident, 'rubble-cleared');
      } else {
        incidents.push(incident);
      }
      continue;
    }

    incident.intensity = Math.min(1, Math.max(
      0,
      incident.intensity
        + rules.growth * (1 - incident.intensity)
        - rules.suppression * (suppression.get(incident.id) ?? 0),
    ));
    if (incident.intensity <= 0.02) {
      incident.intensity = 0;
      incident.damage = 0;
      incident.age = 0;
      suppressedTotal += 1;
      appendHistory(history, fireMonth, incident, 'suppressed');
      continue;
    }

    incident.age += 1;
    incident.damage += incident.intensity;
    for (const tile of incident.tileIds) {
      density[tile] = Math.max(0, (density[tile] ?? 0) - rules.burnRate * incident.intensity);
      char[tile] = Math.max(char[tile] ?? 0, Math.min(0.85, incident.damage / rules.collapseDamage));
    }

    if (incident.damage >= rules.collapseDamage) {
      incident.status = 'rubble';
      incident.intensity = 0;
      incident.rubbleMonthsRemaining = rules.rubbleMonths;
      for (const tile of incident.tileIds) {
        density[tile] = 0;
        wealth[tile] = 0;
        char[tile] = 1;
      }
      collapsedTotal += 1;
      appendHistory(history, fireMonth, incident, 'collapsed');
      incidents.push(incident);
    } else {
      appendHistory(history, fireMonth, incident, 'burning');
      incidents.push(incident);
    }
  }

  const buildingUnits = suppliedUnits ?? deriveBuildingUnits(state, deriveDensityCaps(state).densityCaps);
  const burningByTile = new Map<number, MarketFireIncident>();
  for (const incident of state.fire.incidents) {
    if (incident.status !== 'burning') continue;
    for (const tile of incident.tileIds) burningByTile.set(tile, incident);
  }
  const coverage = deriveFireStationCoverage(state);

  for (const lot of buildingUnits) {
    const tileIds = [...lot.tileIds].sort((left, right) => left - right);
    const buildingDensity = tileIds.reduce((total, tile) => total + (state.economy.density[tile] ?? 0), 0);
    if (buildingDensity <= IGNITION_DENSITY_THRESHOLD) continue;

    let hazard = rules.ignition
      * buildingDensity
      * rules.flammability[lot.zone]
      * difficulty.ignition;
    for (const neighbor of sharedBurningEdges(state, lot, burningByTile)) {
      hazard += rules.spread
        * neighbor.intensity
        * rules.spreadMultiplier[neighbor.zone]
        * difficulty.spread;
    }
    const maximumChar = tileIds.reduce((maximum, tile) => Math.max(maximum, char[tile] ?? 0), 0);
    const maximumCoverage = tileIds.reduce((maximum, tile) => Math.max(maximum, coverage[tile] ?? 0), 0);
    hazard *= 1 - rules.wetReduction * maximumChar;
    hazard /= 1 + 2.2 * maximumCoverage;
    const probability = 1 - Math.exp(-hazard);
    const originTile = tileIds[0]!;
    if (hazard <= 0 || deterministicFireRandom(originTile, fireMonth, FIRE_RANDOM_SALT) >= probability) continue;

    const incident: MarketFireIncident = {
      id: marketFireIncidentId(fireMonth, originTile),
      status: 'burning',
      tileIds,
      zone: lot.zone,
      startedMonth: fireMonth,
      structure: captureBuildingStructure({ ...lot, tileIds }),
      intensity: INITIAL_INTENSITY,
      damage: 0,
      age: 0,
      rubbleMonthsRemaining: 0,
    };
    appendHistory(history, fireMonth, incident, 'ignited');
    incidents.push(incident);
  }

  incidents.sort((left, right) => left.structure.originTile - right.structure.originTile || left.id.localeCompare(right.id));
  return {
    ...state,
    clock: { ...state.clock, month: fireMonth },
    economy: { ...state.economy, density, wealth },
    fire: { incidents, char, collapsedTotal, suppressedTotal, history },
  };
}
