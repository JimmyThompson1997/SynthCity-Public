import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');
const retiredPaths = [
  'src/app',
  'src/content',
  'src/persistence',
  'src/protocol',
  'src/renderer',
  'src/sim',
  'src/simulation-lab',
  'src/synthcity',
  'src/synthcity-dashboard',
  'src/synthcity-scenarios',
  'src/main.tsx',
  'src/simulation-lab-main.tsx',
  'src/synthcity-experiments.ts',
  'design-review/synthcity-experiments.html',
  'simulation-lab.html',
  'public/synthcity-scenarios',
] as const;

describe('clean MarketCityV2 cutover', () => {
  it('physically removes every retired gameplay runtime and browser entry', () => {
    expect(retiredPaths.filter((path) => existsSync(resolve(root, path)))).toEqual([]);
  });

  it('ships only the current dashboard entry and dependency surface', () => {
    const vite = readFileSync(resolve(root, 'vite.config.ts'), 'utf8');
    const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(vite).not.toMatch(/simulationLabRedirect|synthCityExperiments|@synthcity-dashboard/);
    expect(Object.keys(packageJson.dependencies ?? {})).toEqual([]);
    expect(Object.keys(packageJson.devDependencies ?? {})).not.toEqual(expect.arrayContaining([
      '@types/react',
      '@types/react-dom',
      '@vitejs/plugin-react',
    ]));
    expect(Object.values(packageJson.scripts).join('\n')).not.toMatch(/scenario:v5|synthcity-v5|simulation-lab|ledger:check/);
  });

  it('keeps the fresh schema namespace and refuses compatibility storage', () => {
    const state = readFileSync(resolve(root, 'src/market-city/state.ts'), 'utf8');
    const persistence = readFileSync(resolve(root, 'src/market-city-dashboard/persistence.ts'), 'utf8');
    expect(`${state}\n${persistence}`).toContain('synthcity-market-v2');
    expect(`${state}\n${persistence}`).not.toMatch(/synthcity-v5-autosave|LabState|schemaVersion\s*===?\s*[2345]/);
  });
});
