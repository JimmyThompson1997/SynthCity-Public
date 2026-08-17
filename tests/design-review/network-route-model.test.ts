import { describe, expect, it } from 'vitest';
// @ts-expect-error Static public review modules are executed directly by the page.
import * as networkRouteModel from '../../public/design-review/network-route-model.js';
import { deriveAvenueRibbon } from '../../src/market-city/avenue';

const {
  cardinalSegment,
  endpointRouteCandidates,
  endpointRouteVariantForPointer,
  isCardinalNeighbor,
  proposeEndpointNetworkRoute,
  proposeNetworkRouteExtension,
  validateSimpleNetworkRoute
} = networkRouteModel;
const { deriveAvenuePreviewRibbon } = networkRouteModel;

type AvenuePreviewCell = {
  x: number;
  y: number;
  laneRole: 'drawn' | 'paired';
  travelMask: number;
  pairMask: number;
};

type AvenuePreviewResult = {
  accepted: boolean;
  reason?: string | null;
  reasonCode?: string | null;
  cells: AvenuePreviewCell[];
};

const previewAvenue = (
  route: ReadonlyArray<{ x: number; y: number }>,
  width: number,
  height: number,
  side: 'left' | 'right',
): AvenuePreviewResult => deriveAvenuePreviewRibbon(route, width, height, side) as AvenuePreviewResult;

