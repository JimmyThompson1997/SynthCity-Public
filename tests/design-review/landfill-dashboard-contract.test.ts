import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../../design-review/square-grid-mayor.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../src/market-city-dashboard/index.ts', import.meta.url), 'utf8');
const adapter = readFileSync(new URL('../../src/market-city-dashboard/render-adapter.ts', import.meta.url), 'utf8');
const inspector = readFileSync(new URL('../../src/market-city-dashboard/inspector.ts', import.meta.url), 'utf8');

describe('Landfill Zone player dashboard contract', () => {
  it('exposes Waste only through Public Services with one functional Landfill Zone card', () => {
    expect(page).toContain('data-public-service-category="waste"');
    expect(page).toContain('aria-label="Waste"');
    expect(dashboard).toContain('MARKET_SERVICE_ZONE_CATALOG.landfill');
    expect(dashboard).toContain("'zone-landfill'");
    expect(dashboard).toContain('Each cardinally contiguous landfill area needs direct Road or Avenue contact');
  });

  it('keeps the brush atomic and includes it in rectangle pointer gestures', () => {
    expect(page).toContain("synthCityController.preview({ type: 'zone-landfill', cells: coordinates })");
    expect(page).toContain("action === 'zone-landfill'");
    expect(page).toContain("type: 'zone-landfill', cells: [cell]");
    expect(page).toContain("selectedAction === 'dezone' || selectedAction === 'zone-landfill'");
  });

  it('projects the persisted storage ledger into stable inspection and redraw seams', () => {
    expect(adapter).toContain('landfillZones: boolean[]');
    expect(adapter).toContain('landfills: SquareGridMarketLandfillView[]');
    expect(adapter).toContain('roadConnected: boolean');
    expect(adapter).toContain('usableMonthlyIntakeTenths: number');
    expect(adapter).toContain('waste: MarketWasteServiceState');
    expect(page).toContain('state.landfillZones?.[tileId] ? 1 : 0');
    expect(page).toContain('state.waste?.storedByTile?.[tileId] || 0');
    expect(page).toContain('createSharedLandfillWorldGeometry');
    expect(dashboard).toContain('renderInspectorCard');
    expect(dashboard).toContain('inspector-connectors');
    expect(inspector).toContain('deriveInspectorTarget');
    expect(inspector).not.toContain('landfill stage');
  });

  it('keeps the landfill base opaque so underlying terrain grid seams cannot bleed through', () => {
    expect(page).toContain('.terrain-surface .terrain-zone.landfill { fill: #b98a63; }');
  });
});
