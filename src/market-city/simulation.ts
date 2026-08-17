import { crimePopulation, stepMarketCrime } from './crime';
import { stepMarketFire } from './fire';
import { deriveBuildingUnits } from './appearance';
import { clamp, solveMarketTargets } from './math';
import { isPowerPlant, MARKET_CITY_RULES, MARKET_ZONE_KINDS } from './rules';
import {
  deriveCongestion,
  deriveActiveMarketDesirability,
  deriveDensityCaps,
  derivePoliceStationOperations,
  derivePollution,
  deriveRoadAccess,
} from './spatial';
import { cloneMarketCityState } from './state';
import { derivePassengerRailService } from './transport';
import { deriveUtilities } from './utilities';
import { isWasteServiceEmpty, settleWaste } from './waste';
import type {
  MarketCityStateV2,
  MarketSectorValues,
  MarketZoneKind,
} from './types';

const OCCUPIED_EPSILON = 1e-9;
/**
 * Return the authoritative desirability field used by market bidding, fire-unit
 * grouping, inspection, and rendering. It is intentionally pure so save/restore
 * cannot change the units that receive fire rolls.
 */
export function deriveMarketDesirability(
  state: MarketCityStateV2,
  roadAccess?: readonly boolean[],
  powered?: readonly boolean[],
): number[] {
  return deriveActiveMarketDesirability(state, roadAccess, powered);
}

function sectorStocks(state: MarketCityStateV2): MarketSectorValues {
  const stocks: MarketSectorValues = { R: 0, C: 0, I: 0 };
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    const zone = state.map.zones[tile];
    if (zone !== null && zone !== undefined) stocks[zone] += state.economy.density[tile] ?? 0;
  }
  return stocks;
}

function marketDemand(
  stocks: MarketSectorValues,
  livePlantCapacity: number,
): MarketSectorValues {
  return {
    R: Math.max(
      0,
      MARKET_CITY_RULES.demandJobs.C * stocks.C
        + MARKET_CITY_RULES.demandJobs.I * stocks.I
        + livePlantCapacity / 600,
    ),
    C: Math.max(0, stocks.R),
    I: Math.max(0, stocks.R),
  };
}

function operatingExpense(state: MarketCityStateV2): number {
  let expense = state.map.roads.reduce((total, road) => total + (road ? 1 : 0), 0)
    * MARKET_CITY_RULES.roadMonthlyExpense;
  expense += state.map.avenueLanes.reduce((total, lane) => total + (lane ? 1 : 0), 0)
    * MARKET_CITY_RULES.roadMonthlyExpense;
  expense += state.map.powerLines.reduce((total, line) => total + (line ? 1 : 0), 0)
    * MARKET_CITY_RULES.powerLineMonthlyExpense;

  for (const facility of state.map.facilities) {
    if (isPowerPlant(facility.kind)) expense += MARKET_CITY_RULES.plants[facility.kind].monthlyExpense;
    else if (facility.kind === 'fire-station') expense += MARKET_CITY_RULES.fireStationMonthlyExpense;
    else if (facility.kind === 'police-station') expense += MARKET_CITY_RULES.policeStationMonthlyExpense;
  }

  // Funding is billed on exactly the condition that makes it buy suppression:
  // a force that is actually running. Charging a mayor for a budget that does
  // nothing would be a money sink with no signal, so the two gates are one.
  if (state.crime.funding > 0 && derivePoliceStationOperations(state).some(({ operational }) => operational)) {
    expense += state.crime.funding * MARKET_CITY_RULES.police.fundingMonthlyExpense;
  }
  return expense;
}

function taxRevenue(state: MarketCityStateV2): number {
  let revenue = 0;
  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    if (state.map.zones[tile] === null) continue;
    revenue += (state.economy.density[tile] ?? 0)
      * MARKET_CITY_RULES.peoplePerDensity
      * (state.economy.wealth[tile] ?? 0)
      * MARKET_CITY_RULES.taxRate;
  }
  return revenue;
}

