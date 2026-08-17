import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MARKET_FACILITY_CATALOG } from '../../src/market-city/catalog';

const dashboard = readFileSync(
  resolve(process.cwd(), 'src/market-city-dashboard/index.ts'),
  'utf8',
);
const shell = readFileSync(
  resolve(process.cwd(), 'design-review/square-grid-mayor.html'),
  'utf8',
);
const styleSheet = readFileSync(
  resolve(process.cwd(), 'src/market-city-dashboard/dashboard.css'),
  'utf8',
);
const inspector = readFileSync(
  resolve(process.cwd(), 'src/market-city-dashboard/inspector.ts'),
  'utf8',
);

describe('Public Services catalog integration', () => {
  it('renders Fire Station cards with the shared world thumbnail instead of a glyph', () => {
    expect(dashboard).toContain('bridge.createCatalogWorldThumbnail');
    expect(dashboard).toContain("kind: entry.kind");
    expect(dashboard).toContain("label: entry.label");
    expect(dashboard).not.toContain("if (kind === 'fire-station') return '🔥'");
  });

  it('opens Fire through its dedicated Public Services dialog', () => {
    expect(dashboard).toContain("'#public-service-catalog-dialog'");
    expect(dashboard).toContain("'[data-public-service-category=\"fire\"]'");
    expect(dashboard).not.toContain("button.dataset.utilityCategory === 'fire'");
  });

  it('keeps the Fire Station as a one-by-one facility', () => {
    expect(MARKET_FACILITY_CATALOG['fire-station'].footprint).toEqual({ width: 1, height: 1 });
  });

  it('routes surface facilities through the generic connector card', () => {
    expect(dashboard).toContain('deriveInspectorTarget');
    expect(dashboard).toContain('renderConnectorRow');
    expect(inspector).toContain("kind: 'surface-facility'");
    expect(inspector).toContain('binary(roadConnected)');
    expect(inspector).not.toContain('landfill stage');
  });

  it('drives placement coverage and pulse rings from the catalog service radius', () => {
    expect(shell).toContain("const FIRE_STATION_SERVICE_RADIUS = MARKET_FACILITY_CATALOG['fire-station'].serviceRadius;");
    expect(shell).toContain('const FIRE_STATION_PULSE_WAVE_COUNT = 8;');
    expect(shell).toContain('const FIRE_STATION_PULSE_RADII = Object.freeze(Array.from(');
    expect(shell).toContain('function fireStationRadiusTiles(originTile, radius = FIRE_STATION_SERVICE_RADIUS)');
    expect(shell).toContain('function fireStationDiamondPath(originTile, reach)');
    expect(shell).toContain('function fireStationEndpointBoundaryPath(originTile, radius = FIRE_STATION_SERVICE_RADIUS)');
    expect(shell).toContain('function fireStationInsetBoundaryPath(originTile, radius = FIRE_STATION_SERVICE_RADIUS)');
    expect(shell).toContain('function appendFireStationMapClip(pulse)');
    expect(shell).toContain("clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse')");
    expect(shell).toContain("coverage.setAttribute('clip-path', `url(#${clipId})`");
    expect(shell).toContain("pulse.dataset.mapClip = 'in-map'");
    expect(shell).toContain('fireStationEndpointBoundaryPath(originTile, radius)');
    expect(shell).not.toContain("createSvgPath('fire-station-coverage-preview-boundary'");
    expect(shell).not.toContain('function fireStationRadiusTiles(originTile, radius = 10)');
  });

  it('uses a short, slower pure-red flare and stronger fill-only placement waves', () => {
    expect(shell).toContain('const FIRE_STATION_FLARE_DURATION_MS = 480;');
    expect(shell).toContain('const FIRE_STATION_FLARE_SCREEN_LENGTH = 144;');
    expect(shell).toContain('id="fire-station-placement-screen-feedback"');
    expect(shell).toContain('function fireStationScreenFeedbackPoint(point)');
    expect(shell).toContain("flare.dataset.coordinateSpace = 'screen';");
    expect(styleSheet).toContain('--fire-station-flare-duration: 480ms;');
    expect(styleSheet).toContain('.fire-station-placement-screen-feedback {');
    expect(styleSheet).toContain('fill: rgba(255, 0, 0, .16);');
    expect(styleSheet).toContain('stroke: rgba(255, 0, 0, .98);');
    expect(styleSheet).toContain('stroke: none;');
  });
});
