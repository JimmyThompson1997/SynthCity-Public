import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../../design-review/square-grid-mayor.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../src/market-city-dashboard/index.ts', import.meta.url), 'utf8');

describe('Passenger Rail player dashboard contract', () => {
  it('exposes working Rail and Train Station cards from one visible Transit category', () => {
    expect(page).toContain('data-transit-category="rail"');
    expect(page).toContain('aria-label="Passenger Rail"');
    expect(dashboard).toContain('MARKET_NETWORK_CATALOG.rail');
    expect(dashboard).toContain("'network:rail'");
    expect(dashboard).toContain("MARKET_FACILITY_CATALOG['train-station']");
    expect(dashboard).toContain("'facility:train-station'");
  });

  it('publishes stable preview, world, topology, and grade-crossing seams', () => {
    expect(page).toContain('terrain-rail-world');
    expect(page).toContain("network.dataset.connectionMask");
    expect(page).toContain("network.dataset.networkTopology");
    expect(page).toContain('terrain-rail-grade-crossing');
    expect(page).toContain("crossing.dataset.crossingWith");
    expect(page).toContain("crossing.dataset.crossingMask");
    expect(page).toContain("group.dataset.stationStatus");
    expect(page).toContain("group.dataset.stationRidership");
  });

  it('uses a noncanonical animation layer and exposes read-only shuttle proof', () => {
    expect(page).toContain('id="rail-shuttle-overlays"');
    expect(page).toContain('market-train-shuttle');
    expect(page).toContain('railShuttleAnimationSnapshot');
    expect(page).toContain('data-animation-state');
    expect(page).toContain('data-path-tile-ids');
  });
});
