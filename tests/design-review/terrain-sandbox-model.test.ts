import { describe, expect, it } from 'vitest';
// The review fixture deliberately serves this side-effect-free browser module
// from public/; Vitest executes the same ESM file the page imports.
// @ts-expect-error Static public review modules are not part of the TS program.
import * as terrainModel from '../../public/design-review/terrain-sandbox-model.js';
const {
  DEFAULT_HEIGHT,
  TERRAIN_CELLS,
  TERRAIN_VERTICES,
  classifyTile,
  createLandscapeState,
  heightAt,
  landscapeSnapshot,
  proposeTerrainDelta,
  proposeTerrainSculpt,
  proposeTerrainLevel,
  resetLandscapeState,
  tileHeights,
  validateLandscapeState,
  validateRoadGrade
} = terrainModel;

describe('design-review shared-corner landscape model', () => {
  it('starts and resets as a 61 by 61 shared-vertex field at elevation 2', () => {
    let state = createLandscapeState();
    expect(state.cells).toBe(TERRAIN_CELLS);
    expect(state.heights).toHaveLength(TERRAIN_VERTICES ** 2);
    expect(new Set(state.heights)).toEqual(new Set([DEFAULT_HEIGHT]));

    state = proposeTerrainDelta(state, [{ x: 20, y: 20 }], 1).state!;
    expect(heightAt(state, 20, 20)).toBe(3);
    expect(new Set(resetLandscapeState(state).heights)).toEqual(new Set([DEFAULT_HEIGHT]));
  });

  it('uses shared vertices and accepts flat, planar ramp, and corner shoulder cells', () => {
    let state = createLandscapeState();
    const raised = proposeTerrainDelta(state, [{ x: 20, y: 20 }], 1);
    expect(raised.accepted).toBe(true);
    state = raised.state!;
    expect(heightAt(state, 21, 20)).toBe(3);
    expect(classifyTile(state, { x: 20, y: 20 }).kind).toBe('flat');
    expect(classifyTile(state, { x: 19, y: 20 })).toMatchObject({ kind: 'ramp-x', axis: 'x' });
    expect(classifyTile(state, { x: 19, y: 19 }).kind).toBe('shoulder');
    expect(validateLandscapeState(state)).toEqual({ accepted: true });
  });

  it('rejects a two-step shared edge atomically', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 24, y: 24 }], 1).state!;
    const before = landscapeSnapshot(state);
    const rejected = proposeTerrainDelta(state, [{ x: 24, y: 24 }], 1);
    expect(rejected).toMatchObject({ accepted: false, reason: 'Terrain step is too steep.' });
    expect(landscapeSnapshot(state)).toEqual(before);

    const capped = createLandscapeState({ baseline: 4 });
    const cappedBefore = landscapeSnapshot(capped);
    expect(proposeTerrainSculpt(capped, [{ cell: { x: 12, y: 12 }, target: 'center' }], 1)).toMatchObject({
      accepted: false,
      reason: 'Landscape height must remain between 0 and 4.'
    });
    expect(landscapeSnapshot(capped)).toEqual(cappedBefore);
  });

  it('rejects a diagonally-opposed saddle atomically', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 20, y: 20 }], 1).state!;
    const before = landscapeSnapshot(state);
    const rejected = proposeTerrainDelta(state, [{ x: 22, y: 22 }], 1);
    expect(rejected).toMatchObject({ accepted: false, reason: 'Terrain saddle is not allowed.' });
    expect(landscapeSnapshot(state)).toEqual(before);
  });

  it('levels target cells to the selected flat elevation through shared vertices', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 30, y: 30 }], 1).state!;
    const source = classifyTile(state, { x: 30, y: 30 });
    expect(source).toMatchObject({ kind: 'flat', height: 3 });
    const leveled = proposeTerrainLevel(state, [{ x: 32, y: 30 }], source.height!);
    expect(leveled.accepted).toBe(true);
    expect(classifyTile(leveled.state!, { x: 32, y: 30 })).toMatchObject({ kind: 'flat', height: 3 });
  });

  it('terraces centre edits while allowing one-step edge and corner sculpting', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 20, y: 20 }], 1).state!;

    // The diagonally adjacent cell has exactly one high shared corner. A
    // centre Raise must fill the three lower corners to that height instead
    // of moving the already-high corner to elevation 4.
    expect(classifyTile(state, { x: 21, y: 21 }).kind).toBe('shoulder');
    const terraced = proposeTerrainSculpt(state, [{ cell: { x: 21, y: 21 }, target: 'center' }], 1);
    expect(terraced.accepted).toBe(true);
    expect(classifyTile(terraced.state!, { x: 21, y: 21 })).toMatchObject({ kind: 'flat', height: 3 });

    const loweredRamp = proposeTerrainSculpt(state, [{ cell: { x: 21, y: 20 }, target: 'center' }], -1);
    expect(loweredRamp.accepted).toBe(true);
    expect(classifyTile(loweredRamp.state!, { x: 21, y: 20 })).toMatchObject({ kind: 'flat', height: 2 });

    const edge = proposeTerrainSculpt(createLandscapeState(), [{ cell: { x: 30, y: 30 }, target: 'north' }], 1);
    expect(edge.accepted).toBe(true);
    expect(tileHeights(edge.state!, { x: 30, y: 30 })).toEqual({ nw: 3, ne: 3, se: 2, sw: 2 });

    const corner = proposeTerrainSculpt(createLandscapeState(), [{ cell: { x: 30, y: 30 }, target: 'se' }], 1);
    expect(corner.accepted).toBe(true);
    expect(tileHeights(corner.state!, { x: 30, y: 30 })).toEqual({ nw: 2, ne: 2, se: 3, sw: 2 });

    for (const target of ['nw', 'ne', 'se', 'sw']) {
      const shoulder = proposeTerrainSculpt(createLandscapeState(), [{ cell: { x: 34, y: 34 }, target }], 1);
      expect(classifyTile(shoulder.state!, { x: 34, y: 34 }).kind).toBe('shoulder');
      expect(classifyTile(proposeTerrainSculpt(shoulder.state!, [{ cell: { x: 34, y: 34 }, target: 'center' }], 1).state!, { x: 34, y: 34 })).toMatchObject({ kind: 'flat', height: 3 });
    }
    for (const target of ['north', 'east', 'south', 'west']) {
      const ramp = proposeTerrainSculpt(createLandscapeState(), [{ cell: { x: 38, y: 38 }, target }], 1);
      expect(classifyTile(ramp.state!, { x: 38, y: 38 }).kind).toMatch(/^ramp-/);
      expect(classifyTile(proposeTerrainSculpt(ramp.state!, [{ cell: { x: 38, y: 38 }, target: 'center' }], -1).state!, { x: 38, y: 38 })).toMatchObject({ kind: 'flat', height: 2 });
    }
  });

  it('merges paint selections from one snapshot and rejects invalid sculpt gestures atomically', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 20, y: 20 }], 1).state!;

    const merged = proposeTerrainSculpt(state, [
      ...[19, 20, 21].flatMap((y) => [19, 20, 21].map((x) => ({ cell: { x, y }, target: 'center' })))
    ], 1);
    expect(merged.accepted).toBe(true);
    // The shared edge requests 4 from the flat tile and 3 from the ramp; a
    // Raise gesture keeps the highest snapshot request rather than depending
    // on pointer traversal order.
    expect(tileHeights(merged.state!, { x: 21, y: 20 })).toEqual({ nw: 4, ne: 3, se: 3, sw: 4 });

    const before = landscapeSnapshot(state);
    const rejected = proposeTerrainSculpt(state, [
      { cell: { x: 20, y: 20 }, target: 'north' },
      { cell: { x: 22, y: 22 }, target: 'center' }
    ], 1);
    expect(rejected).toMatchObject({ accepted: false, reason: 'Terrain step is too steep.' });
    expect(landscapeSnapshot(state)).toEqual(before);
  });

  it('accepts uphill and downhill roads on a planar ramp while refusing cross-slope roads and turns', () => {
    let state = createLandscapeState();
    state = proposeTerrainDelta(state, [{ x: 30, y: 30 }], 1).state!;
    expect(validateRoadGrade(state, [{ x: 28, y: 30 }, { x: 29, y: 30 }, { x: 30, y: 30 }, { x: 31, y: 30 }, { x: 32, y: 30 }])).toMatchObject({ accepted: true });
    expect(validateRoadGrade(state, [{ x: 29, y: 30 }, { x: 29, y: 31 }])).toMatchObject({ accepted: false, reason: 'Road ramp must run uphill or downhill along the slope.' });
    expect(validateRoadGrade(state, [{ x: 28, y: 30 }, { x: 29, y: 30 }, { x: 29, y: 31 }])).toMatchObject({ accepted: false, reason: 'Road turns and junctions require flat terrain.' });
  });
});
