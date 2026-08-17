import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error Static browser renderer modules intentionally ship as public JS.
import { NETWORK_WORLD_ART } from '../../public/design-review/catalog-world-art.js';
// @ts-expect-error Static browser renderer modules intentionally ship as public JS.
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

const project = (x: number, y: number, z = 0) => ({ x: 100 + (x - y) * 24, y: 80 + (x + y) * 12 - z * 18 });

describe('Water Services shared world art', () => {
  const priorDocument = globalThis.document;
  beforeEach(() => Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElementNS: (_namespace: string, name: string) => new FakeSvgElement(name) },
  }));
  afterEach(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: priorDocument }));

  it('uses one buried-pipe recipe in the Water card across all rotations', () => {
    expect(NETWORK_WORLD_ART['water-pipe']).toMatchObject({
      family: 'buried-water',
      surface: '#087fd6',
      marking: '#d5f7ff',
      curb: '#034d89',
    });
    for (const rotation of [0, 1, 2, 3]) {
      const card = createCatalogWorldThumbnail({
        kind: 'water-pipe', footprint: { width: 1, height: 1 }, mode: 'underground', rotation, label: 'Water Pipe',
      }) as FakeSvgElement;
      const pipe = withClass(card, 'catalog-thumbnail-underground-water-pipe')[0];
      expect(card.dataset.previewRotation).toBe(String(rotation));
      expect(card.dataset.previewMode).toBe('underground');
      expect(pipe?.dataset.worldRecipeId).toBe('network:water-pipe:v2');
      expect(pipe?.dataset.worldGeometryFingerprint).toBe('network-water-pipe-geometry-v2');
      expect(withClass(pipe!, 'underground-water-jacket')).not.toHaveLength(0);
      expect(withClass(pipe!, 'underground-water-highlight')).not.toHaveLength(0);
    }
  });

  it('shares truthful Water facility recipes between cards and placed structures at every rotation', () => {
    const fixtures = [
      ['water-tower', { width: 2, height: 2 }, ['terrain-facility-water-tank', 'terrain-facility-tower-leg']],
      ['coastal-water-pump', { width: 3, height: 3 }, ['terrain-facility-pump-house', 'terrain-facility-intake-pipe', 'terrain-facility-intake-screen']],
      ['water-treatment-plant', { width: 4, height: 3 }, ['terrain-facility-water-clarifier', 'terrain-facility-water-operations-building']],
    ] as const;
    for (const rotation of [0, 1, 2, 3]) {
      for (const [kind, footprint, classes] of fixtures) {
        const world = createFacilityWorldGeometry({ kind, footprint, project, cellSize: 24, rotation, animate: false }) as FakeSvgElement;
        const card = createCatalogWorldThumbnail({ kind, footprint, rotation, label: kind }) as FakeSvgElement;
        const preview = withClass(card, `facility-${kind}`)[0];
        expect(card.dataset.previewRotation).toBe(String(rotation));
        expect(preview?.dataset.worldRecipeId).toBe(world.dataset.worldRecipeId);
        expect(preview?.dataset.worldGeometryFingerprint).toBe(world.dataset.worldGeometryFingerprint);
        for (const className of classes) expect(withClass(world, className)).not.toHaveLength(0);
      }
    }
  });
});
