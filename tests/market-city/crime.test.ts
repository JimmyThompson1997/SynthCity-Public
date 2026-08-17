import { describe, expect, it } from 'vitest';

import {
  createMarketCrime,
  crimePopulation,
  deriveCrimeBalance,
  stepMarketCrime,
} from '../../src/market-city/crime';
import { coordinateToIndex, manhattanDistance } from '../../src/market-city/math';
import { MARKET_CITY_RULES } from '../../src/market-city/rules';
import { applyWorldCommand } from '../../src/market-city/commands';
import { stepMonth } from '../../src/market-city/simulation';
import { createMarketCityState } from '../../src/market-city/state';
import {
  crimeHeightModifier,
  deriveDensityCaps,
  deriveHeightStack,
  derivePoliceCoverage,
  derivePoliceStationOperations,
} from '../../src/market-city/spatial';
import { MARKET_CITY_MAP_SIZE, type MarketCityStateV2 } from '../../src/market-city/types';

const tile = (x: number, y: number): number => coordinateToIndex(x, y, MARKET_CITY_MAP_SIZE);
const rules = MARKET_CITY_RULES.police;

function state(): MarketCityStateV2 {
  return createMarketCityState({
    cityId: 'crime-model',
    cityName: 'Crime Model',
    mayorName: 'Test Mayor',
    seed: 61,
    createdAt: '2026-08-15T00:00:00.000Z',
  });
}

/**
 * A populated block, which is what gives the force something to police.
 *
 * Size matters here. Demand is people per thousand, and one station supplies
 * six, so a small block is policed to zero by a single station and funding
 * shows no gradient at all. This block runs a demand well above one station.
 */
function populate(value: MarketCityStateV2, count = 120): void {
  for (let index = 0; index < count; index += 1) {
    const spot = tile(4 + (index % 10), 30 + Math.floor(index / 10));
    value.map.zones[spot] = 'R';
    value.economy.density[spot] = 1;
    value.economy.wealth[spot] = 10_000;
  }
}

/** A station that is both road served and powered, so it actually counts. */
function policeStation(value: MarketCityStateV2, anchor: number): void {
  const size = value.map.size;
  const x = anchor % size;
  const y = Math.floor(anchor / size);
  value.map.facilities.push({
    id: `police-${x}-${y}`, kind: 'police-station', anchor, tiles: [anchor],
  });
  value.map.roads[tile(x + 2, y)] = true;
  const plant = tile(x + 1, y);
  value.map.facilities.push({
    id: `supply-${x}-${y}`, kind: 'wind-turbine', anchor: plant, tiles: [plant],
  });
}

/** Run the crime controller forward without running the whole economy. */
function runMonths(value: MarketCityStateV2, months: number): MarketCityStateV2 {
  let current = value;
  for (let month = 0; month < months; month += 1) {
    current = { ...current, crime: stepMarketCrime(current), clock: { ...current.clock, month: current.clock.month + 1 } };
  }
  return current;
}

