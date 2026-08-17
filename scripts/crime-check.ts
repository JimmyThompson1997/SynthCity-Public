import { deriveCrimeBalance, builtTileCount, crimePopulation } from '../src/market-city/crime';
import { buildOneCoalEquilibriumScenario } from '../src/market-city/scenarios';
import { applyWorldCommand } from '../src/market-city/commands';
import { stepMonths, stepMonth } from '../src/market-city/simulation';
import { crimeHeightModifier } from '../src/market-city/spatial';
import { coordinateToIndex } from '../src/market-city/math';

let state = stepMonths(buildOneCoalEquilibriumScenario().state, 400);
console.log(`built ${builtTileCount(state)}  pop ${Math.round(crimePopulation(state)).toLocaleString()}`);
console.log(`no station -> active=${deriveCrimeBalance(state).active} target=${(100*deriveCrimeBalance(state).targetShare).toFixed(1)}%`);

// 3x2 footprint needs clear ground; sweep for the first spot that takes it.
let placedOk = false;
for (let y = 20; y < 46 && !placedOk; y += 1) {
  for (let x = 0; x < 45 && !placedOk; x += 1) {
    const attempt = applyWorldCommand(state, {
      type: 'place-facility', kind: 'police-station', anchor: coordinateToIndex(x, y, 48),
    });
    if (attempt.ok) { state = attempt.state; placedOk = true; console.log(`station at ${x},${y}`); }
  }
}
if (!placedOk) throw new Error('no police placement found');
const b = deriveCrimeBalance(state);
console.log(`station, funding 0 -> demand ${b.demand.toFixed(1)} supply ${b.supply.toFixed(1)} coverage ${(100*b.coverage).toFixed(0)}% target ${(100*b.targetShare).toFixed(1)}%`);

console.log('\nmonth  share   target  modifier');
for (let m = 1; m <= 420; m += 1) {
  state = stepMonth(state);
  if ([1, 30, 60, 120, 180, 240, 300, 360, 420].includes(m)) {
    console.log(`${String(m).padStart(5)}  ${(100*state.crime.share).toFixed(1).padStart(5)}%  ${(100*state.crime.targetShare).toFixed(1).padStart(5)}%  ${String(crimeHeightModifier(state.crime.share)).padStart(4)}`);
  }
  if (m === 240) { state = { ...state, crime: { ...state.crime, funding: 3 } }; console.log('        -- funding raised to 3 --'); }
}
