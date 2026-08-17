import type {
  MarketFacilityKind,
  MarketFireDifficulty,
  MarketPowerPlantKind,
  MarketSectorValues,
  MarketZoneKind,
} from './types';

export interface MarketPlantRule {
  capacity: number;
  monthlyExpense: number;
  pollutionMultiplier: number;
  footprint: readonly [number, number];
  requiresRoad: boolean;
  waterDemand: number;
}

export const MARKET_CITY_RULES = Object.freeze({
  mapSize: 48,
  peoplePerDensity: 100,
  startingTreasury: 5_000,
  taxRate: 0.025,
  maximumIncome: 37_242,
  wealthDrift: 0.05,
  roadMonthlyExpense: 1_293,
  powerLineMonthlyExpense: 431,
  fireStationMonthlyExpense: 120_000,
  policeStationMonthlyExpense: 90_000,
  roadReach: 3,
  desirabilityRadius: 6,
  pollutionRadius: 6,
  marketShape: 0.35,
  rateUp: 0.25,
  rateDown: 0.08,
  unservedDecline: 0.05,
  desirabilityRefreshMonths: 3,
  congestionCapacity: 4,
  pollutionApproach: 0.15,
  serviceBaseline: 0.5,
  zonePowerLoad: Object.freeze({ R: 1, C: 7, I: 20 } satisfies MarketSectorValues),
  water: Object.freeze({
    coverageRadius: 7,
    demand: Object.freeze({ R: 1, C: 5, I: 50 } satisfies MarketSectorValues),
    facilities: Object.freeze({
      'water-tower': Object.freeze({ rawCapacity: 20_000, treatmentCapacity: 0 }),
      'coastal-water-pump': Object.freeze({ rawCapacity: 75_000, treatmentCapacity: 0 }),
      'water-treatment-plant': Object.freeze({ rawCapacity: 0, treatmentCapacity: 50_000 }),
    }),
  }),
  transit: Object.freeze({
    /** A 2x2 Train Station is one ordinary, atomic utility consumer. */
    trainStationPowerLoad: 20,
    trainStationWaterDemand: 50,
  }),
  waste: Object.freeze({
    generation: Object.freeze({ R: 1, C: 5, I: 20 } satisfies MarketSectorValues),
    cellMonthlyIntake: 100,
    cellStorageCapacity: 10_000,
    maximumUnmanagedPollution: 10,
  }),
  zoneEmission: Object.freeze({ R: 10, C: 25, I: 150 } satisfies MarketSectorValues),
  roadEmission: 20,
  demandJobs: Object.freeze({ C: 0.35, I: 0.60 }),
  desirabilityWeights: Object.freeze({
    R: Object.freeze({ clean: 0.40, C: 0.10, wealth: 0.25, services: 0.25 }),
    C: Object.freeze({ clean: 0.15, R: 0.45, wealth: 0.25, services: 0.15 }),
    I: Object.freeze({ clean: 0.10, I: 0.60, wealth: 0.10, services: 0.20 }),
  }),
  plants: Object.freeze({
    'coal-power-plant': Object.freeze({ capacity: 1_200, monthlyExpense: 431_000, pollutionMultiplier: 3, footprint: [2, 3] as const, requiresRoad: true, waterDemand: 2_400 }),
    'gas-power-plant': Object.freeze({ capacity: 900, monthlyExpense: 603_400, pollutionMultiplier: 1.5, footprint: [2, 3] as const, requiresRoad: true, waterDemand: 1_800 }),
    'nuclear-power-plant': Object.freeze({ capacity: 4_800, monthlyExpense: 1_724_000, pollutionMultiplier: 0, footprint: [3, 3] as const, requiresRoad: true, waterDemand: 9_600 }),
    'wind-turbine': Object.freeze({ capacity: 60, monthlyExpense: 25_860, pollutionMultiplier: 0, footprint: [1, 1] as const, requiresRoad: false, waterDemand: 0 }),
    'solar-plant': Object.freeze({ capacity: 90, monthlyExpense: 25_860, pollutionMultiplier: 0, footprint: [4, 2] as const, requiresRoad: false, waterDemand: 0 }),
  } satisfies Record<MarketPowerPlantKind, MarketPlantRule>),
  /**
   * Public safety.
   *
   * The station is a PLACE: it grants a flat height bonus inside its radius and
   * nothing else spatial. The force is a CITY-WIDE service: its funding drives
   * one crime rate for the whole map, which in turn shifts every tile's height
   * cap. One lever, one effect, no double counting.
   */
  police: Object.freeze({
    /** Matches fire exactly, so both services read as one coverage language. */
    stationRadius: 21,
    /** Height storeys granted inside the radius, regardless of the crime rate. */
    heightBonus: 1,
    /** Suppression points a station contributes each month for its base cost. */
    stationSuppression: 6,
    /** Extra suppression bought per funding step above the base. */
    fundedSuppression: 18,
    /**
     * Monthly cost of one funding step.
     *
     * A station buys 6 suppression for 90,000, so 15,000 a point. A funding
     * step buys 18 for this, so 10,000 a point: cheaper, because unlike a
     * station it grants NO height bonus and claims no land. That is the whole
     * trade. Price it at parity and the station would strictly dominate --
     * same rate, plus a storey, plus you need one anyway for funding to work --
     * and the dial would be dead UI.
     */
    fundingMonthlyExpense: 180_000,
    /**
     * Highest funding step. Demand is people per thousand, so a 200,000-person
     * city with four stations is fully suppressed at ten.
     */
    maximumFunding: 10,
    /** Derelict share a city with no police at all settles at. */
    unfundedTarget: 0.20,
    /**
     * Where a city's crime rate BEGINS, sitting mid-band of the zero modifier.
     *
     * The two obvious seeds are both wrong. Starting at the unfunded target
     * hands a brand-new city -3 storeys before it has had a chance to police
     * anything, and starting at zero hands it the clean-city +1 it did nothing
     * to earn. Neutral means crime changes no height until the player either
     * funds a force or neglects one.
     */
    neutralStart: 0.05,
    /**
     * Fraction of the remaining gap closed each month. Sets the lag: at 0.06 a
     * funding change is roughly 90% delivered after 40 months.
     */
    driftPerMonth: 0.06,
    /**
     * Height modifier by citywide derelict share. Read as: 0-5% is +1, and each
     * further 5% costs a storey down to -3.
     */
    heightSteps: Object.freeze([
      Object.freeze({ upTo: 0.025, modifier: 1 }),
      Object.freeze({ upTo: 0.075, modifier: 0 }),
      Object.freeze({ upTo: 0.125, modifier: -1 }),
      Object.freeze({ upTo: 0.175, modifier: -2 }),
      Object.freeze({ upTo: 1.000, modifier: -3 }),
    ]),
  }),
  fire: Object.freeze({
    ignition: 0.00012,
    flammability: Object.freeze({ R: 1, C: 0.8, I: 2.4 } satisfies MarketSectorValues),
    spread: 0.011,
    spreadMultiplier: Object.freeze({ R: 1, C: 0.85, I: 2 } satisfies MarketSectorValues),
    growth: 0.11,
    collapseDamage: 11,
    burnRate: 0.018,
    fullPlumeAge: 18,
    charDecay: 0.0035,
    wetReduction: 0.55,
    stationRadius: 21,
    stationPower: 0.30,
    suppression: 0.30,
    rubbleMonths: 50,
    difficulty: Object.freeze({
      easy: Object.freeze({ ignition: 0.45, spread: 0.65 }),
      normal: Object.freeze({ ignition: 1, spread: 1 }),
      hard: Object.freeze({ ignition: 2.6, spread: 1.45 }),
    } satisfies Record<MarketFireDifficulty, { ignition: number; spread: number }>),
  }),
} as const);

export const MARKET_ZONE_KINDS = Object.freeze(['R', 'C', 'I'] as const satisfies readonly MarketZoneKind[]);

export function isPowerPlant(kind: MarketFacilityKind): kind is MarketPowerPlantKind {
  return kind === 'coal-power-plant'
    || kind === 'gas-power-plant'
    || kind === 'nuclear-power-plant'
    || kind === 'wind-turbine'
    || kind === 'solar-plant';
}
