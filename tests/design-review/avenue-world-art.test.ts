import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore Static browser renderer modules intentionally ship as public JS.
import { NETWORK_WORLD_ART } from '../../public/design-review/catalog-world-art.js';
// @ts-ignore Static browser renderer modules intentionally ship as public JS.
import { appendAvenueWorldGeometry, createCatalogWorldThumbnail } from '../../public/design-review/world-item-renderer.js';

class FakeSvgElement {
  readonly tagName: string;
  readonly attributes = new Map<string, string>();
  readonly children: FakeSvgElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (...names: string[]) => {
      const existing = (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      this.setAttribute('class', [...new Set([...existing, ...names])].join(' '));
    },
  };

  constructor(tagName: string) { this.tagName = tagName; }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      this.dataset[key] = value;
    }
  }

  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null; }
  append(...nodes: FakeSvgElement[]): void { this.children.push(...nodes); }
}

function descendants(root: FakeSvgElement): FakeSvgElement[] {
  return root.children.flatMap((child) => [child, ...descendants(child)]);
}

function withClass(root: FakeSvgElement, className: string): FakeSvgElement[] {
  return [root, ...descendants(root)].filter((element) => (
    (element.getAttribute('class') ?? '').split(/\s+/).includes(className)
  ));
}

const project = (x: number, y: number, z = 0) => ({
  x: 100 + (x - y) * 24,
  y: 80 + (x + y) * 12 - z * 18,
});