function updateSector(
  state: MarketCityStateV2,
  sector: MarketZoneKind,
  densityCaps: readonly number[],
  desirability: readonly number[],
): void {
  const rubbleTiles = new Set(
    state.fire.incidents.filter((incident) => incident.status === 'rubble').flatMap((incident) => incident.tileIds),
  );
  const servedTiles: number[] = [];
  const values: number[] = [];
  const caps: number[] = [];

  for (let tile = 0; tile < state.map.zones.length; tile += 1) {
    if (state.map.zones[tile] !== sector) continue;
    if (rubbleTiles.has(tile)) {
      state.economy.density[tile] = 0;
      state.economy.wealth[tile] = 0;
      continue;
    }
    if (state.environment.roadAccess[tile]
      && state.environment.powered[tile]
      && state.environment.watered[tile]) {
      servedTiles.push(tile);
      values.push(desirability[tile] ?? 0);
      caps.push(densityCaps[tile] ?? 0);
      continue;
    }

    const density = clamp(
      (state.economy.density[tile] ?? 0) - MARKET_CITY_RULES.unservedDecline,
      0,
      densityCaps[tile] ?? 0,
    );
    state.economy.density[tile] = density;
    if (density <= OCCUPIED_EPSILON) {
      state.economy.density[tile] = 0;
      state.economy.wealth[tile] = 0;
    }
  }

  if (servedTiles.length === 0) return;
  const solution = solveMarketTargets(
    values,
    caps,
    state.market.demand[sector],
    MARKET_CITY_RULES.marketShape,
  );
  state.market.margin[sector] = solution.margin;

  for (let index = 0; index < servedTiles.length; index += 1) {
    const tile = servedTiles[index]!;
    const target = solution.targets[index] ?? 0;
    const current = state.economy.density[tile] ?? 0;
    const rate = target > current ? MARKET_CITY_RULES.rateUp : MARKET_CITY_RULES.rateDown;
    const density = clamp(current + rate * (target - current), 0, densityCaps[tile] ?? 0);
    state.economy.density[tile] = density;

    if (density <= OCCUPIED_EPSILON) {
      state.economy.density[tile] = 0;
      state.economy.wealth[tile] = 0;
      continue;
    }

    const wealthTarget = MARKET_CITY_RULES.maximumIncome * Math.max(0, desirability[tile] ?? 0);
    const currentWealth = state.economy.wealth[tile] ?? 0;
    state.economy.wealth[tile] = currentWealth <= 0
      ? wealthTarget * 0.5
      : Math.max(
        0,
        currentWealth + MARKET_CITY_RULES.wealthDrift * (wealthTarget - currentWealth),
      );
  }
}

