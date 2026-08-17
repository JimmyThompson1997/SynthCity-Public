import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error Static browser renderer modules intentionally ship as public JS.
import { createCatalogWorldThumbnail, createLandfillWorldGeometry } from '../../public/design-review/world-item-renderer.js';

class FakeSvgElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeSvgElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly classList = {
    add: (...names: string[]) => {
      const existing = (this.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
      this.setAttribute('class', [...new Set([...existing, ...names])].join(' '));
    },
  };

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

describe('Landfill Zone shared world art', () => {
  const priorDocument = globalThis.document;

  beforeEach(() => Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElementNS: () => new FakeSvgElement() },
  }));
  afterEach(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: priorDocument }));

  it('renders every deterministic fill stage with truthful brown-soil progression', () => {
    const fixtures = [
      [0, 'empty', 'terrain-landfill-soil'],
      [1, 'scattered', 'terrain-landfill-refuse'],
      [2_500, 'low', 'terrain-landfill-mound'],
      [5_000, 'medium', 'terrain-landfill-mound'],
      [7_500, 'high', 'terrain-landfill-mound'],
      [10_000, 'full', 'terrain-landfill-full-marker'],
    ] as const;

    for (const [storedTenths, stage, expectedClass] of fixtures) {
      const world = createLandfillWorldGeometry({
        project,
        cellSize: 24,
        rotation: 0,
        storedTenths,
        capacityTenths: 10_000,
      }) as FakeSvgElement;
      expect(world.dataset.worldRecipeId).toBe('service-zone:landfill:v2');
      expect(world.dataset.worldGeometryFingerprint).toBe('service-zone-landfill-geometry-v2');
      expect(world.dataset.fillStage).toBe(stage);
      expect(world.dataset.storedTenths).toBe(String(storedTenths));
      expect(world.dataset.capacityTenths).toBe('10000');
      expect(withClass(world, expectedClass)).not.toHaveLength(0);
    }
  });

  it('uses an opaque, light soil surface that overlaps its cell edge cleanly', () => {
    const world = createLandfillWorldGeometry({
      project,
      cellSize: 24,
      rotation: 0,
    }) as FakeSvgElement;
    const soil = withClass(world, 'terrain-landfill-soil')[0];

    expect(soil?.getAttribute('fill')).toBe('#b98a63');
    expect(soil?.getAttribute('stroke')).toBe('none');
    // The soil must bleed very slightly beyond the shared tile edge so the
    // grass/grid beneath cannot form green hairline seams between cells.
    expect(soil?.getAttribute('points')).toContain('100.00,79.39');
  });

  it('uses the identical empty-soil recipe in the Waste catalog card across all rotations', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const card = createCatalogWorldThumbnail({
        kind: 'landfill', footprint: { width: 1, height: 1 }, mode: 'service-zone', rotation, label: 'Landfill Zone',
      }) as FakeSvgElement;
      const world = withClass(card, 'terrain-landfill-world')[0];
      expect(card.dataset.previewRotation).toBe(String(rotation));
      expect(card.dataset.previewMode).toBe('service-zone');
      expect(world?.dataset.worldRecipeId).toBe('service-zone:landfill:v2');
      expect(world?.dataset.worldGeometryFingerprint).toBe('service-zone-landfill-geometry-v2');
      expect(world?.dataset.fillStage).toBe('empty');
      expect(withClass(world!, 'terrain-landfill-soil')).not.toHaveLength(0);
    }
  });
});
