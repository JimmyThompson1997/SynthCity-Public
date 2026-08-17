import { describe, expect, it } from 'vitest';

import {
  MarketCityController,
  MarketCityNotFoundError,
  DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
  type MarketCityControllerEngine,
} from '../../src/market-city-dashboard/controller';
import { MemoryMarketCityPersistence } from '../../src/market-city-dashboard/persistence';
import {
  MARKET_CITY_SCHEMA_VERSION,
  createMarketCityState,
  type MarketCityCommandResult,
  type MarketCityStateV2,
  type MarketCityWorldCommand,
} from '../../src/market-city';

function state(cityId = 'controller-city'): MarketCityStateV2 {
  const result = createMarketCityState({
      cityId,
      cityName: 'Controller City',
      mayorName: 'Mayor Controller',
      seed: 91,
      createdAt: '2026-08-11T12:00:00.000Z',
  });
  result.clock.paused = false;
  return result;
}

function clone(value: MarketCityStateV2): MarketCityStateV2 {
  return structuredClone(value);
}

const engine: MarketCityControllerEngine<{ cityId: string }> = {
  createMarketCityState(options) {
    return state(options.cityId);
  },
  restoreMarketCityState(value) {
    const candidate = value as MarketCityStateV2;
    if (candidate.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) throw new Error('invalid state');
    return clone(candidate);
  },
  applyWorldCommand(current, command): MarketCityCommandResult {
    if (command.type === 'zone' && command.tileIds.includes(-1)) {
      return { ok: false, state: current, changedTileIds: [], reason: 'invalid tile' };
    }
    const next = clone(current);
    const changedTileIds: number[] = [];
    if (command.type === 'zone') {
      for (const tileId of command.tileIds) {
        if (next.map.zones[tileId] === command.zone) continue;
        next.map.zones[tileId] = command.zone;
        changedTileIds.push(tileId);
      }
    }
    return { ok: true, state: next, changedTileIds };
  },
  stepMonth(current) {
    const next = clone(current);
    next.clock.month += 1;
    next.economy.treasury -= 100;
    return next;
  },
  hashDeterministicState(current) {
    return JSON.stringify(current);
  },
};