function assertFiniteState(state: MarketCityStateV2): void {
  const numericFields: ReadonlyArray<readonly number[]> = [
    state.economy.density,
    state.economy.wealth,
    state.environment.pollution,
    state.environment.congestion,
    state.fire.char,
  ];
  if (numericFields.some((field) => field.some((value) => !Number.isFinite(value)))) {
    throw new Error('Market simulation produced a non-finite tile value.');
  }
  if (state.fire.incidents.some((incident) => (
    !Number.isFinite(incident.intensity)
    || !Number.isFinite(incident.damage)
    || !Number.isFinite(incident.age)
    || !Number.isFinite(incident.rubbleMonthsRemaining)
  ))) throw new Error('Market simulation produced a non-finite fire incident value.');
  const waste = state.services.waste;
  const wasteTotals = [
    waste.generatedThisMonth,
    waste.generatedLifetime,
    waste.landfilledThisMonth,
    waste.landfilledLifetime,
    waste.unmanagedThisMonth,
    waste.unmanagedLifetime,
  ];
  if (wasteTotals.some((value) => !Number.isSafeInteger(value) || value < 0)
    || waste.storedByTile.some((value) => !Number.isSafeInteger(value)
      || value < 0 || value > MARKET_CITY_RULES.waste.cellStorageCapacity)
    || waste.generatedThisMonth !== waste.landfilledThisMonth + waste.unmanagedThisMonth
    || waste.generatedLifetime !== waste.landfilledLifetime + waste.unmanagedLifetime
    || waste.storedByTile.reduce((total, value) => total + value, 0) !== waste.landfilledLifetime) {
    throw new Error('Market simulation produced invalid waste service totals.');
  }
  if (
    !Number.isFinite(state.economy.treasury)
    || !Number.isFinite(state.economy.lastRevenue)
    || !Number.isFinite(state.economy.lastOperatingExpense)
    || !Number.isFinite(state.economy.lastNet)
    || !Number.isFinite(state.services.water.totalDemand)
    || !Number.isFinite(state.services.water.totalAllocated)
    || state.services.water.totalDemand < 0
    || state.services.water.totalAllocated < 0
    || state.services.water.totalDemand > Number.MAX_SAFE_INTEGER
    || state.services.water.totalAllocated > Number.MAX_SAFE_INTEGER
    || state.services.water.components.some((component) => (
      !Number.isFinite(component.rawCapacity)
      || !Number.isFinite(component.treatmentCapacity)
      || !Number.isFinite(component.usableCapacity)
      || !Number.isFinite(component.demand)
      || !Number.isFinite(component.allocated)
      || component.rawCapacity < 0
      || component.treatmentCapacity < 0
      || component.usableCapacity < 0
      || component.demand < 0
      || component.allocated < 0
      || component.demand > Number.MAX_SAFE_INTEGER
      || component.allocated > Number.MAX_SAFE_INTEGER
      || !Number.isSafeInteger(component.rawCapacity)
      || !Number.isSafeInteger(component.treatmentCapacity)
      || !Number.isSafeInteger(component.usableCapacity)
      || component.allocated > component.demand + 1e-9
      || component.allocated > component.usableCapacity + 1e-9
    ))
    || MARKET_ZONE_KINDS.some((sector) => (
      !Number.isFinite(state.market.demand[sector])
      || !Number.isFinite(state.market.margin[sector])
    ))
  ) {
    throw new Error('Market simulation produced a non-finite aggregate value.');
  }
}

/**
 * Advance exactly one displayed month. The function is immutable: neither the
 * input state nor any of its tile arrays are changed.
 */
