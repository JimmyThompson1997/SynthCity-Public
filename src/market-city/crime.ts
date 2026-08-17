import { mix32, orthogonalNeighbors } from './math';
import { MARKET_CITY_RULES } from './rules';
import { derivePoliceStationOperations } from './spatial';
import type { MarketCityCrime, MarketCityStateV2 } from './types';

/**
 * Public safety — one citywide crime rate, and the derelict buildings that make
 * it visible.
 *
 * WHY A CONTROLLER AND NOT AN EPIDEMIC
 * ------------------------------------
 * An earlier prototype ran a full contagion per tile: infection rate, recovery
 * rate, refractory windows, R0. It produced good-looking waves and was almost
 * impossible to aim — hitting a stated target like "20% derelict when unfunded"
 * meant solving an equilibrium backwards and re-tuning every time the map
 * changed shape, because the lattice geometry moved the answer.
 *
 * This drives the number directly instead. Funding sets a TARGET share, the
 * live share walks toward it a little each month, and tiles are tipped or
 * recovered to track it. The look survives because tipping prefers neighbours
 * of existing derelicts, so blight still spreads in patches rather than
 * scattering; only the aggregate is pinned.
 *
 * THE LADDER
 *   supply   = stations x stationSuppression + funding x fundedSuppression
 *   demand   = population / 1000
 *   coverage = supply / demand
 *   target   = 20% x (1 - coverage)
 *
 * So a city with no police at all settles at 20% derelict, and one whose
 * funding matches its population settles at zero. Everything between is linear.
 *
 * Changing funding never moves the rate immediately. It moves the target; the
 * city then takes years to get there, which is what makes a funding decision
 * something you commit to rather than toggle.
 */

const CRIME_TIP_SALT = 7;
const CRIME_RECOVER_SALT = 11;

/** Deterministic draw in [0,1), keyed only by tile, month and salt. */
export function deterministicCrimeRandom(tile: number, month: number, salt: number): number {
  const key = (
    Math.imul(tile, 73_856_093)
    ^ Math.imul(month, 19_349_663)
    ^ Math.imul(salt, 83_492_791)
  ) >>> 0;
  return mix32(key) / 4_294_967_296;
}

export function createMarketCrime(tileCount: number): MarketCityCrime {
  return {
    derelict: Array<boolean>(tileCount).fill(false),
    share: MARKET_CITY_RULES.police.neutralStart,
    targetShare: 0,
    funding: 0,
    tippedTotal: 0,
    recoveredTotal: 0,
  };
}

export function cloneMarketCrime(crime: MarketCityCrime): MarketCityCrime {
  return { ...crime, derelict: [...crime.derelict] };
}

function isBuilt(state: MarketCityStateV2, tile: number): boolean {
  return state.map.zones[tile] !== null && (state.economy.density[tile] ?? 0) > 0;
}

export function builtTileCount(state: MarketCityStateV2): number {
  let total = 0;
  for (let tile = 0; tile < state.map.zones.length; tile += 1) if (isBuilt(state, tile)) total += 1;
  return total;
}

export function crimePopulation(state: MarketCityStateV2): number {
  let people = 0;
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    if (state.map.zones[tile] === null) continue;
    people += (state.economy.density[tile] ?? 0) * MARKET_CITY_RULES.peoplePerDensity;
  }
  return people;
}

export interface MarketCrimeBalance {
  /**
   * Always true once the city has people. Crime is a condition of having a
   * city, not a system the player opts into: an unpoliced city runs at the
   * full unfunded rate from its first month.
   *
   * The height floor is what makes that survivable — a cap can never fall
   * below one storey, so the worst a neglected city suffers is losing every
   * bonus it earned, not being unable to build at all.
   */
  active: boolean;
  population: number;
  demand: number;
  stationSupply: number;
  fundedSupply: number;
  supply: number;
  coverage: number;
  targetShare: number;
  operationalStations: number;
}

