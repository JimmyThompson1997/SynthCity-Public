import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { deriveFireStationCoverage } from '../src/market-city/fire';
import { deriveMarketView } from '../src/market-city/queries';
import { MARKET_CITY_RULES } from '../src/market-city/rules';
import {
  MARKET_MAP_FIXTURE_IDS,
  assertScenarioStateIsValid,
  buildCiFirstScenario,
  buildFireCoverageScenario,
  buildLandShortageScenario,
  buildNoBootstrapScenario,
  buildOneCoalEquilibriumScenario,
  buildPlantComparisonScenario,
  buildPollutionRelocationScenario,
  buildPowerSeveranceScenario,
  buildResidentialBootstrapScenario,
  createMarketMapFixture,
  releaseSlurpCapacity,
  repairPowerSeverance,
  runDeterministicCheckpointTrace,
  sectorStocks,
  severScenarioPower,
  summarizeScenarioState,
} from '../src/market-city/scenarios';
import { stepMonth, stepMonths } from '../src/market-city/simulation';
import { derivePower } from '../src/market-city/spatial';
import { hashDeterministicState } from '../src/market-city/state';
import {
  MARKET_CITY_RULES_VERSION,
  type MarketCityStateV2,
  type MarketPowerPlantKind,
} from '../src/market-city/types';

interface ProofResult {
  id: string;
  pass: boolean;
  elapsedMs: number;
  evidence: unknown;
  error?: string;
}

interface ScenarioReport {
  rulesVersion: string;
  generatedAt: string;
  node: string;
  platform: string;
  fullActiveSoak: boolean;
  pass: boolean;
  results: ProofResult[];
}

interface PerformanceProofEvidence {
  sampleCount: number;
  medianElapsedMs: number;
  slowestElapsedMs: number;
}

const results: ProofResult[] = [];

