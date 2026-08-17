import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { MARKET_CITY_RULES_VERSION, MARKET_CITY_SCHEMA_VERSION } from '../src/market-city/types';

const MAX_INITIAL_GZIP_BYTES = 160_000;
const ASSET_PATTERN = /^marketCityDashboard-.*\.(?:css|js)$/;
const TEXT_BUILD_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.map']);
const assetDirectory = new URL('../dist/assets/', import.meta.url);
const distDirectory = new URL('../dist/', import.meta.url);

async function exists(url: URL): Promise<boolean> {
  try {
    await stat(url);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

async function sensitiveBuildOutputs(directory: URL): Promise<string[]> {
  const findings: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    if (entry.isDirectory()) {
      findings.push(...await sensitiveBuildOutputs(url));
      continue;
    }
    if (!TEXT_BUILD_EXTENSIONS.has(extname(entry.name).toLowerCase())) continue;
    const source = await readFile(url, 'utf8');
    if (
      /\/Users\/[A-Za-z0-9._-]+/.test(source)
      || /\/private\/tmp\//.test(source)
      || /\/var\/folders\//.test(source)
      || /-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(source)
      || /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/.test(source)
      || /sk_(?:live|test)_[A-Za-z0-9]{16,}/.test(source)
    ) {
      findings.push(url.pathname.replace(distDirectory.pathname, ''));
    }
  }
  return findings;
}

const assets = (await readdir(assetDirectory)).filter((file) => ASSET_PATTERN.test(file)).sort();
if (assets.length < 2 || !assets.some((file) => file.endsWith('.js')) || !assets.some((file) => file.endsWith('.css'))) {
  throw new Error('The built MarketCity dashboard JS and CSS assets were not found. Run pnpm build first.');
}

const files = await Promise.all(assets.map(async (file) => {
  const bytes = await readFile(new URL(file, assetDirectory));
  return { file, rawBytes: bytes.length, gzipBytes: gzipSync(bytes).length };
}));
const currentGzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
const forbiddenOutputs = [
  new URL('../dist/simulation-lab.html', import.meta.url),
  new URL('../dist/design-review/synthcity-experiments.html', import.meta.url),
  new URL('../dist/synthcity-scenarios/', import.meta.url),
];
const leakedOutputs = [];
for (const output of forbiddenOutputs) if (await exists(output)) leakedOutputs.push(output.pathname);
const sensitiveOutputs = await sensitiveBuildOutputs(distDirectory);

const receipt = {
  schemaVersion: MARKET_CITY_SCHEMA_VERSION,
  rulesVersion: MARKET_CITY_RULES_VERSION,
  entry: 'marketCityDashboard',
  maximumInitialGzipBytes: MAX_INITIAL_GZIP_BYTES,
  currentGzipBytes,
  files,
  leakedLegacyOutputs: leakedOutputs,
  sensitiveBuildOutputs: sensitiveOutputs,
  passed: currentGzipBytes <= MAX_INITIAL_GZIP_BYTES
    && leakedOutputs.length === 0
    && sensitiveOutputs.length === 0,
};

await mkdir(new URL('../test-results/', import.meta.url), { recursive: true });
await writeFile(
  new URL('../test-results/market-city-bundle-size.json', import.meta.url),
  `${JSON.stringify(receipt, null, 2)}\n`,
  'utf8',
);

process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
if (currentGzipBytes > MAX_INITIAL_GZIP_BYTES) {
  throw new Error(`MarketCity initial JS+CSS is ${currentGzipBytes} gzip bytes; the ceiling is ${MAX_INITIAL_GZIP_BYTES}.`);
}
if (leakedOutputs.length > 0) {
  throw new Error(`Legacy outputs leaked into dist: ${leakedOutputs.join(', ')}`);
}
if (sensitiveOutputs.length > 0) {
  throw new Error(`Sensitive content leaked into dist: ${sensitiveOutputs.join(', ')}`);
}
