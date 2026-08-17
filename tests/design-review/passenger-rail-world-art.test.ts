import { afterEach, beforeEach, describe, expect, it } from 'vitest';
// @ts-expect-error Static browser renderer modules intentionally ship as public JS.
import { NETWORK_WORLD_ART } from '../../public/design-review/catalog-world-art.js';
// @ts-expect-error Static browser renderer modules intentionally ship as public JS.
import { appendNetworkWorldGeometry, createCatalogWorldThumbnail, createFacilityWorldGeometry, createPassengerTrainWorldGeometry } from '../../public/design-review/world-item-renderer.js';

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
const vector = (from: { x: number; y: number }, to: { x: number; y: number }) => ({ x: to.x - from.x, y: to.y - from.y });
const magnitude = (value: { x: number; y: number }) => Math.hypot(value.x, value.y);
const alignment = (left: { x: number; y: number }, right: { x: number; y: number }) => (
  Math.abs((left.x * right.x + left.y * right.y) / (magnitude(left) * magnitude(right)))
);

function lineVector(element: FakeSvgElement): { x: number; y: number } {
  return {
    x: Number(element.getAttribute('x2')) - Number(element.getAttribute('x1')),
    y: Number(element.getAttribute('y2')) - Number(element.getAttribute('y1')),
  };
}

function lineLength(element: FakeSvgElement): number {
  return magnitude(lineVector(element));
}

