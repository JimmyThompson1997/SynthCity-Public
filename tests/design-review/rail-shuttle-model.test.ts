import { describe, expect, it } from 'vitest';
// @ts-expect-error Static public review modules are executed directly by the page.
import { railShuttlePose } from '../../public/design-review/rail-shuttle-model.js';

const options = { millisecondsPerTile: 100, terminalPauseMs: 50 };

describe('derived passenger shuttle pose', () => {
  it('travels the actual tile path and reverses after its terminal hold', () => {
    const path = [101, 102, 150];
    expect(railShuttlePose(path, 0, options)).toMatchObject({
      fromTileId: 101, toTileId: 102, pathIndex: 0, progress: 0,
      direction: 'forward', atTerminal: false,
    });
    expect(railShuttlePose(path, 150, options)).toMatchObject({
      fromTileId: 102, toTileId: 150, pathIndex: 1, progress: .5,
      direction: 'forward', atTerminal: false,
    });
    expect(railShuttlePose(path, 225, options)).toMatchObject({
      fromTileId: 150, toTileId: 150, pathIndex: 2, progress: 1,
      direction: 'forward', atTerminal: true,
    });
    expect(railShuttlePose(path, 275, options)).toMatchObject({
      fromTileId: 150, toTileId: 102, pathIndex: 2, progress: .25,
      direction: 'reverse', atTerminal: false,
    });
  });

  it('loops deterministically and rejects malformed paths/options', () => {
    const path = [4, 5, 6];
    expect(railShuttlePose(path, 500, options)).toEqual(railShuttlePose(path, 0, options));
    expect(() => railShuttlePose([4], 0, options)).toThrow(/two/i);
    expect(() => railShuttlePose([4, 4], 0, options)).toThrow(/adjacent|distinct/i);
    expect(() => railShuttlePose(path, Number.NaN, options)).toThrow(/elapsed/i);
    expect(() => railShuttlePose(path, 0, { ...options, millisecondsPerTile: 0 })).toThrow(/milliseconds/i);
  });
});
