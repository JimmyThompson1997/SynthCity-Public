import { describe, expect, it } from 'vitest';
import {
  deriveRoadWarningAreas,
  deriveFacilityUtilityWarningAreas,
  deriveServiceWarningAreas,
  deriveTrainStationUtilityWarningAreas,
  type ServiceWarningAreaInput,
} from '../../src/market-city-dashboard/warning-areas';

const tile = (width: number, x: number, y: number): number => y * width + x;

interface MutableWarningAreaInput extends ServiceWarningAreaInput {
  zones: unknown[];
  roadAccess: boolean[];
  powered: boolean[];
  watered: boolean[];
}

function warningInput(width: number, height: number): MutableWarningAreaInput {
  const count = width * height;
  return {
    width,
    zones: Array<unknown>(count).fill(null),
    roadAccess: Array<boolean>(count).fill(true),
    powered: Array<boolean>(count).fill(true),
    watered: Array<boolean>(count).fill(true),
  };
}

describe('contiguous service warning areas', () => {
  it('shows only the requested thermal and water-facility operational markers', () => {
    expect(deriveFacilityUtilityWarningAreas({
      thermalPlants: [{ id: 'coal', tiles: [20, 21, 26, 27], roadAccess: false, waterAccess: false }],
      waterFacilities: [{ id: 'tower', tiles: [50, 51, 56, 57], roadAccess: false, powerAccess: false }],
    })).toEqual([
      { id: 'road:facility:coal', kind: 'road', tileIds: [20, 21, 26, 27], memberCount: 4, anchorTileId: 20 },
      { id: 'water:facility:coal', kind: 'water', tileIds: [20, 21, 26, 27], memberCount: 4, anchorTileId: 20 },
      { id: 'power:facility:tower', kind: 'power', tileIds: [50, 51, 56, 57], memberCount: 4, anchorTileId: 50 },
      { id: 'road:facility:tower', kind: 'road', tileIds: [50, 51, 56, 57], memberCount: 4, anchorTileId: 50 },
    ]);
  });

  it('shows Train Station utility markers from the atomic allocation result', () => {
    const station = { id: 'station-a', tiles: [18, 19, 24, 25], powerAccess: false, waterAccess: true };
    expect(deriveTrainStationUtilityWarningAreas({ facilities: [station] })).toEqual([
      {
        id: 'power:facility:station-a',
        kind: 'power',
        tileIds: [18, 19, 24, 25],
        memberCount: 4,
        anchorTileId: 18,
      },
    ]);
    expect(deriveTrainStationUtilityWarningAreas({
      facilities: [{ ...station, powerAccess: false, waterAccess: false }],
    }).map((area) => area.id)).toEqual([
      'power:facility:station-a',
      'water:facility:station-a',
    ]);
  });

  it('groups a 3 by 4 failed zone into one power and one water area', () => {
    const input = warningInput(6, 6);
    for (let y = 1; y <= 4; y += 1) for (let x = 1; x <= 3; x += 1) {
      const id = tile(input.width, x, y);
      input.zones[id] = 'R';
      input.powered[id] = false;
      input.watered[id] = false;
    }

    expect(deriveServiceWarningAreas(input)).toEqual([
      {
        id: 'power:7.8.9.13.14.15.19.20.21.25.26.27',
        kind: 'power',
        tileIds: [7, 8, 9, 13, 14, 15, 19, 20, 21, 25, 26, 27],
        memberCount: 12,
        anchorTileId: 14,
      },
      {
        id: 'water:7.8.9.13.14.15.19.20.21.25.26.27',
        kind: 'water',
        tileIds: [7, 8, 9, 13, 14, 15, 19, 20, 21, 25, 26, 27],
        memberCount: 12,
        anchorTileId: 14,
      },
    ]);
  });

  it('uses an unzoned road gap to split every failed service area', () => {
    const input = warningInput(7, 3);
    for (const x of [1, 2, 4, 5]) {
      const id = tile(input.width, x, 1);
      input.zones[id] = 'R';
      input.powered[id] = false;
      input.watered[id] = false;
    }

    expect(deriveServiceWarningAreas(input).map((area) => [area.kind, area.tileIds, area.anchorTileId])).toEqual([
      ['power', [8, 9], 8],
      ['power', [11, 12], 11],
      ['water', [8, 9], 8],
      ['water', [11, 12], 11],
    ]);
  });

  it('never joins diagonally touching failed tiles', () => {
    const input = warningInput(4, 4);
    for (const [x, y] of [[1, 1], [2, 2]] as const) {
      const id = tile(input.width, x, y);
      input.zones[id] = 'R';
      input.powered[id] = false;
    }

    expect(deriveServiceWarningAreas(input).map((area) => [area.kind, area.tileIds])).toEqual([
      ['power', [5]],
      ['power', [10]],
    ]);
  });

  it('joins adjacent residential, commercial, and industrial zoning for one failed service', () => {
    const input = warningInput(5, 3);
    for (const [x, zone] of [[1, 'R'], [2, 'C'], [3, 'I']] as const) {
      const id = tile(input.width, x, 1);
      input.zones[id] = zone;
      input.powered[id] = false;
    }

    expect(deriveServiceWarningAreas(input)).toEqual([
      {
        id: 'power:6.7.8',
        kind: 'power',
        tileIds: [6, 7, 8],
        memberCount: 3,
        anchorTileId: 7,
      },
    ]);
  });

  it('recognises the renderer RCI zoning objects it receives at the SVG boundary', () => {
    const input = warningInput(5, 3);
    input.zones[tile(input.width, 1, 1)] = { kind: 'residential' };
    input.zones[tile(input.width, 2, 1)] = { kind: 'commercial' };
    input.zones[tile(input.width, 3, 1)] = { kind: 'industrial' };
    for (const x of [1, 2, 3]) input.powered[tile(input.width, x, 1)] = false;

    expect(deriveServiceWarningAreas(input)).toEqual([
      {
        id: 'power:6.7.8',
        kind: 'power',
        tileIds: [6, 7, 8],
        memberCount: 3,
        anchorTileId: 7,
      },
    ]);
  });

  it('splits only the service repaired through the middle of a failed area', () => {
    const input = warningInput(5, 3);
    for (const x of [1, 2, 3]) {
      const id = tile(input.width, x, 1);
      input.zones[id] = 'R';
      input.powered[id] = false;
      input.watered[id] = x === 2;
    }

    expect(deriveServiceWarningAreas(input).map((area) => [area.kind, area.tileIds])).toEqual([
      ['power', [6, 7, 8]],
      ['water', [6]],
      ['water', [8]],
    ]);
  });

  it('keeps road warnings tile-granular while road access never splits power or water areas', () => {
    const input = warningInput(5, 4);
    const front = tile(input.width, 2, 1);
    const backTiles = [tile(input.width, 2, 2), tile(input.width, 1, 2), tile(input.width, 3, 2)];
    for (const id of [front, ...backTiles]) {
      input.zones[id] = 'R';
      input.powered[id] = false;
      input.watered[id] = false;
    }
    for (const id of backTiles) input.roadAccess[id] = false;

    expect(deriveRoadWarningAreas(input)).toEqual(backTiles.sort((left, right) => left - right).map((tileId) => ({
      id: `road:${tileId}`,
      kind: 'road',
      tileIds: [tileId],
      memberCount: 1,
      anchorTileId: tileId,
    })));
    expect(deriveServiceWarningAreas(input)).toEqual([
      {
        id: 'power:7.11.12.13',
        kind: 'power',
        tileIds: [7, 11, 12, 13],
        memberCount: 4,
        anchorTileId: 12,
      },
      {
        id: 'water:7.11.12.13',
        kind: 'water',
        tileIds: [7, 11, 12, 13],
        memberCount: 4,
        anchorTileId: 12,
      },
    ]);
  });

  it('returns stable component ordering, ids, and centre anchors', () => {
    const input = warningInput(6, 5);
    for (const [x, y] of [[1, 1], [2, 1], [1, 2], [4, 3], [5, 3]] as const) {
      const id = tile(input.width, x, y);
      input.zones[id] = 'R';
      input.roadAccess[id] = false;
      input.powered[id] = false;
    }

    const first = deriveServiceWarningAreas(input);
    const second = deriveServiceWarningAreas({
      width: input.width,
      zones: [...input.zones],
      roadAccess: [...input.roadAccess],
      powered: [...input.powered],
      watered: [...input.watered],
    });
    expect(second).toEqual(first);
    expect(deriveRoadWarningAreas(input).map((area) => [area.kind, area.id, area.anchorTileId])).toEqual([
      ['road', 'road:7', 7],
      ['road', 'road:8', 8],
      ['road', 'road:13', 13],
      ['road', 'road:22', 22],
      ['road', 'road:23', 23],
    ]);
    expect(first.map((area) => [area.kind, area.id, area.anchorTileId])).toEqual([
      ['power', 'power:7.8.13', 7],
      ['power', 'power:22.23', 22],
    ]);
  });
});
