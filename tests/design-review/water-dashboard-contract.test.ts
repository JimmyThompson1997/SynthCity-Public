import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../../design-review/square-grid-mayor.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../src/market-city-dashboard/index.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../../src/market-city-dashboard/render-adapter.ts', import.meta.url), 'utf8');

describe('Water Services player dashboard contract', () => {
  it('exposes one visible Utilities to Water category with four working cards', () => {
    expect(page).toContain('data-utility-category="water"');
    expect(page).toContain('aria-label="Water"');
    expect(dashboard).toContain("MARKET_NETWORK_CATALOG['water-pipe']");
    expect(dashboard).toContain("'network:water-pipe'");
    for (const kind of ['water-tower', 'coastal-water-pump', 'water-treatment-plant']) {
      expect(dashboard).toContain(`MARKET_FACILITY_CATALOG['${kind}']`);
    }
    expect(dashboard).toContain("entry.kind === 'water-pipe' ? 'network:water-pipe'");
    expect(dashboard).toContain('button.dataset.capacity');
  });

  it('uses one Underground View for pipe placement and water-service proof', () => {
    expect(page).toContain('data-city-view-option="underground"');
    expect(page).toContain('Underground View');
    expect(page).toContain("selectionView: 'underground'");
    expect(page).toContain("compatibleViews: Object.freeze(['underground'])");
    expect(page).toContain("underground: { label: 'Underground View'");
    expect(page).toContain('synthcity-data-water-service');
    expect(page).toContain('polygon.dataset.waterStatus');
    expect(page).toContain("waterStatus: 'unserved-empty-zoning'");
    expect(page).toContain("waterStatus: 'unserved'");
    expect(page).toContain("waterStatus: 'served'");
    expect(page).toContain("waterStatus: 'available'");
  });

  it('publishes stable pipe, facility, and missing-service seams', () => {
    // The canonical underground collector emits these stable pipe seams for
    // both committed and prospective state; `network` is its shared root.
    expect(page).toContain('network.dataset.tile');
    expect(page).toContain('network.dataset.waterComponent');
    expect(page).toContain('network.dataset.connectionMask');
    expect(page).toContain('network.dataset.networkTopology');
    expect(page).toContain('group.dataset.facilityKind');
    expect(page).toContain('group.dataset.operational');
    expect(page).toContain('group.dataset.waterComponent');
    expect(page).toContain('group.dataset.inactiveReason');
    expect(page).toContain('synthcity-water-warning');
    expect(page).toContain('failed gate: no allocated water service');
    expect(page).toContain('water facility power');
    expect(adapter).toContain('waterCoverage');
  });

  it('keeps Underground View demolition on the underground pipe layer', () => {
    expect(page).toContain("client.dataset.cityView === 'underground'");
    expect(page).toContain('layer: demolitionLayerForView()');
  });

  it('invalidates Water visuals when topology, allocation, coverage, or operation changes', () => {
    expect(page).toContain("state.networkConnections?.water?.[tileId] || 0");
    expect(page).toContain('gameplay.watered[tileId] ? 1 : 0');
    expect(page).toContain("state.waterCoverage?.[tileId] || ''");
    expect(page).toContain('facility.waterComponentId');
  });
});
