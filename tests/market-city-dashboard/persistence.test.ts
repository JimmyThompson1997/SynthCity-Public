import { describe, expect, it } from 'vitest';

import {
  BrowserMarketCityPersistence,
  MARKET_CITY_DATABASE_NAME,
  MemoryMarketCityPersistence,
  MarketCityRestoreError,
} from '../../src/market-city-dashboard/persistence';
import {
  createMarketCityState,
  MARKET_CITY_RULES_VERSION,
  type MarketCityStateV2,
} from '../../src/market-city';

const TILE_COUNT = 48 * 48;

function state(cityId = 'city-a', cityName = 'City A'): MarketCityStateV2 {
  const result = createMarketCityState({
      cityId,
      cityName,
      mayorName: 'Mayor Test',
      seed: 17,
      createdAt: '2026-08-11T12:00:00.000Z',
  });
  result.clock.month = 3;
  result.clock.paused = false;
  return result;
}

/**
 * A snapshot that predates 2.10 has no crime record at all. The fixtures build
 * one from a CURRENT state and then downgrade its rulesVersion, so the key has
 * to come back off or the legacy validator correctly rejects it.
 */
function stripCrime<T>(snapshot: T): T {
  delete (snapshot as { crime?: unknown }).crime;
  return snapshot;
}


