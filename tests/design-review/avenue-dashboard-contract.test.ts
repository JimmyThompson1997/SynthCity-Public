import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync(new URL('../../design-review/square-grid-mayor.html', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../../src/market-city-dashboard/index.ts', import.meta.url), 'utf8');

describe('Avenue player dashboard contract', () => {
  it('exposes Avenue in Roads with automatic right-hand traffic', () => {
    expect(dashboard).toContain("MARKET_NETWORK_CATALOG.avenue");
    expect(dashboard).toContain("'network:avenue'");
    expect(page).toContain("const AVENUE_RIGHT_HAND_EXPANSION_SIDE = 'left';");
    expect(page).toContain("client.dataset.avenueTraffic = action === 'network:avenue' ? 'right-hand' : '';");
    expect(page).not.toContain('id="avenue-expansion-side"');
  });

  it('previews the entire atomic two-lane footprint with stable lane roles', () => {
    expect(page).toContain("type: 'place-network'");
    expect(page).toContain('const requestedAvenueSide = AVENUE_RIGHT_HAND_EXPANSION_SIDE;');
    expect(page).toContain('let effectiveAvenueSide = requestedAvenueSide;');
    expect(page).toContain("avenueRibbon?.reasonCode === 'paired-lane-outside-map'");
    expect(page).toContain('expansionSide: effectiveAvenueSide');
    expect(page).toContain('polygon.dataset.requestedExpansionSide = requestedAvenueSide');
    expect(page).toContain('polygon.dataset.expansionSide = effectiveAvenueSide');
    expect(page).toContain("polygon.dataset.autoMirroredAtEdge = 'true'");
    expect(page).toContain("polygon.dataset.laneRole");
    expect(page).toContain("'drawn'");
    expect(page).toContain("'paired'");
    // Avenue world art is now emitted by the same shared fragment collector
    // used by the committed and prospective scenes.
    expect(page).toContain("fragment.dataset.atomicFootprint = 'paired-lanes'");
  });

  it('publishes canonical mask and direction attributes for placed lanes', () => {
    expect(page).toContain("tile.dataset.avenueTravelMask");
    expect(page).toContain("tile.dataset.avenuePairMask");
    expect(page).toContain("tile.dataset.avenueMedianMask");
    expect(page).toContain('terrain-avenue-world');
    expect(page).toContain("appendSharedAvenueWorldGeometry");
    expect(page).toContain('medianMask');
  });

  it('drops preview-only topology before the synchronous authoritative network commit renders', () => {
    const placementStart = page.indexOf('function placeRoadRoute(route)');
    const commit = page.indexOf('return commitRetainedCommandPlan(', placementStart);
    const clearMasks = page.indexOf('networkPreviewMasks = new Map();', placementStart);
    const clearKind = page.indexOf('networkPreviewKind = null;', placementStart);

    expect(placementStart).toBeGreaterThan(-1);
    expect(commit).toBeGreaterThan(placementStart);
    expect(clearMasks).toBeGreaterThan(placementStart);
    expect(clearMasks).toBeLessThan(commit);
    expect(clearKind).toBeGreaterThan(clearMasks);
    expect(clearKind).toBeLessThan(commit);
  });

  it('aims a complete two-tile Avenue before press and reports its authoritative occupied lane footprint', () => {
    expect(page).toContain('const placedTileCount = commandPlanTiles(activeCommandPlan).length;');
    expect(page).toContain('occupied lane ${placedTileCount === 1 ? \'tile\' : \'tiles\'}');
    expect(page).toContain('function avenueHoverRoute(tile, pointerEvent = null)');
    expect(page).toContain("if (network === 'avenue' && cells.length === 1) cells = avenueHoverRoute(cells[0], pointerEvent);");
    expect(page).toContain('polygon.dataset.gestureDirection = gestureDirection');
  });
});
