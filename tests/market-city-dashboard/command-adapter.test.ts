import { describe, expect, it } from 'vitest';
import { createMarketCityState } from '../../src/market-city/state';
import { translateDashboardCommand } from '../../src/market-city-dashboard/command-adapter';

const tile = (x: number, y: number): number => y * 48 + x;
const state = () => createMarketCityState();

describe('market dashboard command adapter', () => {
  it('removes legacy density levels and translates RCI rectangles', () => {
    expect(translateDashboardCommand(state(), {
      type: 'zone', kind: 'commercial', level: 5, cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }],
    })).toEqual({
      ok: true,
      sourceType: 'zone',
      command: { type: 'zone', zone: 'C', tileIds: [tile(2, 3), tile(3, 3)] },
    });
  });

  it('translates the Waste landfill brush into its canonical service-zone command', () => {
    expect(translateDashboardCommand(state(), {
      type: 'zone-landfill',
      cells: [{ x: 2, y: 3 }, { x: 3, y: 3 }],
    })).toEqual({
      ok: true,
      sourceType: 'zone-landfill',
      command: { type: 'zone-landfill', tileIds: [tile(2, 3), tile(3, 3)] },
    });
  });

  it('translates active road, rail, line, plant, station and fire commands', () => {
    expect(translateDashboardCommand(state(), {
      type: 'place-network',
      network: 'road',
      route: [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }],
      cells: [{ x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 5 }],
    })).toMatchObject({
      ok: true,
      command: { type: 'place-road', path: [tile(5, 5), tile(4, 5), tile(4, 6)] },
    });
    expect(translateDashboardCommand(state(), {
      type: 'place-network', network: 'power-line', cells: [{ x: 4, y: 5 }],
    })).toMatchObject({ ok: true, command: { type: 'place-power-line', tileIds: [tile(4, 5)] } });
    expect(translateDashboardCommand(state(), {
      type: 'place-facility', facility: 'fire-station', anchor: { x: 6, y: 7 },
    })).toMatchObject({ ok: true, command: { type: 'place-facility', kind: 'fire-station', anchor: tile(6, 7) } });
    expect(translateDashboardCommand(state(), {
      type: 'place-network',
      network: 'rail',
      route: [{ x: 3, y: 2 }, { x: 2, y: 2 }, { x: 2, y: 3 }],
      cells: [{ x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 2 }],
    })).toMatchObject({
      ok: true,
      command: { type: 'place-rail', path: [tile(3, 2), tile(2, 2), tile(2, 3)] },
    });
    expect(translateDashboardCommand(state(), {
      type: 'place-facility', facility: 'train-station', anchor: { x: 9, y: 10 },
    })).toMatchObject({
      ok: true,
      command: { type: 'place-facility', kind: 'train-station', anchor: tile(9, 10) },
    });
    expect(translateDashboardCommand(state(), {
      type: 'place-facility', facility: 'police-station', anchor: { x: 1, y: 1 },
    })).toMatchObject({
      ok: true,
      command: { type: 'place-facility', kind: 'police-station', anchor: tile(1, 1) },
    });
    expect(translateDashboardCommand(state(), {
      type: 'place-facility', facility: 'health-clinic', anchor: { x: 1, y: 1 },
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/inactive/i) });
  });

  it('translates active underground Water pipes, facilities, and layer-aware demolition', () => {
    expect(translateDashboardCommand(state(), {
      type: 'place-network', network: 'water-pipe', cells: [{ x: 8, y: 9 }, { x: 7, y: 9 }],
    })).toEqual({
      ok: true,
      sourceType: 'place-network',
      command: { type: 'place-water-pipe', tileIds: [tile(7, 9), tile(8, 9)] },
    });
    for (const facility of ['water-tower', 'coastal-water-pump', 'water-treatment-plant']) {
      expect(translateDashboardCommand(state(), {
        type: 'place-facility', facility, anchor: { x: 9, y: 10 },
      })).toMatchObject({
        ok: true,
        command: { type: 'place-facility', kind: facility, anchor: tile(9, 10) },
      });
    }
    expect(translateDashboardCommand(state(), {
      type: 'demolish', layer: 'underground', cells: [{ x: 11, y: 12 }],
    })).toMatchObject({
      ok: true,
      command: { type: 'demolish', layer: 'underground', tileIds: [tile(11, 12)] },
    });
    expect(translateDashboardCommand(state(), {
      type: 'demolish', layer: 'surface', cells: [{ x: 11, y: 12 }],
    })).toMatchObject({
      ok: true,
      command: { type: 'demolish', layer: 'surface', tileIds: [tile(11, 12)] },
    });
  });

  it('preserves the player-drawn avenue route and explicit expansion side', () => {
    expect(translateDashboardCommand(state(), {
      type: 'place-network',
      network: 'avenue',
      expansionSide: 'left',
      route: [{ x: 8, y: 6 }, { x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }],
      cells: [{ x: 7, y: 6 }, { x: 7, y: 7 }, { x: 7, y: 8 }, { x: 8, y: 6 }],
    })).toEqual({
      ok: true,
      sourceType: 'place-network',
      command: {
        type: 'place-avenue',
        path: [tile(8, 6), tile(7, 6), tile(7, 7), tile(7, 8)],
        expansionSide: 'left',
      },
    });

    expect(translateDashboardCommand(state(), {
      type: 'place-network',
      network: 'avenue',
      expansionSide: 'inside',
      route: [{ x: 8, y: 6 }],
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/left or right/i) });
  });

  it('preserves material during surface paint and maps the four visual materials', () => {
    expect(translateDashboardCommand(state(), {
      type: 'paint-terrain-surface', surface: 'water', cells: [{ x: 8, y: 9 }],
    })).toMatchObject({ ok: true, command: { type: 'paint-terrain', tileIds: [tile(8, 9)], water: true } });
    expect(translateDashboardCommand(state(), {
      type: 'paint-terrain-material', material: 'snow', cells: [{ x: 8, y: 9 }],
    })).toMatchObject({ ok: true, command: { type: 'paint-terrain', tileIds: [tile(8, 9)], material: 'rock' } });
  });

  it('translates trees and elevation without leaking the renderer baseline', () => {
    expect(translateDashboardCommand(state(), {
      type: 'adjust-tree-cover', delta: 1, cells: [{ x: 10, y: 11 }],
    })).toMatchObject({ ok: true, command: { type: 'adjust-trees', tileIds: [tile(10, 11)], delta: 1 } });
    expect(translateDashboardCommand(state(), {
      type: 'sculpt-terrain', direction: -1, selections: [{ cell: { x: 12, y: 13 }, target: 'center' }],
    })).toMatchObject({ ok: true, command: { type: 'adjust-elevation', tileIds: [tile(12, 13)], delta: -1 } });
    expect(translateDashboardCommand(state(), {
      type: 'level-terrain', height: 4, cells: [{ x: 14, y: 15 }],
    })).toMatchObject({ ok: true, command: { type: 'set-elevation', tileIds: [tile(14, 15)], elevation: 2 } });
    expect(translateDashboardCommand(state(), { type: 'reset-terrain-elevation' }))
      .toMatchObject({ ok: true, command: { type: 'reset-elevation' } });
  });

  it('rejects malformed coordinates and retired financial commands', () => {
    expect(translateDashboardCommand(state(), {
      type: 'zone', kind: 'residential', cells: [{ x: 48, y: 0 }],
    })).toMatchObject({ ok: false, reason: expect.stringMatching(/outside/i) });
    expect(translateDashboardCommand(state(), { type: 'set-tax-rate', value: 20 }))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/unsupported/i) });
  });
});
