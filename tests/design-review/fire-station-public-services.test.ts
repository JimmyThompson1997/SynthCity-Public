import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-ignore Static browser renderer modules intentionally ship as public JS.
import { FACILITY_WORLD_ART, FACILITY_WORLD_ART_VARIANTS } from '../../public/design-review/catalog-world-art.js';
// @ts-ignore Static browser renderer modules intentionally ship as public JS.
import { createCatalogWorldThumbnail, createFacilityWorldGeometry } from '../../public/design-review/world-item-renderer.js';

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

describe('Fire Station shared public-services art', () => {
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

  it('uses a simple two-tile-tall civic cube with apparatus-bay details', () => {
    expect(FACILITY_WORLD_ART['fire-station']).toMatchObject({
      family: 'civic-fire',
      geometry: {
        bodyHeight: 2,
        accessory: 'apparatus-bays',
      },
    });

    const world = createFacilityWorldGeometry({
      kind: 'fire-station',
      footprint: { width: 1, height: 1 },
      project,
      cellSize: 24,
      rotation: 0,
      animate: false,
    }) as FakeSvgElement;

    expect(withClass(world, 'terrain-facility-fire-bay')).toHaveLength(2);
    expect(withClass(world, 'terrain-facility-fire-tower')).toHaveLength(0);
    expect(withClass(world, 'terrain-facility-volume')).not.toHaveLength(0);
  });

  it('keeps catalog and placed geometry on the same recipe in all four rotations', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const world = createFacilityWorldGeometry({
        kind: 'fire-station',
        footprint: { width: 1, height: 1 },
        project,
        cellSize: 24,
        rotation,
        animate: false,
      }) as FakeSvgElement;
      const thumbnail = createCatalogWorldThumbnail({
        kind: 'fire-station',
        footprint: { width: 1, height: 1 },
        rotation,
        label: 'Fire Station',
      }) as FakeSvgElement;
      const previewWorld = withClass(thumbnail, 'facility-fire-station')[0];

      expect(previewWorld).toBeDefined();
      expect(previewWorld?.dataset.worldRecipeId).toBe(world.dataset.worldRecipeId);
      expect(previewWorld?.dataset.worldGeometryFingerprint).toBe(world.dataset.worldGeometryFingerprint);
      expect(previewWorld?.dataset.artFamily).toBe('civic-fire');
      expect(previewWorld?.dataset.artAccessory).toBe('apparatus-bays');
      expect(thumbnail.dataset.previewRotation).toBe(String(rotation));
    }
  });

  it('renders the dormant modern Fire Station candidate on a separate, matching world recipe', () => {
    expect(FACILITY_WORLD_ART_VARIANTS['facility:fire-station:modern-test']).toMatchObject({
      family: 'civic-fire-modern',
      geometry: { accessory: 'three-glass-bays-and-roof-beacon' },
    });
    const world = createFacilityWorldGeometry({
      kind: 'fire-station',
      visualVariantId: 'facility:fire-station:modern-test',
      footprint: { width: 1, height: 1 },
      project,
      cellSize: 24,
      rotation: 0,
      animate: false,
    }) as FakeSvgElement;
    const thumbnail = createCatalogWorldThumbnail({
      kind: 'fire-station',
      visualVariantId: 'facility:fire-station:modern-test',
      footprint: { width: 1, height: 1 },
      label: 'Fire Station — Modern Test',
    }) as FakeSvgElement;
    const previewWorld = withClass(thumbnail, 'facility-fire-station')[0];

    expect(world.dataset.worldRecipeId).toBe('facility:fire-station-civic-fire-modern-test:v2');
    expect(world.dataset.artFamily).toBe('civic-fire-modern');
    expect(withClass(world, 'terrain-facility-fire-modern-bay')).toHaveLength(3);
    expect(withClass(world, 'terrain-facility-fire-modern-beacon')).toHaveLength(1);
    expect(previewWorld?.dataset.worldRecipeId).toBe(world.dataset.worldRecipeId);
    expect(previewWorld?.dataset.artFamily).toBe('civic-fire-modern');
  });
});