/** The whole ladder, exposed so the dashboard can show its working. */
export function deriveCrimeBalance(
  state: MarketCityStateV2,
  funding = state.crime.funding,
): MarketCrimeBalance {
  const rules = MARKET_CITY_RULES.police;
  const population = crimePopulation(state);
  const demand = population / 1_000;
  const operationalStations = derivePoliceStationOperations(state)
    .filter((station) => station.operational).length;
  const stationSupply = operationalStations * rules.stationSuppression;
  // Funding only buys anything if there is a force to fund.
  const fundedSupply = operationalStations > 0
    ? Math.max(0, funding) * rules.fundedSuppression
    : 0;
  const supply = stationSupply + fundedSupply;
  const active = demand > 0;
  const coverage = demand > 0 ? supply / demand : 1;
  const targetShare = active
    ? rules.unfundedTarget * Math.max(0, 1 - coverage)
    : 0;
  return {
    active, population, demand, stationSupply, fundedSupply, supply,
    coverage, targetShare, operationalStations,
  };
}

/**
 * Advance public safety one month.
 *
 * Immutable: returns a new crime record and never touches the rest of state.
 */
export function stepMarketCrime(state: MarketCityStateV2): MarketCityCrime {
  const rules = MARKET_CITY_RULES.police;
  const crime = cloneMarketCrime(state.crime);
  const month = state.clock.month + 1;
  const count = state.map.zones.length;

  const built: number[] = [];
  for (let tile = 0; tile < count; tile += 1) {
    if (isBuilt(state, tile)) built.push(tile);
    else if (crime.derelict[tile]) {
      // A lot that lost its building cannot stay a derelict building.
      crime.derelict[tile] = false;
      crime.recoveredTotal += 1;
    }
  }

  const balance = deriveCrimeBalance(state);
  crime.targetShare = balance.targetShare;

  if (built.length === 0) {
    // Nothing standing is not the same as nothing wrong. Holding at neutral
    // means a city that clears its map begins again from neutral rather than
    // collecting the spotless bonus for having no buildings to blight.
    crime.share = rules.neutralStart;
    return crime;
  }

  // THE RATE IS CONTINUOUS; THE TILES ONLY APPROXIMATE IT.
  //
  // Deriving the rate from a rounded tile count made small cities read as
  // spotless: twenty percent of one building rounds to zero derelicts, so the
  // city measured 0% and collected the clean-city height bonus it had done
  // nothing to earn. The share is therefore its own number, drifting toward the
  // target, and the tiles are tipped afterwards to match it as closely as whole
  // buildings allow.
  crime.share += rules.driftPerMonth * (balance.targetShare - crime.share);
  if (Math.abs(crime.share - balance.targetShare) < 1e-6) crime.share = balance.targetShare;
  crime.share = Math.max(0, Math.min(1, crime.share));

  const derelictNow = built.filter((tile) => crime.derelict[tile] === true);
  const wantDerelict = Math.round(crime.share * built.length);

  if (derelictNow.length < wantDerelict) {
    const derelictSet = new Set(derelictNow);
    const healthy = built.filter((tile) => !derelictSet.has(tile));
    // Tipping prefers lots that already touch blight, which keeps the spread
    // reading as patches on the map instead of random speckle.
    const scored = healthy.map((tile) => {
      let touching = 0;
      for (const neighbour of orthogonalNeighbors(tile, state.map.size)) {
        if (derelictSet.has(neighbour)) touching += 1;
      }
      return { tile, score: touching * 2 + deterministicCrimeRandom(tile, month, CRIME_TIP_SALT) };
    });
    scored.sort((left, right) => right.score - left.score || left.tile - right.tile);
    const wanted = wantDerelict - derelictNow.length;
    for (let index = 0; index < wanted && index < scored.length; index += 1) {
      crime.derelict[scored[index]!.tile] = true;
      crime.tippedTotal += 1;
    }
  } else if (derelictNow.length > wantDerelict) {
    const derelictSet = new Set(derelictNow);
    // Recovery starts at the edges of a patch, so blight retreats inward.
    const scored = derelictNow.map((tile) => {
      let touching = 0;
      for (const neighbour of orthogonalNeighbors(tile, state.map.size)) {
        if (derelictSet.has(neighbour)) touching += 1;
      }
      return { tile, score: touching * 2 + deterministicCrimeRandom(tile, month, CRIME_RECOVER_SALT) };
    });
    scored.sort((left, right) => left.score - right.score || left.tile - right.tile);
    const wanted = derelictNow.length - wantDerelict;
    for (let index = 0; index < wanted && index < scored.length; index += 1) {
      crime.derelict[scored[index]!.tile] = false;
      crime.recoveredTotal += 1;
    }
  }

  return crime;
}

export function derelictShare(state: MarketCityStateV2): number {
  return state.crime.share;
}