function requireProof(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function proof(id: string, run: () => unknown | Promise<unknown>): Promise<void> {
  const started = performance.now();
  try {
    const evidence = await run();
    results.push({ id, pass: true, elapsedMs: performance.now() - started, evidence });
  } catch (error) {
    results.push({
      id,
      pass: false,
      elapsedMs: performance.now() - started,
      evidence: null,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

function proofRuntimeLabel(result: ProofResult): string {
  if (result.id !== '1200-month-performance' || result.evidence === null) {
    return `${result.elapsedMs.toFixed(1)} ms`;
  }
  const evidence = result.evidence as PerformanceProofEvidence;
  return `${evidence.medianElapsedMs.toFixed(1)} ms median / ${evidence.slowestElapsedMs.toFixed(1)} ms max (${evidence.sampleCount} samples)`;
}

function average(tileIds: readonly number[], values: readonly number[]): number {
  return tileIds.reduce((sum, tile) => sum + (values[tile] ?? 0), 0) / Math.max(1, tileIds.length);
}

function activeSoakInitial(): MarketCityStateV2 {
  return buildLandShortageScenario().state;
}

const fullActiveSoak = process.env.MARKET_CITY_FULL_SOAK === '1';
const performanceSampleCount = 3;
const performanceMedianBudgetMs = 10_000;
const performanceHardCeilingMs = 15_000;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor(sorted.length / 2)]!;
}

await proof('map-fixtures', () => {
  const fixtures = MARKET_MAP_FIXTURE_IDS.map((id) => {
    const state = createMarketMapFixture(id, 44);
    const duplicate = createMarketMapFixture(id, 44);
    requireProof(hashDeterministicState(state) === hashDeterministicState(duplicate), `${id} is not deterministic`);
    return {
      id,
      hash: hashDeterministicState(state),
      waterTiles: state.map.terrain.water.filter(Boolean).length,
      minimumElevation: Math.min(...state.map.terrain.elevation),
      maximumElevation: Math.max(...state.map.terrain.elevation),
    };
  });
  requireProof(new Set(fixtures.map(({ hash }) => hash)).size === fixtures.length, 'fixture hashes are not unique');
  return fixtures;
});

await proof('no-bootstrap', () => {
  const after = stepMonths(buildNoBootstrapScenario().state, 24);
  const stocks = sectorStocks(after);
  requireProof(stocks.R === 0 && stocks.C === 0 && stocks.I === 0, 'unpowered RCI activity bootstrapped itself');
  return summarizeScenarioState(after);
});

await proof('residential-bootstrap', () => {
  const start = buildResidentialBootstrapScenario().state;
  const monthOne = stepMonth(start);
  const monthTwo = stepMonth(monthOne);
  requireProof(sectorStocks(monthOne).R > 0, 'residential did not bootstrap from the live plant');
  requireProof(sectorStocks(monthOne).C === 0 && sectorStocks(monthOne).I === 0, 'C or I bootstrapped too early');
  requireProof(sectorStocks(monthTwo).C > 0 && sectorStocks(monthTwo).I > 0, 'C and I did not respond to residents');
  return { monthOne: summarizeScenarioState(monthOne), monthTwo: summarizeScenarioState(monthTwo) };
});

await proof('c-and-i-first', () => {
  const c = buildCiFirstScenario('C');
  const i = buildCiFirstScenario('I');
  const cIdle = stepMonths(c.beforeResidential, 12);
  const iIdle = stepMonths(i.beforeResidential, 12);
  const cActive = stepMonths(c.afterResidential, 4);
  const iActive = stepMonths(i.afterResidential, 4);
  requireProof(sectorStocks(cIdle).C === 0 && sectorStocks(iIdle).I === 0, 'C/I-only opening did not remain idle');
  requireProof(sectorStocks(cActive).C > 0 && sectorStocks(iActive).I > 0, 'C/I did not activate after R');
  return {
    cIdle: summarizeScenarioState(cIdle),
    iIdle: summarizeScenarioState(iIdle),
    cActive: summarizeScenarioState(cActive),
    iActive: summarizeScenarioState(iActive),
  };
});

await proof('one-coal-equilibrium', () => {
  const after = stepMonths(buildOneCoalEquilibriumScenario().state, 450);
  const stocks = sectorStocks(after);
  requireProof(Math.abs(stocks.R - 40) < 5, `R=${stocks.R} is not near 40`);
  requireProof(Math.abs(stocks.C - 40) < 5, `C=${stocks.C} is not near 40`);
  requireProof(Math.abs(stocks.I - 40) < 5, `I=${stocks.I} is not near 40`);
  return summarizeScenarioState(after);
});

await proof('land-shortage-and-slurp', () => {
  const scarce = stepMonths(buildLandShortageScenario().state, 180);
  const before = deriveMarketView(scarce);
  requireProof(before.R.want > before.R.availableCapacity, 'land-shortage demand did not exceed capacity');
  requireProof(Math.abs(before.R.have - before.R.availableCapacity) < 0.001, 'scarce R capacity did not fill');
  const release = releaseSlurpCapacity(scarce);
  const after = stepMonths(release.state, 36);
  requireProof(sectorStocks(after).R > sectorStocks(scarce).R + 0.25, 'released capacity did not slurp unmet R demand');
  return {
    before: summarizeScenarioState(scarce),
    after: summarizeScenarioState(after),
    releasedTileCount: release.releasedTileIds.length,
    newlyOccupied: release.releasedTileIds.filter((tile) => after.economy.density[tile]! > 0).length,
  };
});

await proof('pollution-relocation', () => {
  const scenario = buildPollutionRelocationScenario();
  const after = stepMonths(scenario.state, 180);
  const dirtyPollution = average(scenario.dirtyResidential, after.environment.pollution);
  const cleanPollution = average(scenario.cleanResidential, after.environment.pollution);
  const dirtyDensity = average(scenario.dirtyResidential, after.economy.density);
  const cleanDensity = average(scenario.cleanResidential, after.economy.density);
  requireProof(dirtyPollution > cleanPollution, 'dirty district is not more polluted');
  requireProof(cleanDensity > dirtyDensity, 'residential activity did not relocate toward cleaner land');
  return { dirtyPollution, cleanPollution, dirtyDensity, cleanDensity, state: summarizeScenarioState(after) };
});

await proof('plant-comparison', () => {
  const kinds: MarketPowerPlantKind[] = [
    'coal-power-plant',
    'gas-power-plant',
    'nuclear-power-plant',
    'wind-turbine',
    'solar-plant',
  ];
  const comparisons = kinds.map((kind) => {
    const scenario = buildPlantComparisonScenario(kind);
    const after = stepMonth(scenario.state);
    const power = derivePower(after);
    const pollutionTotal = after.environment.pollution.reduce((sum, value) => sum + value, 0);
    const plantAnchor = scenario.state.map.facilities[0]!.anchor;
    const plantSitePollution = after.environment.pollution[plantAnchor]!;
    const hasRenewableWaterBootstrap = scenario.state.map.facilities.some(({ id }) => id === 'scenario-water-bootstrap');
    const bootstrap = hasRenewableWaterBootstrap ? MARKET_CITY_RULES.plants['wind-turbine'] : null;
    const expectedExpense = MARKET_CITY_RULES.plants[kind].monthlyExpense
      + (bootstrap?.monthlyExpense ?? 0)
      + scenario.roadTileCount * MARKET_CITY_RULES.roadMonthlyExpense
      + scenario.powerLineTileCount * MARKET_CITY_RULES.powerLineMonthlyExpense;
    requireProof(
      power.liveCapacity === MARKET_CITY_RULES.plants[kind].capacity + (bootstrap?.capacity ?? 0),
      `${kind} capacity mismatch`,
    );
    requireProof(after.economy.lastOperatingExpense === expectedExpense, `${kind} cost mismatch`);
    return { kind, capacity: power.liveCapacity, expense: expectedExpense, pollutionTotal, plantSitePollution };
  });
  const pollution = Object.fromEntries(comparisons.map(({ kind, pollutionTotal }) => [kind, pollutionTotal]));
  requireProof(pollution['coal-power-plant']! > pollution['gas-power-plant']!, 'coal is not dirtier than gas');
  requireProof(pollution['gas-power-plant']! > pollution['nuclear-power-plant']!, 'gas is not dirtier than nuclear');
  requireProof(Math.abs(pollution['nuclear-power-plant']! - pollution['wind-turbine']!) < 1e-12, 'zero-pollution plants disagree');
  requireProof(Math.abs(pollution['nuclear-power-plant']! - pollution['solar-plant']!) < 1e-12, 'zero-pollution plants disagree');
  const plantSitePollution = Object.fromEntries(comparisons.map(({ kind, plantSitePollution }) => [kind, plantSitePollution]));
  requireProof(plantSitePollution['coal-power-plant']! > plantSitePollution['gas-power-plant']!, 'coal plant-site pollution is not above gas');
  requireProof(plantSitePollution['nuclear-power-plant'] === 0, 'nuclear plant-site pollution is nonzero');
  requireProof(plantSitePollution['wind-turbine'] === 0, 'wind plant-site pollution is nonzero');
  requireProof(plantSitePollution['solar-plant'] === 0, 'solar plant-site pollution is nonzero');
  return comparisons;
});

await proof('power-severance-and-repair', () => {
  const scenario = buildPowerSeveranceScenario();
  const developed = stepMonths(scenario.state, 24);
  const severed = severScenarioPower(developed, scenario.severTile);
  const during = stepMonths(severed, 4);
  requireProof(!derivePower(during).powered[scenario.representativeZoneTile], 'severed zone remains powered');
  requireProof(sectorStocks(during).R < sectorStocks(developed).R, 'severed zone did not decline');
  const repaired = repairPowerSeverance(during, scenario.severTile);
  const recovered = stepMonths(repaired, 12);
  requireProof(derivePower(recovered).powered[scenario.representativeZoneTile]!, 'repaired zone remains unpowered');
  requireProof(sectorStocks(recovered).R > sectorStocks(during).R, 'repaired zone did not recover');
  return {
    developed: summarizeScenarioState(developed),
    during: summarizeScenarioState(during),
    recovered: summarizeScenarioState(recovered),
  };
});

await proof('seeded-fire-coverage', () => {
  const isolated = buildFireCoverageScenario(1);
  const overloaded = buildFireCoverageScenario(4);
  const isolatedCoverage = deriveFireStationCoverage(isolated.state)[isolated.fireTileIds[0]!]!;
  const overloadedCoverage = deriveFireStationCoverage(overloaded.state)[overloaded.fireTileIds[0]!]!;
  const isolatedAfter = stepMonths(isolated.state, 12);
  const overloadedAfter = stepMonths(overloaded.state, 12);
  requireProof(isolatedCoverage > overloadedCoverage, 'station capacity was not split across simultaneous fires');
  requireProof(isolatedAfter.fire.collapsedTotal < overloadedAfter.fire.collapsedTotal, 'overloaded station did not lose more buildings');
  return {
    isolatedCoverage,
    overloadedCoverage,
    isolated: summarizeScenarioState(isolatedAfter),
    overloaded: summarizeScenarioState(overloadedAfter),
  };
});

await proof('deterministic-checkpoint-hashes', () => {
  const left = runDeterministicCheckpointTrace(buildOneCoalEquilibriumScenario().state);
  const right = runDeterministicCheckpointTrace(buildOneCoalEquilibriumScenario().state);
  requireProof(JSON.stringify(left) === JSON.stringify(right), 'same-seed checkpoint traces diverged');
  return left;
});

await proof('1200-month-performance', () => {
  const samples = Array.from({ length: performanceSampleCount }, () => {
    const initial = buildOneCoalEquilibriumScenario().state;
    const started = performance.now();
    const after = stepMonths(initial, 1_200);
    const elapsedMs = performance.now() - started;
    assertScenarioStateIsValid(after);
    return { elapsedMs, hash: hashDeterministicState(after), after };
  });
  const elapsedSamplesMs = samples.map(({ elapsedMs }) => elapsedMs);
  const medianElapsedMs = median(elapsedSamplesMs);
  const slowestElapsedMs = Math.max(...elapsedSamplesMs);
  requireProof(new Set(samples.map(({ hash }) => hash)).size === 1, '1,200-month performance samples diverged');
  requireProof(
    medianElapsedMs < performanceMedianBudgetMs,
    `1,200 active months median took ${medianElapsedMs.toFixed(1)}ms across ${performanceSampleCount} samples`,
  );
  requireProof(
    slowestElapsedMs < performanceHardCeilingMs,
    `1,200 active months slowest sample took ${slowestElapsedMs.toFixed(1)}ms`,
  );
  return {
    sampleCount: performanceSampleCount,
    elapsedSamplesMs,
    medianElapsedMs,
    slowestElapsedMs,
    medianBudgetMs: performanceMedianBudgetMs,
    hardCeilingMs: performanceHardCeilingMs,
    summary: summarizeScenarioState(samples[0]!.after),
  };
});

await proof(fullActiveSoak ? '10000-month-active-soak' : '10000-month-inert-soak', () => {
  const initial = fullActiveSoak ? activeSoakInitial() : createMarketMapFixture('flat-48', 10_000);
  const forceGarbageCollection = (globalThis as typeof globalThis & { gc?: () => void }).gc;
  forceGarbageCollection?.();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const after = stepMonths(initial, 10_000);
  const elapsedMs = performance.now() - started;
  forceGarbageCollection?.();
  const heapAfter = process.memoryUsage().heapUsed;
  assertScenarioStateIsValid(after);
  requireProof(after.clock.month === 10_000, `soak ended at month ${after.clock.month}`);
  if (!fullActiveSoak) {
    const duplicate = stepMonths(createMarketMapFixture('flat-48', 10_000), 10_000);
    requireProof(hashDeterministicState(after) === hashDeterministicState(duplicate), '10,000-month hashes diverged');
  }
  return {
    mode: fullActiveSoak ? 'active-land-shortage-city' : 'inert-scheduler-and-state',
    elapsedMs,
    heapBefore,
    heapAfter,
    heapDelta: heapAfter - heapBefore,
    garbageCollectionAvailable: forceGarbageCollection !== undefined,
    summary: summarizeScenarioState(after),
  };
});

const report: ScenarioReport = {
  rulesVersion: MARKET_CITY_RULES_VERSION,
  generatedAt: new Date().toISOString(),
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  fullActiveSoak,
  pass: results.every(({ pass }) => pass),
  results,
};

const evidenceDirectory = resolve('evidence/market-city-scenarios');
await mkdir(evidenceDirectory, { recursive: true });
await writeFile(resolve(evidenceDirectory, fullActiveSoak ? 'report-active-soak.json' : 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

const markdown = [
  '# MarketCity deterministic scenario proof',
  '',
  `- Result: **${report.pass ? 'PASS' : 'FAIL'}**`,
  `- Rules: \`${report.rulesVersion}\``,
  `- Runtime: \`${report.node}\` on \`${report.platform}\``,
  `- Full active 10,000-month soak: \`${String(fullActiveSoak)}\``,
  '',
  '| Proof | Result | Runtime |',
  '|---|---:|---:|',
  ...results.map((result) => `| ${result.id} | ${result.pass ? 'PASS' : 'FAIL'} | ${proofRuntimeLabel(result)} |`),
  '',
  ...results.filter(({ pass }) => !pass).flatMap((result) => [
    `## ${result.id}`,
    '',
    '```text',
    result.error ?? 'Unknown failure',
    '```',
    '',
  ]),
].join('\n');
await writeFile(
  resolve(evidenceDirectory, fullActiveSoak ? 'report-active-soak.md' : 'report.md'),
  markdown.endsWith('\n') ? markdown : `${markdown}\n`,
);

for (const result of results) {
  const status = result.pass ? 'PASS' : 'FAIL';
  process.stdout.write(`${status.padEnd(4)} ${result.id.padEnd(34)} ${result.elapsedMs.toFixed(1).padStart(9)} ms\n`);
  if (!result.pass) process.stdout.write(`${result.error ?? 'Unknown failure'}\n`);
}
process.stdout.write(`\n${report.pass ? 'PASS' : 'FAIL'}: ${results.filter(({ pass }) => pass).length}/${results.length} proofs passed.\n`);
if (!report.pass) process.exitCode = 1;