export function stepMonth(input: MarketCityStateV2): MarketCityStateV2 {
  let next = cloneMarketCityState(input);

  // Opening structural and environmental fields. Each conductive component
  // allocates only its local power capacity before the market moves density.
  next.environment.roadAccess = deriveRoadAccess(next);
  const openingUtilities = deriveUtilities(next);
  const power = openingUtilities.power;
  const water = openingUtilities.water;
  next.environment.powered = power.powered;
  next.environment.watered = water.watered;
  next.services.water = water.service;
  next.environment.congestion = deriveCongestion(next);
  // Collection is deliberately citywide and uses opening density. Its only
  // gameplay feedback is the bounded citywide unmanaged-waste pollution term.
  const waste = settleWaste(next);
  next.services.waste = waste.service;
  next.environment.pollution = derivePollution(
    next,
    power,
    next.environment.congestion,
    waste.pollutionAddition,
  );

  // Public safety settles BEFORE the market bids, so this month's height caps
  // reflect this month's crime rate. The share moves only a little each month,
  // so a funding change lands as a slow drift rather than a step.
  next.crime = stepMarketCrime(next);

  const stocks = sectorStocks(next);
  next.market.demand = marketDemand(stocks, power.liveCapacity);
  // The crime term now comes from the state by default, so the caps the player
  // is shown and the caps that govern development are one number.
  const { densityCaps } = deriveDensityCaps(next);
  const desirability = deriveMarketDesirability(next, next.environment.roadAccess, power.powered);

  for (const sector of MARKET_ZONE_KINDS) {
    updateSector(next, sector, densityCaps, desirability);
  }

  const revenue = taxRevenue(next);
  const expense = operatingExpense(next);
  const net = revenue - expense;
  next.economy.lastRevenue = revenue;
  next.economy.lastOperatingExpense = expense;
  next.economy.lastNet = net;
  next.economy.treasury += net;

  next = stepMarketFire(next, deriveBuildingUnits(next, densityCaps));
  // Fire can change zoned density. Re-derive the closing utility sequence so
  // every station gate observes the same post-settlement allocation that gets
  // persisted for the next month.
  let closingUtilities = deriveUtilities(next);
  next.environment.powered = closingUtilities.power.powered;
  next.environment.watered = closingUtilities.water.watered;
  next.services.water = closingUtilities.water.service;
  closingUtilities = deriveUtilities(next);
  const closingPower = closingUtilities.power;
  const closingWater = closingUtilities.water;
  next.environment.powered = closingPower.powered;
  next.environment.watered = closingWater.watered;
  next.services.water = closingWater.service;
  const trainStationCount = next.map.facilities.reduce(
    (count, facility) => count + (facility.kind === 'train-station' ? 1 : 0),
    0,
  );
  if (trainStationCount >= 2 && next.map.rails.some(Boolean)) {
    next.services.rail = derivePassengerRailService(next, closingPower, closingWater).service;
  } else if (next.services.rail.totalRidership !== 0
    || next.services.rail.stationUsage.length > 0) {
    next.services.rail = {
      totalRidership: 0,
      tileUsage: Array<number>(next.map.rails.length).fill(0),
      stationUsage: [],
    };
  }
  assertFiniteState(next);
  return next;
}

function isCompletelyInert(state: MarketCityStateV2): boolean {
  const noNumber = (values: readonly number[]): boolean => values.every((value) => value === 0);
  const noBoolean = (values: readonly boolean[]): boolean => values.every((value) => !value);
  return state.map.zones.every((zone) => zone === null)
    && noBoolean(state.map.roads)
    && noBoolean(state.map.avenueLanes)
    && noBoolean(state.map.rails)
    && noBoolean(state.map.powerLines)
    && noBoolean(state.map.waterPipes)
    && noBoolean(state.map.landfillZones)
    && state.map.facilities.length === 0
    && noNumber(state.economy.density)
    && noNumber(state.economy.wealth)
    && state.economy.lastRevenue === 0
    && state.economy.lastOperatingExpense === 0
    && state.economy.lastNet === 0
    && noNumber(state.environment.pollution)
    && noNumber(state.environment.congestion)
    && noBoolean(state.environment.roadAccess)
    && noBoolean(state.environment.powered)
    && noBoolean(state.environment.watered)
    && state.fire.incidents.length === 0
    && noNumber(state.fire.char)
    && state.market.demand.R === 0
    && state.market.demand.C === 0
    && state.market.demand.I === 0
    && state.market.margin.R === 0
    && state.market.margin.C === 0
    && state.market.margin.I === 0
    && isWasteServiceEmpty(state.services.waste);
}

/** Advance a deterministic number of displayed months. */
export function stepMonths(
  input: MarketCityStateV2,
  months: number,
): MarketCityStateV2 {
  if (!Number.isInteger(months) || months < 0) {
    throw new RangeError(`Months must be a non-negative integer; received ${months}.`);
  }
  // This is exactly equivalent to repeated steps for a pristine empty map and
  // keeps the mandatory long deterministic soak a useful scheduler/hash test
  // rather than spending its time diffusing a field of zeroes.
  if (months > 0 && isCompletelyInert(input)) {
    const state = cloneMarketCityState(input);
    state.clock.month += months;
    return state;
  }
  let state = input;
  for (let month = 0; month < months; month += 1) state = stepMonth(state);
  return state;
}
