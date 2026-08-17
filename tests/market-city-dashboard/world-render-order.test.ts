import { describe, expect, it } from 'vitest';
import {
  nearestWorldRenderAnchor,
  orderWorldRenderItems,
  worldPainterDepth,
  type WorldRenderContext,
  type WorldRenderItem,
} from '../../src/market-city-dashboard/world-render-order';

const context = (rotation: number): WorldRenderContext => ({ mapCells: 48, rotation, baselineHeight: 0 });
const item = (id: string, x: number, y: number, elevation = 0, sublayer = 0): WorldRenderItem<string> => ({
  id,
  sublayer,
  anchor: { x, y, elevation },
  payload: id,
});

describe('market-city world painter ordering', () => {
  it('puts the camera-nearest ground anchor last at all four headings', () => {
    const pairs = [
      { rotation: 0, back: item('north', 20, 20), front: item('south', 20, 23) },
      { rotation: 1, back: item('west', 20, 20), front: item('east', 23, 20) },
      { rotation: 2, back: item('south', 20, 23), front: item('north', 20, 20) },
      { rotation: 3, back: item('east', 23, 20), front: item('west', 20, 20) },
    ];
    for (const pair of pairs) {
      const ordered = orderWorldRenderItems([pair.front, pair.back], context(pair.rotation));
      expect(ordered.map(({ id }) => id)).toEqual([pair.back.id, pair.front.id]);
      expect(worldPainterDepth(pair.front.anchor, context(pair.rotation)))
        .toBeGreaterThan(worldPainterDepth(pair.back.anchor, context(pair.rotation)));
    }
  });

  it('uses ground elevation and deterministic semantic tie-breakers', () => {
    const lowNear = item('low-near', 20, 22, 0);
    const highFar = item('high-far', 20, 20, 4);
    expect(orderWorldRenderItems([lowNear, highFar], context(0)).map(({ id }) => id))
      .toEqual(['high-far', 'low-near']);

    const ties = [item('zeta', 10, 10, 0, 4), item('alpha', 10, 10, 0, 4), item('ground', 10, 10, 0, 2)];
    expect(orderWorldRenderItems(ties, context(0)).map(({ id }) => id)).toEqual(['ground', 'alpha', 'zeta']);
    expect(orderWorldRenderItems([...ties].reverse(), context(0)).map(({ id }) => id)).toEqual(['ground', 'alpha', 'zeta']);
  });

  it('can split conductor spans around a facility by anchor depth', () => {
    const boiler = item('coal-boiler', 21, 21.5, 0, 60);
    const rearWire = item('wire-west', 20, 21.5, 0, 90);
    const frontWire = item('wire-east', 22, 21.5, 0, 90);
    expect(orderWorldRenderItems([frontWire, boiler, rearWire], context(0)).map(({ id }) => id))
      .toEqual(['wire-west', 'coal-boiler', 'wire-east']);
  });

  it('puts a rear status icon behind a foreground facility while retaining same-tile legibility', () => {
    const pairs = [
      { rotation: 0, rear: { x: 20, y: 20 }, front: { x: 20, y: 23 } },
      { rotation: 1, rear: { x: 20, y: 20 }, front: { x: 23, y: 20 } },
      { rotation: 2, rear: { x: 20, y: 23 }, front: { x: 20, y: 20 } },
      { rotation: 3, rear: { x: 23, y: 20 }, front: { x: 20, y: 20 } },
    ];
    for (const pair of pairs) {
      const renderContext = context(pair.rotation);
      const rearWarning = item('warning:rear', pair.rear.x, pair.rear.y, 0, 100);
      const frontFacility = item('facility:front', pair.front.x, pair.front.y, 0, 60);
      const ordered = orderWorldRenderItems([frontFacility, rearWarning], renderContext);
      expect(ordered.at(-1)?.id).toBe('facility:front');

      const sameTileFacility = item('facility:same', 12, 12, 0, 60);
      const sameTileWarning = item('warning:same', 12, 12, 0, 100);
      expect(orderWorldRenderItems([sameTileWarning, sameTileFacility], renderContext).map(({ id }) => id))
        .toEqual(['facility:same', 'warning:same']);
    }
  });

  it('keeps every rear zoning tile behind a foreground facility instead of borrowing a distant zone depth', () => {
    const pairs = [
      { rotation: 0, rear: { x: 20, y: 20 }, front: { x: 20, y: 23 } },
      { rotation: 1, rear: { x: 20, y: 20 }, front: { x: 23, y: 20 } },
      { rotation: 2, rear: { x: 20, y: 23 }, front: { x: 20, y: 20 } },
      { rotation: 3, rear: { x: 23, y: 20 }, front: { x: 20, y: 20 } },
    ];
    for (const pair of pairs) {
      const rearZone = item('zone:rear', pair.rear.x, pair.rear.y, 0, 10);
      const frontFacility = item('facility:front', pair.front.x, pair.front.y, 0, 60);
      expect(orderWorldRenderItems([frontFacility, rearZone], context(pair.rotation)).map(({ id }) => id))
        .toEqual(['zone:rear', 'facility:front']);
    }
  });

  it('anchors a merged footprint at its camera-nearest occupied cell', () => {
    const footprint = [
      { x: 10.5, y: 10.5, elevation: 0 },
      { x: 11.5, y: 10.5, elevation: 0 },
      { x: 10.5, y: 11.5, elevation: 0 },
    ];

    for (const rotation of [0, 1, 2, 3]) {
      const renderContext = context(rotation);
      const selected = nearestWorldRenderAnchor(footprint, renderContext);
      expect(worldPainterDepth(selected, renderContext)).toBe(
        Math.max(...footprint.map((anchor) => worldPainterDepth(anchor, renderContext))),
      );
    }
  });

  it('keeps a camera-near L lot in front of its adjacent one-cell neighbor', () => {
    const renderContext = context(2);
    const mergedCells = [
      { x: 38.5, y: 31.5, elevation: 0 },
      { x: 38.5, y: 32.5, elevation: 0 },
      { x: 39.5, y: 32.5, elevation: 0 },
    ];
    const merged = item('merged-L', 0, 0);
    merged.anchor = nearestWorldRenderAnchor(mergedCells, renderContext);
    const neighbor = item('neighbor', 39.5, 31.5);

    expect(orderWorldRenderItems([merged, neighbor], renderContext).map(({ id }) => id))
      .toEqual(['neighbor', 'merged-L']);
  });
});