describe('MarketCityController', () => {
  it('ships a production adapter for the real fresh market engine', () => {
    const controller = MarketCityController.create(
      { identity: { cityId: 'real-engine', createdAt: '2026-08-11T12:00:00.000Z' } },
      { persistence: new MemoryMarketCityPersistence(), engine: DEFAULT_MARKET_CITY_CONTROLLER_ENGINE },
    );

    expect(controller.snapshot().identity.cityId).toBe('real-engine');
    expect(controller.dispatch({ type: 'zone', tileIds: [1], zone: 'R' }).ok).toBe(true);
    expect(controller.snapshot().economy.treasury).toBe(5_000);
    controller.step();
    expect(controller.snapshot().clock.month).toBe(1);
  });

  it('creates a fresh city and dispatches free world commands with atomic exact undo', () => {
    const persistence = new MemoryMarketCityPersistence();
    const controller = MarketCityController.create({ cityId: 'new-city' }, { persistence, engine });
    const openingHash = controller.hash();

    const result = controller.dispatch({ type: 'zone', tileIds: [1, 2, 3], zone: 'R' });
    expect(result.ok).toBe(true);
    expect(controller.snapshot().map.zones.slice(1, 4)).toEqual(['R', 'R', 'R']);
    expect(controller.snapshot().economy.treasury).toBe(5_000);
    expect(controller.canUndo).toBe(true);

    expect(controller.undo()).toBe(true);
    expect(controller.hash()).toBe(openingHash);
    expect(controller.canUndo).toBe(false);
  });

  it('does not add rejected or no-op commands to the undo stack', () => {
    const controller = MarketCityController.create(
      { cityId: 'rejections' },
      { persistence: new MemoryMarketCityPersistence(), engine },
    );

    expect(controller.dispatch({ type: 'zone', tileIds: [-1], zone: 'R' }).ok).toBe(false);
    expect(controller.dispatch({ type: 'zone', tileIds: [], zone: 'R' }).ok).toBe(true);
    expect(controller.canUndo).toBe(false);
  });

  it('enforces the free-placement contract even against a charging engine adapter', () => {
    const chargingEngine: MarketCityControllerEngine<{ cityId: string }> = {
      ...engine,
      applyWorldCommand(current, command) {
        const result = engine.applyWorldCommand(current, command);
        if (result.ok) result.state.economy.treasury -= 1;
        return result;
      },
    };
    const controller = MarketCityController.create(
      { cityId: 'free-world-commands' },
      { persistence: new MemoryMarketCityPersistence(), engine: chargingEngine },
    );
    const openingHash = controller.hash();

    expect(() => controller.dispatch({ type: 'zone', tileIds: [2], zone: 'R' })).toThrow(
      /world commands must be free/i,
    );
    expect(controller.hash()).toBe(openingHash);
    expect(controller.canUndo).toBe(false);
  });

  it('steps deterministically and owns pause, speed, and fire difficulty controls', () => {
    const controller = MarketCityController.create(
      { cityId: 'clock' },
      { persistence: new MemoryMarketCityPersistence(), engine },
    );

    controller.setPaused(true);
    controller.setSpeed(3);
    controller.setFireDifficulty('hard');
    expect(controller.snapshot().clock).toEqual({ month: 0, paused: true, speed: 3, fireDifficulty: 'hard' });

    controller.step();
    controller.stepMonths(2);
    expect(controller.snapshot().clock.month).toBe(3);
    expect(controller.snapshot().economy.treasury).toBe(4_700);
    expect(() => controller.stepMonths(-1)).toThrow(/non-negative safe integer/i);
  });

  it('validates, durably saves, and reloads the city vertical development level', async () => {
    const persistence = new MemoryMarketCityPersistence();
    const controller = MarketCityController.create(
      { identity: { cityId: 'vertical-level', createdAt: '2026-08-13T00:00:00.000Z' } },
      { persistence, engine: DEFAULT_MARKET_CITY_CONTROLLER_ENGINE },
    );
    const openingHash = controller.hash();

    controller.setVerticalDevelopmentLevel(2);
    expect(controller.snapshot().market.verticalDevelopmentLevel).toBe(2);
    expect(controller.hash()).not.toBe(openingHash);
    expect(() => controller.setVerticalDevelopmentLevel(1.5)).toThrow(/integer/i);
    expect(() => controller.setVerticalDevelopmentLevel(11)).toThrow(/1.*10/i);
    expect(controller.snapshot().market.verticalDevelopmentLevel).toBe(2);

    const savedHash = controller.hash();
    await controller.save();
    controller.setVerticalDevelopmentLevel(10);
    await controller.reload();
    expect(controller.snapshot().market.verticalDevelopmentLevel).toBe(2);
    expect(controller.hash()).toBe(savedHash);
  });

  it('saves and reloads the exact deterministic state hash with no derived cache payload', async () => {
    const persistence = new MemoryMarketCityPersistence();
    const controller = MarketCityController.create({ cityId: 'reload' }, { persistence, engine });
    controller.dispatch({ type: 'zone', tileIds: [10], zone: 'C' });
    controller.stepMonths(2);
    const savedHash = controller.hash();

    await controller.save();
    controller.dispatch({ type: 'zone', tileIds: [11], zone: 'I' });
    expect(controller.hash()).not.toBe(savedHash);

    await controller.reload();
    expect(controller.hash()).toBe(savedHash);
    expect(controller.canUndo).toBe(false);
    expect('desirabilityCache' in controller.snapshot()).toBe(false);
  });

  it('loads a city through strict restore and reports a missing city', async () => {
    const persistence = new MemoryMarketCityPersistence();
    await persistence.save(state('stored'));

    const loaded = await MarketCityController.load('stored', { persistence, engine });
    expect(loaded.snapshot().identity.cityId).toBe('stored');
    await expect(MarketCityController.load('missing', { persistence, engine })).rejects.toBeInstanceOf(
      MarketCityNotFoundError,
    );
  });

  it('returns defensive snapshots and supports multiple exact command undos', () => {
    const controller = MarketCityController.create(
      { cityId: 'snapshot' },
      { persistence: new MemoryMarketCityPersistence(), engine },
    );
    const commands: MarketCityWorldCommand[] = [
      { type: 'zone', tileIds: [20], zone: 'R' },
      { type: 'zone', tileIds: [21], zone: 'C' },
    ];
    commands.forEach((command) => controller.dispatch(command));
    const snapshot = controller.snapshot();
    snapshot.map.zones[20] = 'I';
    expect(controller.snapshot().map.zones[20]).toBe('R');

    expect(controller.undo()).toBe(true);
    expect(controller.snapshot().map.zones[21]).toBeNull();
    expect(controller.snapshot().map.zones[20]).toBe('R');
    expect(controller.undo()).toBe(true);
    expect(controller.snapshot().map.zones[20]).toBeNull();
  });
});
