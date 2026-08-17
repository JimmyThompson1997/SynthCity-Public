import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import { MARKET_CITY_RULES_VERSION, MARKET_CITY_SCHEMA_VERSION } from './src/market-city/types.ts';

const projectRoot = import.meta.dirname;

function gitCommitSha(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

const buildIdentity = Object.freeze({
  commitSha: process.env.VERCEL_GIT_COMMIT_SHA || gitCommitSha(),
  deploymentId: process.env.VERCEL_DEPLOYMENT_ID || 'local',
  environment: process.env.VERCEL_ENV || 'local',
  canonicalUrl: process.env.VERCEL_PROJECT_PRODUCTION_URL || 'localhost',
  deploymentUrl: process.env.VERCEL_URL || 'localhost',
  schemaVersion: MARKET_CITY_SCHEMA_VERSION,
  rulesVersion: MARKET_CITY_RULES_VERSION,
  buildTime: new Date().toISOString(),
});

export default defineConfig({
  define: {
    __SYNTHCITY_BUILD_IDENTITY__: JSON.stringify(buildIdentity),
  },
  resolve: {
    alias: [
      { find: /^three$/, replacement: resolve(projectRoot, 'public/vendor/three/build/three.module.js') },
      { find: '@market-city-visual/terrain-model', replacement: resolve(projectRoot, 'public/design-review/terrain-sandbox-model.js') },
      { find: '@market-city-visual/network-route-model', replacement: resolve(projectRoot, 'public/design-review/network-route-model.js') },
      { find: '@market-city-visual/rail-shuttle-model', replacement: resolve(projectRoot, 'public/design-review/rail-shuttle-model.js') },
      { find: '@market-city-visual/map-view-rotation', replacement: resolve(projectRoot, 'public/design-review/map-view-rotation.js') },
      { find: '@market-city-visual/coal-plant-geometry', replacement: resolve(projectRoot, 'public/design-review/coal-plant-geometry.js') },
      { find: '@market-city-visual/catalog-world-art', replacement: resolve(projectRoot, 'public/design-review/catalog-world-art.js') },
      { find: '@market-city-visual/world-item-renderer', replacement: resolve(projectRoot, 'public/design-review/world-item-renderer.js') },
      { find: '@market-city-dashboard/building-renderer', replacement: resolve(projectRoot, 'public/design-review/market-building-renderer.js') },
    ],
  },
  build: {
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      // The dashboard consumes retained visual modules under public/. Keep
      // those browser URLs external so Vite does not reinterpret the assets.
      external: (source) => source.startsWith('/vendor/three/')
        || source === './terrain-sandbox-model.js'
        || source === './map-view-rotation.js',
      input: {
        app: resolve(projectRoot, 'index.html'),
        marketCityDashboard: resolve(projectRoot, 'design-review/square-grid-mayor.html'),
        marketFireGallery: resolve(projectRoot, 'design-review/market-fire-gallery.html'),
        assetLibrary: resolve(projectRoot, 'design-review/asset-library.html'),
      },
    },
  },
  test: {
    environment: 'node',
    include: [
      'tests/market-city/**/*.test.ts',
      'tests/market-city-dashboard/**/*.test.ts',
      'tests/market-city-scenarios/**/*.test.ts',
      'tests/design-review/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
    },
  },
});