describe('crime rate', () => {
  it('starts a new city neutral rather than spotless or blighted', () => {
    // The two obvious seeds are both wrong, and both were shipped and caught:
    // zero hands every new city a height bonus it did not earn, and the
    // unfunded target hands it -3 storeys before it can build a station.
    expect(createMarketCrime(16).share).toBe(rules.neutralStart);
    expect(crimeHeightModifier(rules.neutralStart)).toBe(0);

    const value = state();
    populate(value);
    const stack = deriveHeightStack(value, value.crime.share)[tile(4, 30)]!;
    expect(stack.crime).toBe(0);
    expect(stack.total).toBe(stack.base);
  });

  it('is always on: an unpoliced city drifts toward the unfunded target', () => {
    const value = state();
    populate(value);
    expect(deriveCrimeBalance(value).targetShare).toBeCloseTo(rules.unfundedTarget, 8);

    const early = runMonths(value, 6);
    const late = runMonths(value, 200);
    expect(early.crime.share).toBeGreaterThan(rules.neutralStart);
    expect(early.crime.share).toBeLessThan(rules.unfundedTarget);
    expect(late.crime.share).toBeCloseTo(rules.unfundedTarget, 3);
    expect(crimeHeightModifier(late.crime.share)).toBe(-3);
  });

  it('moves the rate by drift, never by step, when funding changes', () => {
    const value = state();
    populate(value);
    const settled = runMonths(value, 200);
    expect(settled.crime.share).toBeCloseTo(rules.unfundedTarget, 3);

    policeStation(settled, tile(20, 20));
    const funded = { ...settled, crime: { ...settled.crime, funding: 4 } };
    expect(deriveCrimeBalance(funded).targetShare).toBe(0);

    // The month the cheque is written, the rate has barely moved.
    const next = runMonths(funded, 1);
    expect(next.crime.share).toBeLessThan(settled.crime.share);
    expect(next.crime.share).toBeGreaterThan(settled.crime.share * 0.9);
    expect(crimeHeightModifier(next.crime.share)).toBe(-3);

    // Only sustained funding buys the clean-city bonus.
    const patient = runMonths(funded, 120);
    expect(patient.crime.share).toBeLessThan(0.025);
    expect(crimeHeightModifier(patient.crime.share)).toBe(1);
  });

  it('never lets crime push a height cap below one storey', () => {
    const value = state();
    populate(value);
    value.market.verticalDevelopmentLevel = 2;
    const ruined = runMonths(value, 400);
    expect(crimeHeightModifier(ruined.crime.share)).toBe(-3);

    const stack = deriveHeightStack(ruined, ruined.crime.share)[tile(4, 30)]!;
    expect(stack.base + stack.crime).toBeLessThan(1);
    expect(stack.total).toBe(1);
    expect(deriveDensityCaps(ruined, ruined.crime.share).heightCaps[tile(4, 30)]).toBe(1);
  });

  it('shows the player the same cap that governs development', () => {
    // Found by playing: the crime term was an optional argument defaulting to
    // neutral, and only the simulation passed it. The inspector, the height-cap
    // view and both queries therefore showed a cap the city would never build
    // to. At level 1 the one-storey floor hid the gap entirely.
    const value = state();
    populate(value);
    const lot = tile(20, 5);
    value.map.zones[lot] = 'R';
    value.market.verticalDevelopmentLevel = 6;
    const blighted = runMonths(value, 400);
    expect(blighted.crime.share).toBeCloseTo(rules.unfundedTarget, 3);

    const shown = deriveDensityCaps(blighted).heightCaps[lot];
    const governing = deriveDensityCaps(blighted, blighted.crime.share).heightCaps[lot];
    expect(shown).toBe(governing);
    expect(shown).toBe(6 + crimeHeightModifier(blighted.crime.share));

    // An empty map still reads neutral rather than collecting the clean bonus.
    expect(deriveDensityCaps(state()).heightCaps[tile(20, 5)]).toBe(0);
  });

  it('has no crime to measure on an empty map', () => {
    const value = state();
    expect(crimePopulation(value)).toBe(0);
    expect(deriveCrimeBalance(value).active).toBe(false);
    expect(deriveHeightStack(value, null)[tile(4, 30)]!.crime).toBe(0);
  });
});

describe('force budget', () => {
  it('is a whole step within the reachable range, and rejects anything else', () => {
    const value = state();
    policeStation(value, tile(20, 20));
    expect(applyWorldCommand(value, { type: 'set-crime-funding', funding: 4 }).ok).toBe(true);
    expect(applyWorldCommand(value, { type: 'set-crime-funding', funding: -1 }).ok).toBe(false);
    expect(applyWorldCommand(value, { type: 'set-crime-funding', funding: 2.5 }).ok).toBe(false);
    expect(applyWorldCommand(value, {
      type: 'set-crime-funding', funding: rules.maximumFunding + 1,
    }).ok).toBe(false);

    // The ceiling has to be reachable: demand is people per thousand, so the
    // dial must be able to suppress a genuinely large city.
    const huge = state();
    policeStation(huge, tile(45, 45));
    for (let index = 0; index < 1_600; index += 1) {
      const spot = tile(2 + (index % 40), 2 + Math.floor(index / 40));
      huge.map.zones[spot] = 'R';
      huge.economy.density[spot] = 1;
    }
    expect(crimePopulation(huge)).toBeGreaterThan(100_000);
    expect(deriveCrimeBalance(huge, rules.maximumFunding).targetShare).toBe(0);
  });

  it('bills only while there is a force to fund', () => {
    const unstaffed = state();
    populate(unstaffed);
    unstaffed.crime.funding = 5;
    const idle = stepMonth(unstaffed);
    const idleCost = idle.economy.lastOperatingExpense;

    const staffed = state();
    populate(staffed);
    policeStation(staffed, tile(20, 20));
    staffed.crime.funding = 5;
    const running = stepMonth(staffed);

    // Funding with nowhere to spend it is free, exactly as it is useless.
    expect(idle.crime.funding).toBe(5);
    expect(running.economy.lastOperatingExpense - idleCost).toBe(
      MARKET_CITY_RULES.policeStationMonthlyExpense
      + 5 * rules.fundingMonthlyExpense
      + MARKET_CITY_RULES.plants['wind-turbine'].monthlyExpense
      + MARKET_CITY_RULES.roadMonthlyExpense,
    );
  });

  it('prices a funding step below a station per point of suppression', () => {
    // The trade is deliberate: a station also grants a storey and claims land,
    // so funding has to be cheaper per point or nobody would ever use it.
    const perStationPoint = MARKET_CITY_RULES.policeStationMonthlyExpense / rules.stationSuppression;
    const perFundedPoint = rules.fundingMonthlyExpense / rules.fundedSuppression;
    expect(perFundedPoint).toBeLessThan(perStationPoint);
  });
});

