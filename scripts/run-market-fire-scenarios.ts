import { mkdir, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { deriveBuildingUnits, deriveRenderLots } from '../src/market-city/appearance';
import {
  deterministicFireRandom,
  deriveIncidentSuppression,
  derivePotentialFireCoverage,
  stepMarketFire,
} from '../src/market-city/fire';
import { MARKET_CITY_RULES } from '../src/market-city/rules';
import { buildOneCoalEquilibriumScenario } from '../src/market-city/scenarios';
import { stepMonths } from '../src/market-city/simulation';
import { deriveDensityCaps, derivePower } from '../src/market-city/spatial';
import {
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  serializeMarketCityState,
} from '../src/market-city/state';
import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_SCHEMA_VERSION,
  type MarketCityStateV2,
  type MarketFireIncident,
  type MarketLotFootprint,
  type MarketRenderLot,
  type MarketZoneKind,
} from '../src/market-city/types';

const SIZE = 48;
const tile = (x: number, y: number): number => y * SIZE + x;

interface ScenarioReceipt {
  id: string;
  pass: boolean;
  elapsedMs: number;
  finalHash: string;
  evidence: unknown;
  error?: string;
}

const receipts: ScenarioReceipt[] = [];

function fresh(id: string): MarketCityStateV2 {
  const state = createMarketCityState({
    cityId: `fire-scenario:${id}`,
    cityName: id,
    mayorName: 'Fire Scenario Harness',
    seed: 17,
    createdAt: '2026-08-12T00:00:00.000Z',
  });
  state.clock.paused = false;
  return state;
}

function develop(state: MarketCityStateV2, tileIds: readonly number[], zone: MarketZoneKind, density = 1): void {
  for (const id of tileIds) {
    state.map.zones[id] = zone;
    state.economy.density[id] = density;
    state.economy.wealth[id] = 20_000;
  }
}

function footprintFor(tileIds: readonly number[]): MarketLotFootprint {
  if (tileIds.length === 1) return '1x1';
  const xs = tileIds.map((id) => id % SIZE);
  const ys = tileIds.map((id) => Math.floor(id / SIZE));
  if (tileIds.length === 4) return '2x2';
  if (tileIds.length === 3) return 'L';
  return Math.max(...xs) - Math.min(...xs) === 1 ? '1x2' : '2x1';
}

function lot(tileIds: number[], zone: MarketZoneKind): MarketRenderLot {
  return {
    id: `lot-${Math.min(...tileIds)}`, tileIds: [...tileIds].sort((left, right) => left - right),
    zone, height: 5, footprint: footprintFor(tileIds), roof: 'flat', roofHeight: 1,
    roofOrientation: 0, detail: 'windows', color: [112, 204, 124], landmark: false,
    incidentId: null, fireIntensity: 0, fireDamage: 0, fireAge: 0, char: 0, plume: 0,
  };
}

function incident(tileIds: number[], zone: MarketZoneKind = 'R', overrides: Partial<MarketFireIncident> = {}): MarketFireIncident {
  const sorted = [...tileIds].sort((left, right) => left - right);
  const originTile = sorted[0]!;
  return {
    id: `fire-m1-t${originTile}`,
    status: 'burning',
    tileIds: sorted,
    zone,
    startedMonth: 1,
    structure: {
      footprint: footprintFor(sorted),
      originTile,
      height: 5,
      roof: 'flat',
      roofHeight: 1,
      roofOrientation: 0,
      detail: 'windows',
      color: [112, 204, 124],
      landmark: false,
    },
    intensity: 0.04,
    damage: 0,
    age: 0,
    rubbleMonthsRemaining: 0,
    ...overrides,
  };
}

function seedIncident(state: MarketCityStateV2, fire: MarketFireIncident): void {
  state.fire.incidents.push(fire);
  state.clock.month = Math.max(state.clock.month, fire.startedMonth);
  state.fire.history.push({
    sequence: state.fire.history.length + 1,
    month: fire.startedMonth,
    incidentId: fire.id,
    event: 'ignited',
    tileIds: [...fire.tileIds],
    zone: fire.zone,
    intensity: 0.04,
    damage: 0,
    rubbleMonthsRemaining: 0,
  });
}

