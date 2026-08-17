import { defineConfig } from '@playwright/test';

const configuredPort = Number.parseInt(process.env.PLAYWRIGHT_PORT ?? '4173', 10);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new RangeError('PLAYWRIGHT_PORT must be a valid TCP port.');
}
const hostedBaseURL = process.env.PLAYWRIGHT_BASE_URL?.replace(/\/$/, '');
const baseURL = hostedBaseURL ?? `http://127.0.0.1:${configuredPort}`;
const captureMarketCityEvidence = process.env.MARKET_CITY_CAPTURE_EVIDENCE === '1';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: ['asset-library.spec.ts', 'market-city-cutover.spec.ts', 'market-city-visuals.spec.ts', 'market-city-fire.spec.ts', 'market-city-water.spec.ts', 'market-city-waste.spec.ts', 'market-city-subway.spec.ts', 'market-city-inspector.spec.ts', 'market-city-preview-parity.spec.ts', 'public-readiness.spec.ts'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    trace: captureMarketCityEvidence ? 'off' : 'retain-on-failure',
    screenshot: captureMarketCityEvidence ? 'off' : 'only-on-failure',
    video: captureMarketCityEvidence ? 'off' : 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: hostedBaseURL ? undefined : {
    command: `pnpm build && pnpm preview --port ${configuredPort} --strictPort`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { viewport: { width: 1440, height: 900 } },
    },
  ],
});