describe('police station', () => {
  it('grants one storey inside a Manhattan radius that matches fire exactly', () => {
    expect(rules.stationRadius).toBe(MARKET_CITY_RULES.fire.stationRadius);

    const value = state();
    const anchor = tile(20, 20);
    policeStation(value, anchor);
    const coverage = derivePoliceCoverage(value);

    const inside = tile(20 + rules.stationRadius, 20);
    const outside = tile(20 + rules.stationRadius + 1, 20);
    expect(manhattanDistance(anchor, inside, value.map.size)).toBe(rules.stationRadius);
    expect(coverage[inside]).toBe(true);
    expect(coverage[outside]).toBe(false);

    const stacks = deriveHeightStack(value, rules.neutralStart);
    expect(stacks[inside]!.police).toBe(rules.heightBonus);
    expect(stacks[outside]!.police).toBe(0);
  });

  it('does not stack two overlapping stations', () => {
    const value = state();
    policeStation(value, tile(18, 20));
    policeStation(value, tile(22, 20));
    const overlap = tile(20, 20);
    expect(derivePoliceCoverage(value)[overlap]).toBe(true);
    expect(deriveHeightStack(value, rules.neutralStart)[overlap]!.police).toBe(rules.heightBonus);
  });

  it('needs a road and power before it covers anything or suppresses crime', () => {
    const roadless = state();
    populate(roadless);
    const anchor = tile(20, 20);
    policeStation(roadless, anchor);
    roadless.map.roads[tile(22, 20)] = false;
    expect(derivePoliceStationOperations(roadless)[0]!.operational).toBe(false);
    expect(derivePoliceCoverage(roadless)[anchor]).toBe(false);
    expect(deriveCrimeBalance(roadless).operationalStations).toBe(0);

    const dark = state();
    populate(dark);
    policeStation(dark, anchor);
    dark.map.facilities = dark.map.facilities.filter(({ kind }) => kind !== 'wind-turbine');
    const operation = derivePoliceStationOperations(dark)[0]!;
    expect(operation.operational).toBe(false);
    expect(operation.inactiveReason).toBe('No power.');
    expect(derivePoliceCoverage(dark)[anchor]).toBe(false);

    const live = state();
    populate(live);
    policeStation(live, anchor);
    expect(derivePoliceStationOperations(live)[0]!.operational).toBe(true);
    expect(derivePoliceCoverage(live)[anchor]).toBe(true);
    expect(deriveCrimeBalance(live).operationalStations).toBe(1);
  });

  it('buys suppression only while it is funded and staffed', () => {
    const value = state();
    populate(value);
    const unpoliced = deriveCrimeBalance(value);
    expect(unpoliced.supply).toBe(0);

    policeStation(value, tile(20, 20));
    const staffed = deriveCrimeBalance(value);
    expect(staffed.stationSupply).toBe(rules.stationSuppression);
    expect(staffed.fundedSupply).toBe(0);

    const funded = deriveCrimeBalance(value, 2);
    expect(funded.fundedSupply).toBe(2 * rules.fundedSuppression);
    expect(funded.targetShare).toBeLessThan(staffed.targetShare);

    // Funding with no station to spend it on buys nothing.
    const empty = state();
    populate(empty);
    expect(deriveCrimeBalance(empty, 5).fundedSupply).toBe(0);
    expect(deriveCrimeBalance(empty, 5).targetShare).toBeCloseTo(rules.unfundedTarget, 8);
  });
});