describe('Passenger Rail shared world art', () => {
  const priorDocument = globalThis.document;
  beforeEach(() => Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { createElementNS: (_namespace: string, name: string) => new FakeSvgElement(name) },
  }));
  afterEach(() => Object.defineProperty(globalThis, 'document', { configurable: true, value: priorDocument }));

  it('renders world-aligned black rails, brown sleepers, and a rail-only junction core', () => {
    expect(NETWORK_WORLD_ART.rail).toMatchObject({
      family: 'rail-track',
      surface: '#cbc7bd',
      marking: '#15171a',
      curb: '#80502f',
    });
    const xAxis = vector(project(0, .5), project(1, .5));
    const yAxis = vector(project(.5, 0), project(.5, 1));
    const world = new FakeSvgElement('g');
    appendNetworkWorldGeometry(world, {
      kind: 'rail',
      segments: [
        {
          start: project(0, .5), end: project(.5, .5), railAxis: 'x', railCrossVector: yAxis,
          railWorldStart: { x: 0, y: .5 }, railWorldEnd: { x: .5, y: .5 },
        },
        {
          start: project(.5, .5), end: project(.5, 0), railAxis: 'y', railCrossVector: xAxis,
          railWorldStart: { x: .5, y: .5 }, railWorldEnd: { x: .5, y: 0 },
        },
        {
          start: project(.5, .5), end: project(1, .5), railAxis: 'x', railCrossVector: yAxis,
          railWorldStart: { x: .5, y: .5 }, railWorldEnd: { x: 1, y: .5 },
        },
      ],
      center: project(.5, .5),
      railTopology: 'tee',
    });
    expect(world.dataset.worldRecipeId).toBe('network:rail:v5');
    expect(world.dataset.worldGeometryFingerprint).toBe('network-rail-geometry-v5');
    expect(withClass(world, 'terrain-rail-ballast')).toHaveLength(3);
    expect(withClass(world, 'terrain-rail-track')).toHaveLength(6);
    expect(withClass(world, 'terrain-rail-sleeper').length).toBeGreaterThan(3);
    expect(withClass(world, 'terrain-network-node-rail')).toHaveLength(0);
    expect(withClass(world, 'terrain-rail-frog')).toHaveLength(1);
    const sleepers = withClass(world, 'terrain-rail-sleeper');
    expect(sleepers.every((sleeper) => sleeper.getAttribute('stroke') === '#80502f')).toBe(true);
    const xSleepers = sleepers.filter((sleeper) => sleeper.dataset.railAxis === 'x');
    const ySleepers = sleepers.filter((sleeper) => sleeper.dataset.railAxis === 'y');
    expect(xSleepers.length).toBeGreaterThan(0);
    expect(ySleepers.length).toBeGreaterThan(0);
    expect(xSleepers.every((sleeper) => alignment(lineVector(sleeper), yAxis) > .995)).toBe(true);
    expect(ySleepers.every((sleeper) => alignment(lineVector(sleeper), xAxis) > .995)).toBe(true);
  });

  it('uses a ninety-percent cross-track envelope without shortening continuous tile seams', () => {
    const xAxis = vector(project(0, .5), project(1, .5));
    const yAxis = vector(project(.5, 0), project(.5, 1));
    const world = new FakeSvgElement('g');
    appendNetworkWorldGeometry(world, {
      kind: 'rail',
      segments: [{
        start: project(0, .5), end: project(1, .5), railAxis: 'x', railCrossVector: yAxis,
        railWorldStart: { x: 0, y: .5 }, railWorldEnd: { x: 1, y: .5 },
      }],
      center: project(.5, .5),
      railTopology: 'straight',
    });

    const [ballast] = withClass(world, 'terrain-rail-ballast');
    const [firstRail, secondRail] = withClass(world, 'terrain-rail-track');
    const [firstTie] = withClass(world, 'terrain-rail-sleeper');
    expect(ballast?.dataset.crossTrackScale).toBe('0.9');
    expect(Number(ballast?.getAttribute('stroke-width'))).toBeCloseTo(8.46, 6);
    expect(firstRail?.dataset.crossTrackScale).toBe('0.9');
    expect(secondRail?.dataset.crossTrackScale).toBe('0.9');
    // SVG points are serialized at two decimal places; retain enough tolerance
    // for that projection rounding while pinning the 4.005-unit half span.
    expect(lineLength(firstTie!)).toBeCloseTo(8.01, 2);

    const railGauge = magnitude({
      x: Number(firstRail?.getAttribute('x1')) - Number(secondRail?.getAttribute('x1')),
      y: Number(firstRail?.getAttribute('y1')) - Number(secondRail?.getAttribute('y1')),
    });
    expect(railGauge).toBeCloseTo(3.87, 2);

    // The 90% treatment is lateral only: the center ballast and both laterally
    // offset rails still traverse exactly one world tile without a seam gap.
    expect(ballast?.getAttribute('x1')).toBe(project(0, .5).x.toFixed(2));
    expect(ballast?.getAttribute('y1')).toBe(project(0, .5).y.toFixed(2));
    expect(ballast?.getAttribute('x2')).toBe(project(1, .5).x.toFixed(2));
    expect(ballast?.getAttribute('y2')).toBe(project(1, .5).y.toFixed(2));
    [ballast, firstRail, secondRail].forEach((line) => {
      expect(lineLength(line!)).toBeCloseTo(magnitude(xAxis), 6);
      expect(line?.getAttribute('stroke-linecap')).toBe('butt');
    });
  });

  it('uses paired gentle curves instead of a sharp center-arm corner', () => {
    const xAxis = vector(project(0, .5), project(1, .5));
    const yAxis = vector(project(.5, 0), project(.5, 1));
    const world = new FakeSvgElement('g');
    appendNetworkWorldGeometry(world, {
      kind: 'rail',
      segments: [
        {
          start: project(.5, .5), end: project(1, .5), railAxis: 'x', railCrossVector: yAxis,
          railWorldStart: { x: .5, y: .5 }, railWorldEnd: { x: 1, y: .5 },
        },
        {
          start: project(.5, .5), end: project(.5, 0), railAxis: 'y', railCrossVector: xAxis,
          railWorldStart: { x: .5, y: .5 }, railWorldEnd: { x: .5, y: 0 },
        },
      ],
      center: project(.5, .5),
      railTopology: 'corner',
    });
    expect(withClass(world, 'terrain-rail-curve')).toHaveLength(3);
    expect(withClass(world, 'terrain-network-node-rail')).toHaveLength(0);
    expect(withClass(world, 'terrain-rail-track').filter((element) => element.tagName === 'path')).toHaveLength(2);
  });

  it('keeps sleepers on the opposite projected world axis and phase-locks them across tile seams in every rotation', () => {
    const rotatedAxes = [
      [{ x: 24, y: 12 }, { x: -24, y: 12 }],
      [{ x: -24, y: 12 }, { x: -24, y: -12 }],
      [{ x: -24, y: -12 }, { x: 24, y: -12 }],
      [{ x: 24, y: -12 }, { x: 24, y: 12 }],
    ] as const;
    rotatedAxes.forEach(([xAxis, yAxis], rotation) => {
      const rotatedProject = (x: number, y: number) => ({
        x: 100 + x * xAxis.x + y * yAxis.x,
        y: 80 + x * xAxis.y + y * yAxis.y,
      });
      const world = new FakeSvgElement('g');
      appendNetworkWorldGeometry(world, {
        kind: 'rail',
        segments: [
          {
            start: rotatedProject(0, .5), end: rotatedProject(1, .5), railAxis: 'x', railCrossVector: yAxis,
            railWorldStart: { x: 0, y: .5 }, railWorldEnd: { x: 1, y: .5 },
          },
          {
            start: rotatedProject(1, .5), end: rotatedProject(2, .5), railAxis: 'x', railCrossVector: yAxis,
            railWorldStart: { x: 1, y: .5 }, railWorldEnd: { x: 2, y: .5 },
          },
        ],
        center: rotatedProject(1, .5),
        railTopology: 'straight',
      });
      const sleepers = withClass(world, 'terrain-rail-sleeper');
      expect(sleepers.length, `rotation ${rotation}`).toBeGreaterThan(8);
      expect(sleepers.every((sleeper) => alignment(lineVector(sleeper), yAxis) > .995), `rotation ${rotation}`).toBe(true);
      const phasesBySegment = [0, 1].map((segmentIndex) => sleepers
        .filter((sleeper) => Number(sleeper.dataset.segmentIndex) === segmentIndex)
        .map((sleeper) => Number(sleeper.dataset.tiePhase)));
      const lastBeforeSeam = phasesBySegment[0]!.at(-1)!;
      const firstAfterSeam = phasesBySegment[1]![0]!;
      expect(phasesBySegment[0], `rotation ${rotation} first tile cadence`).toEqual([
        1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12,
      ].map((phase) => Number(phase.toFixed(8))));
      expect(phasesBySegment[1], `rotation ${rotation} second tile cadence`).toEqual([
        1 / 12, 3 / 12, 5 / 12, 7 / 12, 9 / 12, 11 / 12,
      ].map((phase) => Number(phase.toFixed(8))));
      expect(1 + firstAfterSeam - lastBeforeSeam, `rotation ${rotation}`).toBeCloseTo(1 / 6, 6);
      expect(withClass(world, 'terrain-rail-ballast').every((line) => line.getAttribute('stroke-linecap') === 'butt')).toBe(true);
      expect(withClass(world, 'terrain-rail-track').every((line) => line.getAttribute('stroke-linecap') === 'butt')).toBe(true);
      expect(withClass(world, 'terrain-rail-ballast').every((line) => line.dataset.seamContract === 'continuous-world-edge')).toBe(true);
      expect(withClass(world, 'terrain-rail-track').every((line) => line.dataset.tieCadence === '1/12+n/6-world-tiles')).toBe(true);
      ['terrain-rail-ballast', 'terrain-rail-track'].forEach((className) => {
        const first = withClass(world, className).filter((line) => line.dataset.segmentIndex === '0');
        const second = withClass(world, className).filter((line) => line.dataset.segmentIndex === '1');
        expect(first.length, `rotation ${rotation} first ${className}`).toBeGreaterThan(0);
        expect(second.length, `rotation ${rotation} second ${className}`).toBeGreaterThan(0);
        first.forEach((line, index) => {
          expect(line.getAttribute('x2'), `rotation ${rotation} ${className} x seam`).toBe(second[index]?.getAttribute('x1'));
          expect(line.getAttribute('y2'), `rotation ${rotation} ${className} y seam`).toBe(second[index]?.getAttribute('y1'));
        });
      });
    });
  });

  it('shares exact Rail and Train Station recipes across all four rotations', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const railCard = createCatalogWorldThumbnail({
        kind: 'rail', footprint: { width: 1, height: 1 }, mode: 'network', rotation, label: 'Rail',
      }) as FakeSvgElement;
      const rail = withClass(railCard, 'catalog-thumbnail-network-rail')[0];
      expect(rail?.dataset.worldRecipeId).toBe('network:rail:v5');
      expect(rail?.dataset.worldGeometryFingerprint).toBe('network-rail-geometry-v5');
      expect(railCard.dataset.previewRotation).toBe(String(rotation));

      const station = createFacilityWorldGeometry({
        kind: 'train-station', footprint: { width: 2, height: 2 }, project, cellSize: 24, rotation, animate: false,
      }) as FakeSvgElement;
      const stationCard = createCatalogWorldThumbnail({
        kind: 'train-station', footprint: { width: 2, height: 2 }, rotation, label: 'Train Station',
      }) as FakeSvgElement;
      const previewStation = withClass(stationCard, 'facility-train-station')[0];
      expect(station.dataset.worldRecipeId).toBe('facility:train-station:v2');
      expect(station.dataset.worldGeometryFingerprint).toBe('facility-train-station-geometry-v2');
      expect(previewStation?.dataset.worldRecipeId).toBe(station.dataset.worldRecipeId);
      expect(previewStation?.dataset.worldGeometryFingerprint).toBe(station.dataset.worldGeometryFingerprint);
      expect(withClass(station, 'terrain-facility-platform')).not.toHaveLength(0);
      expect(withClass(station, 'terrain-facility-station-hall')).not.toHaveLength(0);
      expect(withClass(station, 'terrain-facility-station-canopy')).not.toHaveLength(0);
    }
  });

  it('renders a compact original passenger shuttle with a cab and readable windows', () => {
    const shuttle = createPassengerTrainWorldGeometry({
      center: { x: 120, y: 80 },
      heading: { x: 1, y: .5 },
      cellSize: 24,
      data: { legId: 'rail-leg-1', direction: 'forward' },
    }) as FakeSvgElement;
    expect(shuttle.dataset.worldRecipeId).toBe('vehicle:passenger-train:v1');
    expect(shuttle.dataset.worldGeometryFingerprint).toBe('vehicle-passenger-train-geometry-v1');
    expect(withClass(shuttle, 'market-train-shuttle-car')).toHaveLength(1);
    expect(withClass(shuttle, 'market-train-shuttle-window')).toHaveLength(4);
    expect(withClass(shuttle, 'market-train-shuttle-cab')).toHaveLength(1);
  });
});
