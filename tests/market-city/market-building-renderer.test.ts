import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  MarketBuildingDetail,
  MarketLotFootprint,
  MarketRenderLot,
  MarketRenderRubble,
  MarketRoofKind,
  MarketZoneKind,
} from '../../src/market-city/types';
// @ts-expect-error Static browser renderer modules live under public/ by design.
import * as marketBuildingRenderer from '../../public/design-review/market-building-renderer.js';

const {
  createMarketBuildingWorldGeometry,
  createMarketFireSmokeGeometry,
  createMarketRubbleWorldGeometry,
  setMarketFireVisualPhase,
} = marketBuildingRenderer;

class FakeSvgElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: FakeSvgElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly style: { display: string } = { display: '' };

  constructor(tagName: string) {
    this.tagName = tagName;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
  }

  getAttribute(name: string): string | null {
    return this.attributes.get(name) ?? null;
  }

  append(...nodes: FakeSvgElement[]): void {
    this.children.push(...nodes);
  }

  querySelectorAll(selector: string): FakeSvgElement[] {
    const match = /^\[data-([a-z-]+)\]$/.exec(selector);
    if (!match) return [];
    const key = match[1]!.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    return descendants(this).filter((element) => element.dataset[key] !== undefined);
  }
}

function descendants(root: FakeSvgElement): FakeSvgElement[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function withData(root: FakeSvgElement, key: string, value?: string): FakeSvgElement[] {
  return [root, ...descendants(root)].filter((element) => (
    element.dataset[key] !== undefined && (value === undefined || element.dataset[key] === value)
  ));
}

function withClass(root: FakeSvgElement, className: string): FakeSvgElement[] {
  return [root, ...descendants(root)].filter((element) => (
    (element.getAttribute('class') ?? '').split(/\s+/).includes(className)
  ));
}

function geometrySignature(root: FakeSvgElement): string {
  const geometryAttributes = ['points', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2'];
  return descendants(root).map((element) => [
    element.tagName,
    ...geometryAttributes.map((name) => element.getAttribute(name) ?? ''),
  ].join('|')).join('\n');
}

const project = (x: number, y: number, z = 0) => ({
  x: 100 + (x - y) * 24,
  y: 80 + (x + y) * 12 - z * 18,
});

function lot(overrides: Partial<MarketRenderLot> = {}): MarketRenderLot {
  return {
    id: 'lot-7',
    tileIds: [7],
    zone: 'R',
    height: 4,
    footprint: '1x1',
    roof: 'flat',
    roofHeight: 1,
    roofOrientation: 0,
    detail: null,
    color: [112, 204, 124],
    landmark: false,
    incidentId: null,
    fireIntensity: 0,
    fireDamage: 0,
    fireAge: 0,
    char: 0,
    plume: 0,
    ...overrides,
  };
}

describe('Market RCI world SVG renderer', () => {
  const priorDocument = globalThis.document;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElementNS: (_namespace: string, name: string) => new FakeSvgElement(name),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: priorDocument,
    });
  });

  it('publishes one stable, inspectable world-art contract without mutating the lot', () => {
    const input = Object.freeze(lot({
      tileIds: Object.freeze([7, 8]) as unknown as number[],
      footprint: '1x2',
      roof: 'gable',
      roofOrientation: 1,
      detail: 'windows',
      color: Object.freeze([100, 150, 200]) as unknown as readonly [number, number, number],
      landmark: true,
    }));
    const original = JSON.stringify(input);
    const root = createMarketBuildingWorldGeometry({
      lot: input,
      size: 24,
      project,
      rotation: 3,
      data: { source: 'contract-test' },
    }) as FakeSvgElement;

    expect(root.tagName).toBe('g');
    expect(root.getAttribute('class')).toContain('market-building-world');
    expect(root.dataset).toMatchObject({
      renderContract: 'market-rci-svg-v1',
      marketLotId: 'lot-7',
      zone: 'R',
      footprint: '1x2',
      roofKind: 'gable',
      roofOrientation: '1',
      detail: 'windows',
      height: '4',
      tileIds: '7,8',
      landmark: 'true',
      source: 'contract-test',
    });
    expect(root.getAttribute('style')).toContain('--market-building-color: rgb(100, 150, 200)');
    expect(JSON.stringify(input)).toBe(original);
  });

  const rciFootprints: Array<[MarketZoneKind, MarketLotFootprint, number]> = [
    ...(['R', 'C', 'I'] satisfies MarketZoneKind[]).flatMap((zone) => [
      [zone, '1x1', 1],
      [zone, '1x2', 2],
      [zone, '2x1', 2],
      [zone, '2x2', 4],
      [zone, 'L', 3],
    ] satisfies Array<[MarketZoneKind, MarketLotFootprint, number]>),
  ];

  it.each(rciFootprints)('renders the %s %s footprint without a visible lot slab', (zone, footprint, cells) => {
    const root = createMarketBuildingWorldGeometry({
      lot: lot({ zone, footprint, tileIds: Array.from({ length: cells }, (_, index) => index) }),
      size: 24,
      project,
      rotation: 0,
    }) as FakeSvgElement;

    expect(root.dataset).toMatchObject({
      renderContract: 'market-rci-svg-v1',
      zone,
      footprint,
    });
    expect(withClass(root, 'market-building-lot')).toHaveLength(1);
    expect(withClass(root, 'market-building-lot-slab')).toHaveLength(0);
    expect(withClass(root, 'market-building-footprint-cell')).toHaveLength(cells);
    expect(withData(root, 'footprintCell')).toHaveLength(cells);
    expect(withData(root, 'surface', 'roof')).toHaveLength(1);
    expect(withData(root, 'surface', 'wall').length).toBeGreaterThan(0);
  });

  it.each([
    'flat', 'gable', 'pyramid', 'wedge', 'mech', 'core', 'steps', 'parapet',
    'sawtooth', 'cylinder', 'vents', 'silos', 'stack', 'spire',
  ] satisfies MarketRoofKind[])('renders the complete approved %s roof vocabulary', (roof) => {
    const root = createMarketBuildingWorldGeometry({
      lot: lot({ zone: roof === 'spire' ? 'C' : 'I', roof, roofHeight: roof === 'spire' ? 2 : 1 }),
      size: 24,
      project,
      rotation: 1,
    }) as FakeSvgElement;

    const semanticRoof = withData(root, 'roofKind', roof);
    expect(semanticRoof.length).toBeGreaterThan(0);
    expect(descendants(semanticRoof[0]!).length + semanticRoof[0]!.children.length).toBeGreaterThan(0);
  });

  it('bands an industrial shaft in proportion to its storeys', () => {
    // `bay` used to draw one ground-level loading bay at every height, so a
    // nine-storey works was a blank slab with a door on it.
    const bandsAt = (height: number): number => {
      const root = createMarketBuildingWorldGeometry({
        lot: lot({ zone: 'I', detail: 'bay', height, color: [238, 178, 80] }),
        size: 24,
        project,
        rotation: 2,
      }) as FakeSvgElement;
      return withClass(root, 'market-building-strip-window').length;
    };

    // A shed keeps just its bay; a shaft gains bands as it grows.
    expect(bandsAt(1)).toBe(0);
    expect(bandsAt(3)).toBeGreaterThan(0);
    expect(bandsAt(9)).toBeGreaterThan(bandsAt(3));

    // Every band still sits inside the body, never through the roof.
    const tall = createMarketBuildingWorldGeometry({
      lot: lot({ zone: 'I', detail: 'bay', height: 9, color: [238, 178, 80] }),
      size: 24,
      project,
      rotation: 2,
    }) as FakeSvgElement;
    expect(withClass(tall, 'market-building-loading-bay').length).toBe(1);
    for (const band of withClass(tall, 'market-building-strip-window')) {
      expect((band.getAttribute('points') ?? '').length).toBeGreaterThan(0);
    }
  });

  it.each([
    ['door', 'market-building-door'],
    ['windows', 'market-building-window'],
    ['curtain', 'market-building-curtain'],
    ['bay', 'market-building-loading-bay'],
  ] satisfies Array<[Exclude<MarketBuildingDetail, null>, string]>)('renders %s facade detail', (detail, className) => {
    const root = createMarketBuildingWorldGeometry({
      lot: lot({ detail, height: detail === 'curtain' ? 8 : 3 }),
      size: 24,
      project,
      rotation: 2,
    }) as FakeSvgElement;

    expect(withClass(root, className).length).toBeGreaterThan(0);
  });

  it('keeps char and flames with the structure while smoke uses a separate global layer', () => {
    const burning = lot({ incidentId: 'fire-m4-t7', fireIntensity: 1, fireAge: 8, char: 0.64, plume: 0.8 });
    const root = createMarketBuildingWorldGeometry({
      lot: burning,
      size: 24,
      project,
      rotation: 0,
    }) as FakeSvgElement;
    const smoke = createMarketFireSmokeGeometry({ lot: burning, size: 24, project }) as FakeSvgElement;

    expect(root.dataset).toMatchObject({ incidentId: 'fire-m4-t7', fireIntensity: '1', char: '0.64', plume: '0.8' });
    expect(withClass(root, 'market-building-char').length).toBeGreaterThan(0);
    expect(withClass(root, 'market-building-flame').length).toBeGreaterThan(0);
    expect(withClass(root, 'market-building-smoke')).toHaveLength(0);
    expect(smoke.dataset).toMatchObject({ incidentId: 'fire-m4-t7', plume: '0.8', puffsPerLevel: '3' });
    expect(withClass(smoke, 'market-building-smoke-puff')).toHaveLength(Number(smoke.dataset.smokeLevels) * 3);
    expect(withClass(smoke, 'market-building-smoke-puff').every((puff) => puff.getAttribute('fill') !== 'rgb(255, 255, 255)')).toBe(true);
  });

  it('uses distinct smoke-only, climbing, and fully-involved fire stages', () => {
    const smokeOnly = createMarketBuildingWorldGeometry({ lot: lot({ fireIntensity: .29 }), size: 24, project }) as FakeSvgElement;
    const climbing = createMarketBuildingWorldGeometry({ lot: lot({ fireIntensity: .5 }), size: 24, project }) as FakeSvgElement;
    const full = createMarketBuildingWorldGeometry({ lot: lot({ fireIntensity: .8 }), size: 24, project }) as FakeSvgElement;

    expect(withClass(smokeOnly, 'market-building-flame')).toHaveLength(0);
    expect(withData(climbing, 'fireStage', 'climbing')).toHaveLength(1);
    expect(withData(climbing, 'wallFlame').length).toBeGreaterThan(0);
    expect(withData(full, 'fireStage', 'fully-involved')).toHaveLength(1);
    expect(withData(full, 'layout').some((flame) => ['1', '2', '3'].includes(flame.dataset.layout!))).toBe(true);
  });

  it('advances smoke coordinates and all three full-fire layouts from visual phase only', () => {
    const burning = lot({ incidentId: 'fire-m4-t7', fireIntensity: 0.9, plume: 0.8 });
    const structure = createMarketBuildingWorldGeometry({ lot: burning, size: 24, project, phase: 0 }) as FakeSvgElement;
    const smoke = createMarketFireSmokeGeometry({ lot: burning, size: 24, project, phase: 0 }) as FakeSvgElement;
    const puff = withClass(smoke, 'market-building-smoke-puff')[0]!;
    const opening = [puff.getAttribute('cx'), puff.getAttribute('cy'), puff.getAttribute('rx')];
    const layouts = withData(structure, 'marketFireLayout');

    expect(layouts).toHaveLength(3);
    expect(layouts.map((layout) => layout.style.display)).toEqual(['', 'none', 'none']);
    setMarketFireVisualPhase(structure, 0.4);
    setMarketFireVisualPhase(smoke, 0.4);
    expect(layouts.map((layout) => layout.style.display)).toEqual(['none', '', 'none']);
    expect([puff.getAttribute('cx'), puff.getAttribute('cy'), puff.getAttribute('rx')]).not.toEqual(opening);
    expect(JSON.stringify(burning)).toBe(JSON.stringify(lot({ incidentId: 'fire-m4-t7', fireIntensity: 0.9, plume: 0.8 })));
  });

  it.each(['1x1', '1x2', '2x1', '2x2', 'L'] satisfies MarketLotFootprint[])('renders deterministic low rubble inside a %s footprint in every camera rotation', (footprint) => {
    const footprintTiles = { '1x1': 1, '1x2': 2, '2x1': 2, '2x2': 4, L: 3 }[footprint];
    const rubble: MarketRenderRubble = {
      id: 'rubble-fire-m9-t7',
      incidentId: 'fire-m9-t7',
      tileIds: Array.from({ length: footprintTiles }, (_, index) => 7 + index),
      zone: 'R',
      char: 1,
      rubbleMonthsRemaining: 49,
      structure: {
        footprint,
        originTile: 7,
        height: 8,
        roof: 'flat',
        roofHeight: 1,
        roofOrientation: 0,
        detail: null,
        color: [100, 110, 120],
        landmark: false,
      },
    };
    const roots = [0, 1, 2, 3].map((rotation) => createMarketRubbleWorldGeometry({ rubble, project, rotation }) as FakeSvgElement);
    roots.forEach((root) => {
      expect(root.dataset).toMatchObject({ incidentId: 'fire-m9-t7', rubbleMonthsRemaining: '49' });
      expect(withClass(root, 'market-rubble-slab')).toHaveLength(1);
      expect(new Set(withData(root, 'debris').map((element) => element.dataset.debris)).size).toBe(footprintTiles);
      expect(root.getAttribute('aria-label')).toContain(`${footprint} rubble`);
    });
  });

  it('uses camera rotation only for visible faces while preserving the stable roof orientation contract', () => {
    const roots = [0, 1, 2, 3].map((rotation) => createMarketBuildingWorldGeometry({
      lot: lot({ roof: 'wedge', roofOrientation: 3 }),
      size: 24,
      project,
      rotation,
    }) as FakeSvgElement);

    expect(roots.map((root) => root.dataset.roofOrientation)).toEqual(['3', '3', '3', '3']);
    expect(new Set(roots.map((root) => withData(root, 'face').map((face) => face.dataset.face).join(','))).size).toBe(4);
  });

  it.each([
    ['wedge', 4],
    ['gable', 2],
    ['steps', 4],
    ['sawtooth', 4],
    ['core', 2],
    ['mech', 4],
    ['vents', 4],
    ['stack', 4],
  ] satisfies Array<[MarketRoofKind, number]>)('makes all %s oracle orientations physically distinct', (roof, orientationCount) => {
    const signatures = Array.from({ length: orientationCount }, (_, roofOrientation) => geometrySignature(
      createMarketBuildingWorldGeometry({
        lot: lot({ zone: roof === 'gable' || roof === 'wedge' ? 'R' : 'I', roof, roofOrientation }),
        size: 24,
        project,
        rotation: 0,
      }) as FakeSvgElement,
    ));

    expect(new Set(signatures).size).toBe(orientationCount);
  });
});