describe('fresh MarketCity persistence', () => {
  it('saves isolated state copies, lists summaries, loads, and deletes cities', async () => {
    let tick = 0;
    const persistence = new MemoryMarketCityPersistence({
      now: () => `2026-08-11T12:00:0${tick++}.000Z`,
    });
    const first = state();
    const second = state('city-b', 'City B');

    await persistence.save(first);
    await persistence.save(second);
    first.economy.treasury = -999;

    expect(await persistence.listCitySummaries()).toEqual([
      expect.objectContaining({ cityId: 'city-b', cityName: 'City B', savedAt: '2026-08-11T12:00:01.000Z' }),
      expect.objectContaining({ cityId: 'city-a', cityName: 'City A', savedAt: '2026-08-11T12:00:00.000Z' }),
    ]);

    const loaded = await persistence.load('city-a');
    expect(loaded?.economy.treasury).toBe(5_000);
    loaded!.economy.treasury = 123;
    expect((await persistence.load('city-a'))?.economy.treasury).toBe(5_000);

    await persistence.delete('city-a');
    expect(await persistence.load('city-a')).toBeNull();
  });

  it('stores one fresh mayor profile independently of city state', async () => {
    const persistence = new MemoryMarketCityPersistence({
      now: () => '2026-08-11T13:00:00.000Z',
    });

    expect(await persistence.loadMayorProfile()).toBeNull();
    const saved = await persistence.saveMayorProfile({ mayorName: 'Mayor Ada' });
    expect(saved).toEqual({
      schemaVersion: 1,
      mayorName: 'Mayor Ada',
      updatedAt: '2026-08-11T13:00:00.000Z',
    });
    saved.mayorName = 'mutated';
    expect(await persistence.loadMayorProfile()).toEqual({
      schemaVersion: 1,
      mayorName: 'Mayor Ada',
      updatedAt: '2026-08-11T13:00:00.000Z',
    });
  });

  it('strictly rejects malformed, legacy, and cache-bearing snapshots', async () => {
    const persistence = new MemoryMarketCityPersistence();
    const legacy = state() as unknown as Record<string, unknown>;
    legacy.schemaVersion = 5;
    await expect(persistence.save(legacy as unknown as MarketCityStateV2)).rejects.toBeInstanceOf(MarketCityRestoreError);

    const malformed = state();
    malformed.map.roads.pop();
    await expect(persistence.save(malformed)).rejects.toThrow(/roads.*2304/i);

    const cacheBearing = state() as MarketCityStateV2 & { desirabilityCache: number[] };
    cacheBearing.desirabilityCache = [];
    await expect(persistence.save(cacheBearing)).rejects.toThrow(/unexpected.*desirabilityCache/i);

    const migratableButNotCurrent = state() as unknown as Record<string, unknown>;
    migratableButNotCurrent.rulesVersion = 'claude-market-2.0.0';
    stripCrime(migratableButNotCurrent);
    migratableButNotCurrent.fire = {
      intensity: Array<number>(TILE_COUNT).fill(0),
      damage: Array<number>(TILE_COUNT).fill(0),
      age: Array<number>(TILE_COUNT).fill(0),
      char: Array<number>(TILE_COUNT).fill(0),
      collapsedTotal: 0,
    };
    await expect(persistence.save(migratableButNotCurrent as unknown as MarketCityStateV2)).rejects.toThrow(
      new RegExp(`rulesVersion.*${MARKET_CITY_RULES_VERSION.replaceAll('.', '\\.')}.*new saves`, 'i'),
    );
  });

  it('never deletes legacy databases, de-duplicates current over legacy, and migrates legacy records on read', async () => {
    const current = state('shared-city', 'Current Shared');
    current.economy.treasury = 111;
    const legacyOnly = state('legacy-only', 'Legacy Only') as unknown as Record<string, unknown>;
    legacyOnly.rulesVersion = 'claude-market-2.0.0';
    stripCrime(legacyOnly);
    legacyOnly.fire = {
      intensity: Array<number>(TILE_COUNT).fill(0),
      damage: Array<number>(TILE_COUNT).fill(0),
      age: Array<number>(TILE_COUNT).fill(0),
      char: Array<number>(TILE_COUNT).fill(0),
      collapsedTotal: 0,
    };
    const legacyShared = structuredClone(legacyOnly);
    (legacyShared.identity as Record<string, unknown>).cityId = 'shared-city';
    (legacyShared.identity as Record<string, unknown>).cityName = 'Legacy Shared';
    (legacyShared.economy as Record<string, unknown>).treasury = 999;

    const records = new Map<string, unknown[]>([
      ['synthcity-market-v2-fire/market-cities-v2-fire', [
        { cityId: 'shared-city', savedAt: '2026-08-12T10:00:00.000Z', state: current },
      ]],
      ['synthcity-market-v1/market-cities-v1', [
        { cityId: 'shared-city', savedAt: '2026-08-12T11:00:00.000Z', state: legacyShared },
        { cityId: 'legacy-only', savedAt: '2026-08-12T09:00:00.000Z', state: legacyOnly },
      ]],
      ['synthcity-market-v2/market-cities-v2', []],
    ]);
    const opened: Array<[string, number | undefined]> = [];
    const deleted: string[] = [];
    const writes: string[] = [];
    const indexedDB = {
      deleteDatabase(name: string) {
        deleted.push(name);
        throw new Error('deleteDatabase must never be called');
      },
      open(name: string, version?: number) {
        opened.push([name, version]);
        const database = {
          objectStoreNames: { contains: () => true },
          createObjectStore: () => { throw new Error('stores already exist'); },
          close() {},
          onversionchange: null,
          transaction(storeName: string) {
            const transaction = {
              error: null,
              oncomplete: null as (() => void) | null,
              onerror: null as (() => void) | null,
              onabort: null as (() => void) | null,
              objectStore() {
                const values = records.get(`${name}/${storeName}`) ?? [];
                const resultRequest = <T>(result: T): IDBRequest<T> => {
                  const request = {
                    result,
                    error: null,
                    onsuccess: null as (() => void) | null,
                    onerror: null as (() => void) | null,
                  };
                  queueMicrotask(() => {
                    request.onsuccess?.();
                    queueMicrotask(() => transaction.oncomplete?.());
                  });
                  return request as unknown as IDBRequest<T>;
                };
                return {
                  getAll: () => resultRequest(values),
                  get: (cityId: string) => resultRequest(
                    values.find((entry) => (entry as { cityId: string }).cityId === cityId),
                  ),
                  put: (entry: unknown) => {
                    writes.push(`${name}/${storeName}`);
                    return resultRequest(entry);
                  },
                } as unknown as IDBObjectStore;
              },
            };
            return transaction as unknown as IDBTransaction;
          },
        };
        const request = {
          result: database,
          error: null,
          transaction: null,
          onupgradeneeded: null as (() => void) | null,
          onsuccess: null as (() => void) | null,
          onerror: null as (() => void) | null,
          onblocked: null as (() => void) | null,
        };
        queueMicrotask(() => request.onsuccess?.());
        return request as unknown as IDBOpenDBRequest;
      },
    } as unknown as IDBFactory;
    const persistence = new BrowserMarketCityPersistence({ indexedDB });

    expect(await persistence.listCitySummaries()).toEqual([
      expect.objectContaining({ cityId: 'shared-city', cityName: 'Current Shared', treasury: 111 }),
      expect.objectContaining({ cityId: 'legacy-only', cityName: 'Legacy Only' }),
    ]);
    expect((await persistence.load('shared-city'))?.economy.treasury).toBe(111);
    expect(await persistence.load('legacy-only')).toMatchObject({
      schemaVersion: 2,
      rulesVersion: MARKET_CITY_RULES_VERSION,
      fire: { incidents: [], history: [] },
    });
    await persistence.save(state('new-current'));
    expect(deleted).toEqual([]);
    expect(MARKET_CITY_DATABASE_NAME).toBe('synthcity-market-v2-fire');
    expect(opened.map(([name]) => name)).toEqual([
      'synthcity-market-v2-fire',
      'synthcity-market-v1',
      'synthcity-market-v2',
    ]);
    expect(writes).toEqual(['synthcity-market-v2-fire/market-cities-v2-fire']);
  });
});