describe('Avenue shared catalog and world art', () => {
  const priorDocument = globalThis.document;

  beforeEach(() => {
    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: { createElementNS: (_namespace: string, name: string) => new FakeSvgElement(name) },
    });
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'document', { configurable: true, value: priorDocument });
  });

  it('renders paired asphalt carriageways, a median, and opposing right-hand arrows', () => {
    expect(NETWORK_WORLD_ART.avenue).toMatchObject({ family: 'paired-one-way-avenue' });
    const world = new FakeSvgElement('g');
    appendAvenueWorldGeometry(world, {
      project,
      travelMask: 2,
      pairMask: 4,
      laneRole: 'drawn',
      tile: { x: 3, y: 4 },
    });

    expect(world.dataset.worldRecipeId).toBe('network:avenue:v1');
    expect(world.dataset.worldGeometryFingerprint).toBe('network-avenue-geometry-v1');
    expect(world.dataset.travelMask).toBe('2');
    expect(world.dataset.pairMask).toBe('4');
    expect(world.dataset.laneDirection).toBe('east');
    expect(world.dataset.drivingSide).toBe('right');
    expect(withClass(world, 'terrain-avenue-carriageway')).toHaveLength(1);
    expect(withClass(world, 'terrain-avenue-median-edge')).toHaveLength(1);
    expect(withClass(world, 'terrain-avenue-direction-marking')).toHaveLength(1);
  });

  it('keeps terminal and single-click lane tiles visually directional from their median side', () => {
    const westLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(westLane, {
      project,
      travelMask: 0,
      pairMask: 2,
      laneRole: 'canonical',
      tile: { x: 20, y: 20 },
    });
    const eastLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(eastLane, {
      project,
      travelMask: 0,
      pairMask: 8,
      laneRole: 'canonical',
      tile: { x: 21, y: 20 },
    });

    expect(westLane.dataset.laneDirection).toBe('none');
    expect(eastLane.dataset.laneDirection).toBe('none');
    expect(withClass(westLane, 'terrain-avenue-direction-marking')).toHaveLength(1);
    expect(withClass(eastLane, 'terrain-avenue-direction-marking')).toHaveLength(1);
    expect(withClass(westLane, 'terrain-avenue-direction-marking')[0]?.dataset.direction).toBe('south');
    expect(withClass(eastLane, 'terrain-avenue-direction-marking')[0]?.dataset.direction).toBe('north');
    expect(withClass(westLane, 'terrain-avenue-direction-marking')[0]?.dataset.directionSource).toBe('median-fallback');
    expect(withClass(eastLane, 'terrain-avenue-direction-marking')[0]?.dataset.directionSource).toBe('median-fallback');
  });

  it('keeps the established median while a one-sided Avenue merge flows into the matching lane', () => {
    const mergeLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(mergeLane, {
      project,
      // South is both travel and a paired edge: this is the exact side where
      // the incoming lane merges into another Avenue's one-way lane.
      travelMask: 6,
      pairMask: 3,
      laneRole: 'canonical',
      tile: { x: 20, y: 12 },
    });

    expect(mergeLane.dataset.mergeFlowMask).toBe('2');
    expect(withClass(mergeLane, 'terrain-avenue-median-edge')).toHaveLength(2);
    expect(withClass(mergeLane, 'terrain-avenue-median-edge')[0]?.dataset.edge).toBe('north');
    expect(withClass(mergeLane, 'terrain-avenue-direction-marking')).toHaveLength(1);
    expect(withClass(mergeLane, 'terrain-avenue-direction-marking')[0]?.dataset.direction).toBe('east');
    expect(withClass(mergeLane, 'terrain-avenue-direction-marking')[0]?.dataset.directionSource).toBe('merge-flow');
  });

  it('renders a shared junction cell as neutral asphalt when its internal seams are suppressed', () => {
    const junctionLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(junctionLane, {
      project,
      travelMask: 6,
      pairMask: 3,
      medianMask: 3,
      suppressMedianMask: 3,
      suppressDirection: true,
      laneRole: 'canonical',
      tile: { x: 20, y: 12 },
    });

    expect(junctionLane.dataset.suppressedMedianMask).toBe('3');
    expect(withClass(junctionLane, 'terrain-avenue-median-edge')).toHaveLength(0);
    expect(withClass(junctionLane, 'terrain-avenue-direction-marking')).toHaveLength(0);
  });

  it('uses recorded median paint rather than later merged pair topology', () => {
    const establishedLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(establishedLane, {
      project,
      travelMask: 6,
      pairMask: 3,
      // The later crossing added the east pair bit. This was painted only
      // north/south when the original through-Avenue was built.
      medianMask: 1,
      laneRole: 'canonical',
      tile: { x: 20, y: 12 },
    });

    expect(establishedLane.dataset.medianMask).toBe('1');
    expect(withClass(establishedLane, 'terrain-avenue-median-edge')).toHaveLength(1);
    expect(withClass(establishedLane, 'terrain-avenue-median-edge')[0]?.dataset.edge).toBe('north');
  });

  it('removes every supplied shared-junction median seam, not just the merge-flow edge', () => {
    const junctionLane = new FakeSvgElement('g');
    appendAvenueWorldGeometry(junctionLane, {
      project,
      travelMask: 12,
      pairMask: 6,
      suppressMedianMask: 6,
      laneRole: 'canonical',
      tile: { x: 13, y: 21 },
    });

    expect(junctionLane.dataset.suppressedMedianMask).toBe('6');
    expect(withClass(junctionLane, 'terrain-avenue-median-edge')).toHaveLength(0);
  });

  it('uses the exact avenue recipe in the catalog at all four rotations', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const thumbnail = createCatalogWorldThumbnail({
        kind: 'avenue', footprint: { width: 2, height: 2 }, mode: 'network', rotation, label: 'Avenue',
      }) as FakeSvgElement;
      const world = withClass(thumbnail, 'catalog-thumbnail-network-avenue')[0];
      expect(world?.dataset.worldRecipeId).toBe('network:avenue:v1');
      expect(world?.dataset.worldGeometryFingerprint).toBe('network-avenue-geometry-v1');
      expect(world?.dataset.artFamily).toBe('paired-one-way-avenue');
      expect(world?.dataset.drivingSide).toBe('right');
      expect(withClass(world!, 'terrain-avenue-carriageway')).toHaveLength(2);
      expect(withClass(world!, 'terrain-avenue-direction-marking')).toHaveLength(2);
      expect(thumbnail.dataset.previewRotation).toBe(String(rotation));
    }
  });
});
