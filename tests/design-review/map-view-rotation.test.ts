import { describe, expect, it } from 'vitest';
// The review fixture deliberately serves this side-effect-free browser module
// from public/; Vitest executes the same ESM file the page imports.
// @ts-expect-error Static public review modules are not part of the TS program.
import * as mapViewRotation from '../../public/design-review/map-view-rotation.js';
const {
  CAMERA_HEADINGS,
  elevationOffsetForRotation,
  projectLocalVector,
  projectWorldPoint,
  projectionForRotation,
  rotateCell,
  rotateVertex,
  viewToWorldCell,
  viewToWorldVertex
} = mapViewRotation;

describe('quarter-turn review-map transforms', () => {
  it('rotates and restores canonical cells on the 60 by 60 map', () => {
    expect(rotateCell({ x: 0, y: 0 }, 0)).toEqual({ x: 0, y: 0 });
    expect(rotateCell({ x: 0, y: 0 }, 1)).toEqual({ x: 59, y: 0 });
    expect(rotateCell({ x: 0, y: 0 }, 2)).toEqual({ x: 59, y: 59 });
    expect(rotateCell({ x: 0, y: 0 }, 3)).toEqual({ x: 0, y: 59 });

    for (const rotation of [0, 1, 2, 3]) {
      const cell = { x: 17, y: 42 };
      expect(viewToWorldCell(rotateCell(cell, rotation), rotation)).toEqual(cell);
    }
  });

  it('uses the separate 61 by 61 shared-vertex bounds', () => {
    expect(rotateVertex({ x: 0, y: 0 }, 1)).toEqual({ x: 60, y: 0 });
    expect(rotateVertex({ x: 60, y: 0 }, 1)).toEqual({ x: 60, y: 60 });
    expect(rotateVertex({ x: 60, y: 60 }, 1)).toEqual({ x: 0, y: 60 });

    for (const rotation of [0, 1, 2, 3]) {
      const vertex = { x: 17, y: 42 };
      expect(viewToWorldVertex(rotateVertex(vertex, rotation), rotation)).toEqual(vertex);
    }
  });

  it('provides four orthogonal screen projections and camera headings', () => {
    expect(CAMERA_HEADINGS).toEqual(['south', 'west', 'north', 'east']);
    expect(projectionForRotation(0)).toEqual({ a: 1, b: .5, c: -1, d: .5 });
    expect(projectionForRotation(1)).toEqual({ a: -1, b: .5, c: -1, d: -.5 });
    expect(projectionForRotation(2)).toEqual({ a: -1, b: -.5, c: 1, d: -.5 });
    expect(projectionForRotation(3)).toEqual({ a: 1, b: -.5, c: 1, d: .5 });
  });

  it('keeps elevation vertical on screen at every quarter-turn', () => {
    for (const rotation of [0, 1, 2, 3]) {
      expect(projectLocalVector(elevationOffsetForRotation(rotation, 12), rotation)).toEqual({ x: 0, y: -12 });
    }
  });

  it('projects canonical terrain heights straight upward without rotating gravity', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const ground = projectWorldPoint({ x: 17, y: 42, height: 0 }, rotation);
      const raised = projectWorldPoint({ x: 17, y: 42, height: 1 }, rotation);
      expect(raised).toEqual({ x: ground.x, y: ground.y - 1 });
    }
  });
});
