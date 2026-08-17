import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
  MarketCityController,
} from '../../src/market-city-dashboard/controller';
import { MemoryMarketCityPersistence } from '../../src/market-city-dashboard/persistence';

function controller() {
  return MarketCityController.create(
    {
      identity: {
        cityId: 'identity-city',
        cityName: 'Old City',
        mayorName: 'Old Mayor',
        seed: 4_242,
        createdAt: '2026-08-11T12:00:00.000Z',
      },
    },
    {
      persistence: new MemoryMarketCityPersistence(),
      engine: DEFAULT_MARKET_CITY_CONTROLLER_ENGINE,
    },
  );
}

describe('MarketCityController identity updates', () => {
  it('trims names, preserves immutable identity fields and city state, and clears undo', () => {
    const subject = controller();
    subject.dispatch({ type: 'zone', tileIds: [10], zone: 'R' });
    expect(subject.canUndo).toBe(true);
    const before = subject.snapshot();

    subject.updateIdentity({ cityName: '  New City  ', mayorName: '\n Mayor Ada \t' });

    const after = subject.snapshot();
    expect(after.identity).toEqual({
      cityId: before.identity.cityId,
      cityName: 'New City',
      mayorName: 'Mayor Ada',
      seed: before.identity.seed,
      createdAt: before.identity.createdAt,
    });
    expect(after.map.zones[10]).toBe('R');
    expect(after.clock).toEqual(before.clock);
    expect(after.economy).toEqual(before.economy);
    expect(subject.canUndo).toBe(false);
  });

  it('updates either name independently through strict restoration', () => {
    const subject = controller();

    subject.updateIdentity({ cityName: ' Solo City ' });
    expect(subject.snapshot().identity).toMatchObject({ cityName: 'Solo City', mayorName: 'Old Mayor' });

    subject.updateIdentity({ mayorName: ' Mayor Grace ' });
    expect(subject.snapshot().identity).toMatchObject({ cityName: 'Solo City', mayorName: 'Mayor Grace' });
    expect(subject.snapshot()).toEqual(DEFAULT_MARKET_CITY_CONTROLLER_ENGINE.restoreMarketCityState(subject.snapshot()));
  });

  it('rejects non-string or blank names atomically without clearing undo', () => {
    const subject = controller();
    subject.dispatch({ type: 'zone', tileIds: [20], zone: 'C' });
    const beforeHash = subject.hash();

    expect(() => subject.updateIdentity({ cityName: '   ' })).toThrow(/cityName.*non-empty/i);
    expect(() => subject.updateIdentity({ mayorName: '\n\t' })).toThrow(/mayorName.*non-empty/i);
    expect(() => subject.updateIdentity({ cityName: 42 as unknown as string })).toThrow(/cityName.*string/i);

    expect(subject.hash()).toBe(beforeHash);
    expect(subject.canUndo).toBe(true);
  });
});