function addOperationalStation(state: MarketCityStateV2, anchor = tile(12, 12), id = 'station-1'): void {
  state.map.facilities.push({ id, kind: 'fire-station', anchor, tiles: [anchor] });
  state.map.roads[anchor + SIZE] = true;
  supplyPower(state, anchor);
}

/**
 * Operational now means road AND power, and power comes from the MAP rather
 * than the persisted field, so a scenario cannot simply flag the tile. A
 * self-starting wind turbine immediately north of the station keeps these
 * focused fire scenarios independent of thermal cooling infrastructure.
 */
function supplyPower(state: MarketCityStateV2, anchor: number): void {
  const x = anchor % SIZE;
  const y = Math.floor(anchor / SIZE);
  if (y < 1) return;
  const plant = tile(x, y - 1);
  const tiles = [plant];
  const taken = new Set(state.map.facilities.flatMap((facility) => facility.tiles));
  if (tiles.some((candidate) => taken.has(candidate) || state.map.roads[candidate])) return;
  state.map.facilities.push({
    id: `supply-${x}-${y}`, kind: 'wind-turbine', anchor: plant, tiles,
  });
}

function requireProof(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function settleFire(state: MarketCityStateV2, units: readonly MarketRenderLot[] = []): MarketCityStateV2 {
  return stepMarketFire(state, units);
}

async function run(id: string, scenario: () => { state: MarketCityStateV2; evidence: unknown }): Promise<void> {
  const started = performance.now();
  try {
    const result = scenario();
    const finalHash = hashDeterministicState(result.state);
    const serialized = serializeMarketCityState(result.state);
    requireProof(hashDeterministicState(restoreMarketCityState(serialized)) === finalHash, `${id} restore hash diverged`);
    const replay = scenario();
    requireProof(hashDeterministicState(replay.state) === finalHash, `${id} replay hash diverged`);
    receipts.push({
      id,
      pass: true,
      elapsedMs: performance.now() - started,
      finalHash,
      evidence: result.evidence,
    });
  } catch (error) {
    receipts.push({
      id,
      pass: false,
      elapsedMs: performance.now() - started,
      finalHash: '',
      evidence: null,
      error: error instanceof Error ? error.stack ?? error.message : String(error),
    });
  }
}

await run('01-2x2-one-unit-collapse', () => {
  const state = fresh('01');
  const ids = [tile(20, 20), tile(21, 20), tile(20, 21), tile(21, 21)];
  develop(state, ids, 'I');
  seedIncident(state, incident(ids, 'I', { intensity: 1, damage: 10.5, age: 17 }));
  const after = settleFire(state);
  requireProof(after.fire.incidents.length === 1 && after.fire.incidents[0]?.status === 'rubble', '2x2 did not collapse as one incident');
  return { state: after, evidence: { tileIds: after.fire.incidents[0]?.tileIds, collapsedTotal: after.fire.collapsedTotal } };
});

await run('02-rci-ignition-hazard', () => {
  const origin = tile(16, 16);
  const probability = Object.fromEntries((['R', 'C', 'I'] as const).map((zone) => {
    const hazard = MARKET_CITY_RULES.fire.ignition * MARKET_CITY_RULES.fire.flammability[zone];
    return [zone, 1 - Math.exp(-hazard)];
  })) as Record<MarketZoneKind, number>;
  let comparisonMonth = 1;
  while (!(deterministicFireRandom(origin, comparisonMonth, 1) < probability.I
    && deterministicFireRandom(origin, comparisonMonth, 1) >= probability.R)) comparisonMonth += 1;
  const outcomes = Object.fromEntries((['R', 'C', 'I'] as const).map((zone) => {
    const candidate = fresh(`02-${zone}`);
    develop(candidate, [origin], zone);
    candidate.clock.month = comparisonMonth - 1;
    return [zone, settleFire(candidate, [lot([origin], zone)]).fire.incidents.length];
  })) as Record<MarketZoneKind, number>;
  requireProof(outcomes.I === 1 && outcomes.R === 0 && outcomes.C === 0, 'engine did not apply sector ignition ordering');
  const state = fresh('02');
  state.clock.month = comparisonMonth;
  return { state, evidence: { comparisonMonth, draw: deterministicFireRandom(origin, comparisonMonth, 1), probability, outcomes } };
});

await run('03-shared-edge-spread', () => {
  const targetIds = [tile(11, 10), tile(11, 11)];
  const origin = targetIds[0]!;
  const base = MARKET_CITY_RULES.fire.ignition * targetIds.length;
  const oneProbability = 1 - Math.exp(-(base + MARKET_CITY_RULES.fire.spread * MARKET_CITY_RULES.fire.spreadMultiplier.I));
  const twoProbability = 1 - Math.exp(-(base + 2 * MARKET_CITY_RULES.fire.spread * MARKET_CITY_RULES.fire.spreadMultiplier.I));
  let comparisonMonth = 2;
  while (!(deterministicFireRandom(origin, comparisonMonth, 1) < twoProbability
    && deterministicFireRandom(origin, comparisonMonth, 1) >= oneProbability)) comparisonMonth += 1;
  const execute = (sourceIds: number[]) => {
    const candidate = fresh(`03-${sourceIds.length}`);
    develop(candidate, sourceIds, 'I');
    develop(candidate, targetIds, 'R');
    const source = incident(sourceIds, 'I', { intensity: 1, startedMonth: 1, id: `fire-m1-t${Math.min(...sourceIds)}` });
    seedIncident(candidate, source);
    candidate.clock.month = comparisonMonth - 1;
    return settleFire(candidate, [lot(targetIds, 'R')]);
  };
  const oneEdge = execute([tile(10, 10)]);
  const twoEdges = execute([tile(10, 10), tile(10, 11)]);
  requireProof(oneEdge.fire.incidents.length === 1 && twoEdges.fire.incidents.length === 2, 'engine did not scale spread by shared edges');
  return { state: twoEdges, evidence: { comparisonMonth, oneEdgeIncidents: 1, twoEdgeIncidents: 2 } };
});

await run('04-road-firebreak', () => {
  const state = fresh('04');
  const burning = tile(10, 10);
  const road = tile(11, 10);
  const target = tile(12, 10);
  develop(state, [burning], 'I');
  develop(state, [target], 'R');
  state.map.roads[road] = true;
  seedIncident(state, incident([burning], 'I', { intensity: 1 }));
  const baseProbability = 1 - Math.exp(-(MARKET_CITY_RULES.fire.ignition * MARKET_CITY_RULES.fire.flammability.R));
  const adjacentProbability = 1 - Math.exp(-(MARKET_CITY_RULES.fire.ignition + MARKET_CITY_RULES.fire.spread * MARKET_CITY_RULES.fire.spreadMultiplier.I));
  let comparisonMonth = 2;
  while (!(deterministicFireRandom(target, comparisonMonth, 1) < adjacentProbability
    && deterministicFireRandom(target, comparisonMonth, 1) >= baseProbability)) comparisonMonth += 1;
  state.clock.month = comparisonMonth - 1;
  const after = settleFire(state, [lot([target], 'R')]);
  requireProof(after.fire.incidents.length === 1 && after.fire.incidents[0]?.tileIds.includes(burning), 'road did not prevent cross-block spread');
  return { state: after, evidence: { burning, road, target, comparisonMonth, targetIgnited: false } };
});

await run('05-one-station-slowdown', () => {
  const state = fresh('05');
  addOperationalStation(state);
  const target = tile(13, 12);
  develop(state, [target], 'R');
  seedIncident(state, incident([target]));
  const suppression = deriveIncidentSuppression(state).get(state.fire.incidents[0]!.id) ?? 0;
  const after = settleFire(state);
  requireProof(suppression > 0 && after.fire.incidents[0]!.intensity < 0.1456, 'one station did not slow the fire');
  return { state: after, evidence: { suppression, intensity: after.fire.incidents[0]?.intensity } };
});

await run('06-two-station-suppression', () => {
  const state = fresh('06');
  addOperationalStation(state);
  state.map.facilities.push({ id: 'station-2', kind: 'fire-station', anchor: tile(13, 12), tiles: [tile(13, 12)] });
  state.map.roads[tile(13, 13)] = true;
  const target = tile(14, 12);
  develop(state, [target], 'R');
  seedIncident(state, incident([target]));
  const after = settleFire(state);
  requireProof(after.fire.incidents.length === 0 && after.fire.suppressedTotal === 1, 'two stations did not suppress a new fire');
  return { state: after, evidence: { suppressedTotal: after.fire.suppressedTotal } };
});

await run('07-station-road-loss', () => {
  const state = fresh('07');
  addOperationalStation(state);
  const target = tile(13, 12);
  develop(state, [target], 'R');
  seedIncident(state, incident([target]));
  const before = deriveIncidentSuppression(state).get(state.fire.incidents[0]!.id) ?? 0;
  state.map.roads[tile(12, 13)] = false;
  const after = deriveIncidentSuppression(state).get(state.fire.incidents[0]!.id) ?? 0;
  requireProof(before > 0 && after === 0, 'road loss did not remove suppression');
  return { state, evidence: { before, after } };
});

await run('08-station-power-dependence', () => {
  // This proof asserted the OPPOSITE contract by name: that a road-served
  // station worked without power. Public safety now gates both services on
  // road AND power, so the proof is inverted rather than deleted — a dark
  // station must suppress nothing, and lighting it must restore suppression.
  const state = fresh('08');
  addOperationalStation(state);
  const target = tile(13, 12);
  develop(state, [target], 'R');
  seedIncident(state, incident([target]));
  const powered = deriveIncidentSuppression(state).get(state.fire.incidents[0]!.id) ?? 0;
  const supply = state.map.facilities.find(({ kind }) => kind === 'wind-turbine');
  state.map.facilities = state.map.facilities.filter((facility) => facility !== supply);
  const dark = deriveIncidentSuppression(state).get(state.fire.incidents[0]!.id) ?? 0;
  requireProof(powered > 0, 'powered road-served station did not suppress');
  requireProof(dark === 0, 'unpowered station still suppressed');
  if (supply) state.map.facilities.push(supply);
  return { state, evidence: { powered, dark } };
});

await run('09-three-fire-station-load', () => {
  const state = fresh('09');
  addOperationalStation(state);
  const targets = [tile(13, 12), tile(12, 14), tile(10, 14)];
  targets.forEach((target, index) => {
    develop(state, [target], 'I');
    seedIncident(state, incident([target], 'I', {
      id: `fire-m${index + 1}-t${target}`,
      startedMonth: index + 1,
    }));
  });
  const values = [...deriveIncidentSuppression(state).values()];
  requireProof(values.length === 3 && Math.max(...values) < MARKET_CITY_RULES.fire.stationPower, 'station power was not divided');
  return { state, evidence: { suppression: values } };
});

await run('10-pinned-regroup-pressure', () => {
  const state = fresh('10');
  const ids = [tile(20, 20), tile(21, 20), tile(20, 21), tile(21, 21)];
  develop(state, ids, 'C');
  const caps = deriveDensityCaps(state).densityCaps;
  const source = deriveBuildingUnits(state, caps).find((candidate) => candidate.tileIds.length > 1)!;
  seedIncident(state, incident(source.tileIds, 'C', { structure: { ...incident(source.tileIds).structure, footprint: source.footprint, height: source.height } }));
  state.economy.density[source.tileIds.at(-1)!] = 0;
  const rendered = deriveRenderLots(state, deriveDensityCaps(state).densityCaps).find((candidate) => candidate.incidentId);
  requireProof(JSON.stringify(rendered?.tileIds) === JSON.stringify(source.tileIds), 'pinned structure regrouped');
  return { state, evidence: { footprint: rendered?.footprint, tileIds: rendered?.tileIds } };
});

await run('11-fifty-month-rubble', () => {
  let state = fresh('11');
  const target = tile(18, 18);
  develop(state, [target], 'R');
  seedIncident(state, incident([target], 'R', { intensity: 1, damage: 10.5 }));
  state = settleFire(state);
  for (let month = 0; month < 49; month += 1) state = settleFire(state);
  requireProof(state.fire.incidents[0]?.rubbleMonthsRemaining === 1, 'rubble did not persist through month 49');
  state = settleFire(state);
  requireProof(state.fire.incidents.length === 0 && state.fire.history.at(-1)?.event === 'rubble-cleared', 'rubble did not clear on month 50');
  return { state, evidence: { finalEvent: state.fire.history.at(-1) } };
});

await run('12-century-fire-history', () => {
  const opening = buildOneCoalEquilibriumScenario().state;
  const state = stepMonths(opening, 1_200);
  const bytes = Buffer.byteLength(serializeMarketCityState(state));
  const occupied = new Set<number>();
  for (const fire of state.fire.incidents) for (const id of fire.tileIds) {
    requireProof(!occupied.has(id), `overlapping incident tile ${id}`);
    occupied.add(id);
  }
  requireProof(bytes < 10_000_000, `century save is ${bytes} bytes`);
  return { state, evidence: { historyEntries: state.fire.history.length, saveBytes: bytes, incidents: state.fire.incidents.length } };
});

await run('13-difficulty-comparison', () => {
  const origin = tile(18, 18);
  const normalHazard = MARKET_CITY_RULES.fire.ignition * MARKET_CITY_RULES.fire.flammability.I;
  const probability = Object.fromEntries((['easy', 'normal', 'hard'] as const).map((difficulty) => [
    difficulty,
    1 - Math.exp(-(normalHazard * MARKET_CITY_RULES.fire.difficulty[difficulty].ignition)),
  ])) as Record<'easy' | 'normal' | 'hard', number>;
  let comparisonMonth = 1;
  while (!(deterministicFireRandom(origin, comparisonMonth, 1) < probability.hard
    && deterministicFireRandom(origin, comparisonMonth, 1) >= probability.normal)) comparisonMonth += 1;
  const outcomes = Object.fromEntries((['easy', 'normal', 'hard'] as const).map((difficulty) => {
    const candidate = fresh(`13-${difficulty}`);
    candidate.clock.fireDifficulty = difficulty;
    candidate.clock.month = comparisonMonth - 1;
    develop(candidate, [origin], 'I');
    return [difficulty, settleFire(candidate, [lot([origin], 'I')]).fire.incidents.length];
  }));
  requireProof(outcomes.easy === 0 && outcomes.normal === 0 && outcomes.hard === 1, 'engine did not apply difficulty ignition ordering');
  const state = fresh('13');
  state.clock.month = comparisonMonth;
  return { state, evidence: { comparisonMonth, probability, outcomes } };
});

await run('14-radius-and-overlap', () => {
  const state = fresh('14');
  addOperationalStation(state, tile(24, 24));
  const first = derivePotentialFireCoverage(state);
  state.map.facilities.push({ id: 'station-2', kind: 'fire-station', anchor: tile(25, 24), tiles: [tile(25, 24)] });
  state.map.roads[tile(25, 25)] = true;
  supplyPower(state, tile(25, 24));
  const overlap = derivePotentialFireCoverage(state);
  requireProof(first.filter((value) => value > 0).length === 925, 'radius-twenty-one cell count is not 925');
  requireProof(overlap[tile(24, 24)]! > MARKET_CITY_RULES.fire.stationPower, 'overlapping coverage did not add');
  return { state, evidence: { coveredCells: first.filter((value) => value > 0).length, overlapCore: overlap[tile(24, 24)] } };
});

const report = {
  schemaVersion: MARKET_CITY_SCHEMA_VERSION,
  rulesVersion: MARKET_CITY_RULES_VERSION,
  generatedAt: new Date().toISOString(),
  pass: receipts.every((receipt) => receipt.pass),
  receipts,
};
const output = resolve('evidence/market-city-fire-scenarios');
await mkdir(output, { recursive: true });
await writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
await writeFile(resolve(output, 'report.md'), [
  '# MarketCity building-unit fire scenario proof',
  '',
  `- Result: **${report.pass ? 'PASS' : 'FAIL'}**`,
  `- Schema: \`${report.schemaVersion}\``,
  `- Rules: \`${report.rulesVersion}\``,
  '',
  '| Scenario | Result | Runtime | Final hash |',
  '|---|---:|---:|---|',
  ...receipts.map((receipt) => `| ${receipt.id} | ${receipt.pass ? 'PASS' : 'FAIL'} | ${receipt.elapsedMs.toFixed(1)} ms | \`${receipt.finalHash}\` |`),
  '',
].join('\n'));
for (const receipt of receipts) {
  process.stdout.write(`${receipt.pass ? 'PASS' : 'FAIL'} ${receipt.id.padEnd(31)} ${receipt.elapsedMs.toFixed(1).padStart(8)} ms ${receipt.finalHash}\n`);
  if (receipt.error) process.stdout.write(`${receipt.error}\n`);
}
process.stdout.write(`\n${report.pass ? 'PASS' : 'FAIL'}: ${receipts.filter((receipt) => receipt.pass).length}/${receipts.length} fire scenarios passed.\n`);
if (!report.pass) process.exitCode = 1;