describe('design-review network gesture model', () => {
  it('accepts one four-connected line and preserves same-axis fast pointer sampling', () => {
    expect(isCardinalNeighbor({ x: 4, y: 6 }, { x: 5, y: 6 })).toBe(true);
    expect(isCardinalNeighbor({ x: 4, y: 6 }, { x: 5, y: 7 })).toBe(false);
    expect(cardinalSegment({ x: 4, y: 6 }, { x: 8, y: 6 })).toEqual({
      accepted: true,
      cells: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }]
    });
  });

  it('resolves diagonal endpoints into two clean right-angle candidates', () => {
    expect(cardinalSegment({ x: 4, y: 6 }, { x: 5, y: 7 })).toMatchObject({
      accepted: false,
      reason: 'Network route must move through shared tile sides.'
    });
    expect(endpointRouteCandidates({ x: 4, y: 6 }, { x: 7, y: 8 })).toEqual({
      accepted: true,
      kind: 'orthogonal',
      candidates: [
        { variant: 'x-first', corner: { x: 7, y: 6 }, cells: [{ x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }] },
        { variant: 'y-first', corner: { x: 4, y: 8 }, cells: [{ x: 4, y: 6 }, { x: 4, y: 7 }, { x: 4, y: 8 }, { x: 5, y: 8 }, { x: 6, y: 8 }, { x: 7, y: 8 }] }
      ]
    });
  });

  it('does not turn cursor samples into route cells', () => {
    const route = proposeEndpointNetworkRoute({ x: 10, y: 10 }, { x: 14, y: 13 });
    expect(route).toMatchObject({
      accepted: true,
      kind: 'orthogonal',
      variant: 'x-first',
      corner: { x: 14, y: 10 },
      route: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }, { x: 14, y: 10 }, { x: 14, y: 11 }, { x: 14, y: 12 }, { x: 14, y: 13 }]
    });
    expect(route.route).not.toContainEqual({ x: 10, y: 11 });
    expect(proposeEndpointNetworkRoute({ x: 10, y: 10 }, { x: 14, y: 13 }, 'y-first')).toMatchObject({
      variant: 'y-first',
      corner: { x: 10, y: 13 },
      route: [{ x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }, { x: 10, y: 13 }, { x: 11, y: 13 }, { x: 12, y: 13 }, { x: 13, y: 13 }, { x: 14, y: 13 }]
    });
  });

  it('selects exactly one L route from the projected predecessor side of endpoint B', () => {
    const tileBounds = { left: 100, width: 40 };
    expect(endpointRouteVariantForPointer(tileBounds, 105, 'x-first', { 'x-first': 90, 'y-first': 150 })).toBe('x-first');
    expect(endpointRouteVariantForPointer(tileBounds, 138, 'x-first', { 'x-first': 90, 'y-first': 150 })).toBe('y-first');
    expect(endpointRouteVariantForPointer(tileBounds, 105, 'x-first', { 'x-first': 150, 'y-first': 90 })).toBe('y-first');
    expect(endpointRouteVariantForPointer(tileBounds, 138, 'x-first', { 'x-first': 150, 'y-first': 90 })).toBe('x-first');
    expect(endpointRouteVariantForPointer(null, Number.NaN)).toBe('x-first');
  });

  it('holds the previous L route inside the endpoint center hysteresis band', () => {
    const tileBounds = { left: 100, width: 40 };
    const projected = { 'x-first': 90, 'y-first': 150 };
    expect(endpointRouteVariantForPointer(tileBounds, 116.9, 'y-first', projected, 3)).toBe('x-first');
    expect(endpointRouteVariantForPointer(tileBounds, 117, 'y-first', projected, 3)).toBe('y-first');
    expect(endpointRouteVariantForPointer(tileBounds, 120, 'x-first', projected, 3)).toBe('x-first');
    expect(endpointRouteVariantForPointer(tileBounds, 123, 'y-first', projected, 3)).toBe('y-first');
    expect(endpointRouteVariantForPointer(tileBounds, 123.1, 'x-first', projected, 3)).toBe('y-first');
  });

  it('keeps aligned endpoints as one straight segment', () => {
    expect(proposeEndpointNetworkRoute({ x: 8, y: 12 }, { x: 8, y: 15 })).toEqual({
      accepted: true,
      kind: 'straight',
      variant: 'straight',
      corner: null,
      route: [{ x: 8, y: 12 }, { x: 8, y: 13 }, { x: 8, y: 14 }, { x: 8, y: 15 }]
    });
  });

  it('rejects retracing, self-branches, crossings, and loops atomically', () => {
    const first = proposeNetworkRouteExtension([], { x: 10, y: 10 });
    const east = proposeNetworkRouteExtension(first.route, { x: 14, y: 10 });
    expect(east).toMatchObject({ accepted: true, route: [
      { x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }, { x: 13, y: 10 }, { x: 14, y: 10 }
    ] });
    const retrace = proposeNetworkRouteExtension(east.route, { x: 11, y: 10 });
    expect(retrace).toMatchObject({
      accepted: false,
      route: east.route,
      reason: 'Network route cannot retrace, branch, cross, or loop within one gesture.'
    });
    expect(proposeNetworkRouteExtension(retrace.route, { x: 11, y: 9 })).toMatchObject({
      accepted: false,
      route: east.route,
      reason: 'Network route must move through shared tile sides.'
    });
    expect(validateSimpleNetworkRoute([
      { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 2, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 1 }
    ])).toMatchObject({ accepted: false, reason: 'Network route cannot retrace, branch, cross, or loop within one gesture.' });
  });

  it('allows a new gesture to begin on an already-committed network cell', () => {
    expect(proposeNetworkRouteExtension([{ x: 20, y: 20 }], { x: 20, y: 17 })).toMatchObject({ accepted: true, route: [
      { x: 20, y: 20 }, { x: 20, y: 19 }, { x: 20, y: 18 }, { x: 20, y: 17 }
    ] });
  });

  it('derives a complete two-tile avenue ribbon and preserves the outer corner', () => {
    expect(previewAvenue([
      { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 }, { x: 6, y: 5 }, { x: 6, y: 6 }
    ], 48, 48, 'left')).toMatchObject({
      accepted: true,
      cells: expect.arrayContaining([
        expect.objectContaining({ x: 4, y: 4, laneRole: 'drawn', travelMask: 2 }),
        expect.objectContaining({ x: 4, y: 3, laneRole: 'paired', travelMask: 0 }),
        expect.objectContaining({ x: 7, y: 3, laneRole: 'paired' }),
        expect.objectContaining({ x: 7, y: 6, laneRole: 'paired', travelMask: 1 })
      ])
    });
    expect(previewAvenue([{ x: 0, y: 0 }, { x: 1, y: 0 }], 48, 48, 'left'))
      .toMatchObject({ accepted: false, reason: expect.stringMatching(/outside/i) });
  });

  it('does not merge inner-bend companion travel into drawn lanes for any turn and side', () => {
    const routes = [
      [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 9 }],
      [{ x: 8, y: 8 }, { x: 9, y: 8 }, { x: 9, y: 7 }],
      [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 7, y: 9 }],
      [{ x: 8, y: 8 }, { x: 7, y: 8 }, { x: 7, y: 7 }],
    ];
    for (const route of routes) for (const side of ['left', 'right'] as const) {
      const result = previewAvenue(route, 48, 48, side);
      expect(result.accepted).toBe(true);
      const drawn = result.cells.filter((cell) => cell.laneRole === 'drawn');
      expect(drawn.map(({ x, y }) => `${x},${y}`).sort()).toEqual(route.map(({ x, y }) => `${x},${y}`).sort());
      expect(drawn.every((cell) => cell.travelMask === 0 || [1, 2, 4, 8].includes(cell.travelMask))).toBe(true);
      expect(result.cells.every((cell) => (cell.travelMask & cell.pairMask) === 0)).toBe(true);
    }
  });

  it('keeps the ordered route forward when its companion side changes', () => {
    const route = [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }];
    const left = previewAvenue(route, 48, 48, 'left');
    const right = previewAvenue(route, 48, 48, 'right');
    expect(left.cells.find((cell) => cell.x === 10 && cell.y === 10)).toMatchObject({ laneRole: 'drawn', travelMask: 2 });
    expect(left.cells.find((cell) => cell.x === 12 && cell.y === 10)).toMatchObject({ laneRole: 'drawn', travelMask: 0 });
    expect(right.cells.find((cell) => cell.x === 10 && cell.y === 10)).toMatchObject({ laneRole: 'drawn', travelMask: 2 });
    expect(right.cells.find((cell) => cell.x === 12 && cell.y === 10)).toMatchObject({ laneRole: 'drawn', travelMask: 0 });
    expect(right.cells.find((cell) => cell.x === 11 && cell.y === 11)).toMatchObject({ laneRole: 'paired', travelMask: 8 });
  });

  it('rejects a one-cell Avenue preview until the player drags a two-tile route', () => {
    expect(previewAvenue([{ x: 10, y: 10 }], 48, 48, 'left')).toMatchObject({
      accepted: false,
      reason: 'Avenue requires a two-tile drag to create a 2 × 2 paired-lane block.',
      reasonCode: 'avenue-requires-two-route-tiles',
      cells: [
        { x: 10, y: 10, laneRole: 'drawn', travelMask: 0, pairMask: 0 },
      ],
    });
    const eastbound = previewAvenue([{ x: 10, y: 10 }, { x: 11, y: 10 }], 48, 48, 'left');
    const westbound = previewAvenue([{ x: 11, y: 10 }, { x: 10, y: 10 }], 48, 48, 'left');
    expect(eastbound.accepted).toBe(true);
    expect(eastbound.cells).toContainEqual(expect.objectContaining({ x: 10, y: 10, laneRole: 'drawn', travelMask: 2 }));
    expect(westbound.accepted).toBe(true);
    expect(westbound.cells).toContainEqual(expect.objectContaining({ x: 11, y: 10, laneRole: 'drawn', travelMask: 8 }));
  });

  it('keeps an edge-side rejection distinct from its valid mirrored candidate', () => {
    const route = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
    expect(previewAvenue(route, 48, 48, 'left')).toMatchObject({
      accepted: false,
      reason: 'The paired avenue footprint extends outside the city map.',
      reasonCode: 'paired-lane-outside-map',
    });
    expect(previewAvenue(route, 48, 48, 'right')).toMatchObject({
      accepted: true,
      cells: expect.arrayContaining([
        { x: 0, y: 0, laneRole: 'drawn', travelMask: 2, pairMask: 4 },
        { x: 1, y: 0, laneRole: 'drawn', travelMask: 0, pairMask: 4 },
        { x: 0, y: 1, laneRole: 'paired', travelMask: 0, pairMask: 1 },
        { x: 1, y: 1, laneRole: 'paired', travelMask: 8, pairMask: 1 },
      ]),
    });
  });

  it('matches the canonical engine footprint and masks for straight and turned 2 by 2-or-larger previews', () => {
    const size = 48;
    const cases = [
      { route: [{ x: 10, y: 10 }, { x: 11, y: 10 }], side: 'left' },
      { route: [{ x: 11, y: 10 }, { x: 10, y: 10 }], side: 'right' },
      { route: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 12, y: 10 }], side: 'left' },
      { route: [{ x: 12, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 10 }], side: 'right' },
      { route: [{ x: 8, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }], side: 'left' },
      { route: [{ x: 8, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 11 }, { x: 10, y: 12 }], side: 'right' },
      { route: [{ x: 8, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 9 }, { x: 10, y: 8 }], side: 'left' },
      { route: [{ x: 8, y: 10 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 9 }, { x: 10, y: 8 }], side: 'right' },
    ] as const;
    for (const { route, side } of cases) {
      const preview = previewAvenue(route, size, size, side);
      const path = route.map(({ x, y }) => y * size + x);
      const canonical = deriveAvenueRibbon(size, path, side);
      expect(canonical.ok).toBe(true);
      expect(preview.accepted).toBe(true);
      if (!canonical.ok) continue;
      const previewByTile = new Map<number, AvenuePreviewCell>(preview.cells.map((cell) => [cell.y * size + cell.x, cell]));
      expect([...previewByTile.keys()].sort((left, right) => left - right)).toEqual(canonical.footprint);
      for (const lane of canonical.lanes) {
        expect(previewByTile.get(lane.tileId)).toMatchObject({
          laneRole: canonical.primaryTileIds.includes(lane.tileId) ? 'drawn' : 'paired',
          travelMask: lane.travelMask,
          pairMask: lane.pairMask,
        });
      }
    }
  });
});
