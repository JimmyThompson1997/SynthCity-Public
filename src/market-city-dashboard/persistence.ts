import {
  MARKET_CITY_RULES_VERSION,
  MARKET_CITY_SCHEMA_VERSION,
  type MarketCityStateV2,
} from '../market-city/types';
import { restoreMarketCityState as restoreCoreMarketCityState } from '../market-city/state';

export const MARKET_CITY_DATABASE_NAME = 'synthcity-market-v2-fire' as const;
export const MARKET_CITY_DATABASE_VERSION = 1 as const;

const CITY_STORE_NAME = 'market-cities-v2-fire';
const PROFILE_STORE_NAME = 'market-profile-v2-fire';
const PROFILE_KEY = 'mayor';
const LEGACY_DATABASES = Object.freeze([
  {
    databaseName: 'synthcity-market-v1',
    cityStoreName: 'market-cities-v1',
    profileStoreName: 'market-profile-v1',
  },
  {
    databaseName: 'synthcity-market-v2',
    cityStoreName: 'market-cities-v2',
    profileStoreName: 'market-profile-v2',
  },
] as const);

export interface MarketCitySummary {
  cityId: string;
  cityName: string;
  mayorName: string;
  seed: number;
  month: number;
  treasury: number;
  savedAt: string;
}

export interface MarketMayorProfileV1 {
  schemaVersion: 1;
  mayorName: string;
  updatedAt: string;
}

export interface MarketMayorProfileInput {
  mayorName: string;
}

export interface MarketCityPersistence {
  listCitySummaries(): Promise<MarketCitySummary[]>;
  load(cityId: string): Promise<MarketCityStateV2 | null>;
  save(state: MarketCityStateV2): Promise<MarketCitySummary>;
  delete(cityId: string): Promise<void>;
  loadMayorProfile(): Promise<MarketMayorProfileV1 | null>;
  saveMayorProfile(profile: MarketMayorProfileInput): Promise<MarketMayorProfileV1>;
}

export class MarketCityRestoreError extends Error {
  public constructor(message: string) {
    super(`Invalid MarketCityState: ${message}`);
    this.name = 'MarketCityRestoreError';
  }
}

function restoreError(path: string, message: string): never {
  throw new MarketCityRestoreError(`${path} ${message}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function record(value: unknown, path: string, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!isRecord(value)) restoreError(path, 'must be a plain object.');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!('value' in descriptor)) restoreError(`${path}.${key}`, 'must be a data property.');
    if (!descriptor.enumerable) restoreError(`${path}.${key}`, 'must be enumerable.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) restoreError(path, 'must not contain symbol properties.');
  const actualKeys = Object.keys(value);
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) restoreError(path, `is missing ${missing.join(', ')}.`);
  const unexpected = actualKeys.filter((key) => !expectedKeys.includes(key));
  if (unexpected.length > 0) restoreError(path, `has unexpected ${unexpected.join(', ')}.`);
  return value;
}

function assertPlainDataTree(value: unknown, path = 'state', visited = new WeakSet<object>()): void {
  if (typeof value !== 'object' || value === null) return;
  if (visited.has(value)) return;
  visited.add(value);
  if (!Array.isArray(value)) {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) restoreError(path, 'must be a plain object.');
  }
  if (Object.getOwnPropertySymbols(value).length > 0) restoreError(path, 'must not contain symbol properties.');
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (Array.isArray(value) && key === 'length') continue;
    if (!('value' in descriptor)) restoreError(`${path}.${key}`, 'must be a data property.');
    if (!descriptor.enumerable) restoreError(`${path}.${key}`, 'must be enumerable.');
    assertPlainDataTree(descriptor.value, Array.isArray(value) ? `${path}[${key}]` : `${path}.${key}`, visited);
  }
}

function stringValue(value: unknown, path: string, options: { nonEmpty?: boolean } = {}): string {
  if (typeof value !== 'string') restoreError(path, 'must be a string.');
  if (options.nonEmpty && value.trim().length === 0) restoreError(path, 'must not be empty.');
  return value;
}

function exactLiteral<T extends string | number>(value: unknown, expected: T, path: string): T {
  if (value !== expected) restoreError(path, `must be ${JSON.stringify(expected)}.`);
  return expected;
}

function isoTimestamp(value: unknown, path: string): string {
  const timestamp = stringValue(value, path, { nonEmpty: true });
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp) {
    restoreError(path, 'must be a canonical ISO timestamp.');
  }
  return timestamp;
}

/** Restores only the current strict state and never normalizes legacy saves. */
export function restorePersistedMarketCityState(value: unknown): MarketCityStateV2 {
  try {
    assertPlainDataTree(value);
    return restoreCoreMarketCityState(value);
  } catch (error) {
    if (error instanceof MarketCityRestoreError) throw error;
    throw new MarketCityRestoreError(error instanceof Error ? error.message : String(error));
  }
}

function cloneCanonicalState(value: unknown): MarketCityStateV2 {
  assertPlainDataTree(value);
  if (!isRecord(value) || value.schemaVersion !== MARKET_CITY_SCHEMA_VERSION) {
    throw new MarketCityRestoreError(`state.schemaVersion must be ${MARKET_CITY_SCHEMA_VERSION} for new saves.`);
  }
  if (value.rulesVersion !== MARKET_CITY_RULES_VERSION) {
    throw new MarketCityRestoreError(`state.rulesVersion must be ${MARKET_CITY_RULES_VERSION} for new saves.`);
  }
  return restorePersistedMarketCityState(value);
}

function validateCityId(cityId: string): string {
  if (typeof cityId !== 'string' || cityId.trim().length === 0) {
    throw new TypeError('cityId must be a non-empty string.');
  }
  return cityId;
}

function validateMayorProfileInput(value: MarketMayorProfileInput): string {
  const source = record(value, 'profile', ['mayorName']);
  return stringValue(source.mayorName, 'profile.mayorName', { nonEmpty: true });
}

function summaryFor(state: MarketCityStateV2, savedAt: string): MarketCitySummary {
  return {
    cityId: state.identity.cityId,
    cityName: state.identity.cityName,
    mayorName: state.identity.mayorName,
    seed: state.identity.seed,
    month: state.clock.month,
    treasury: state.economy.treasury,
    savedAt,
  };
}

function compareSummaries(left: MarketCitySummary, right: MarketCitySummary): number {
  return right.savedAt.localeCompare(left.savedAt)
    || left.cityName.localeCompare(right.cityName)
    || left.cityId.localeCompare(right.cityId);
}

interface StoredCityRecord {
  cityId: string;
  savedAt: string;
  state: MarketCityStateV2;
}

interface StoredProfileRecord {
  key: typeof PROFILE_KEY;
  profile: MarketMayorProfileV1;
}

export interface MarketCityPersistenceOptions {
  now?: () => string;
}

/** Deterministic, alias-safe repository used by unit tests and non-browser tools. */
export class MemoryMarketCityPersistence implements MarketCityPersistence {
  private readonly cities = new Map<string, StoredCityRecord>();
  private profile: MarketMayorProfileV1 | null = null;
  private readonly now: () => string;

  public constructor(options: MarketCityPersistenceOptions = {}) {
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async listCitySummaries(): Promise<MarketCitySummary[]> {
    return [...this.cities.values()]
      .map((entry) => summaryFor(entry.state, entry.savedAt))
      .sort(compareSummaries);
  }

  public async load(cityId: string): Promise<MarketCityStateV2 | null> {
    const entry = this.cities.get(validateCityId(cityId));
    return entry ? restorePersistedMarketCityState(entry.state) : null;
  }

  public async save(value: MarketCityStateV2): Promise<MarketCitySummary> {
    const state = cloneCanonicalState(value);
    const savedAt = isoTimestamp(this.now(), 'savedAt');
    this.cities.set(state.identity.cityId, { cityId: state.identity.cityId, savedAt, state });
    return summaryFor(state, savedAt);
  }

  public async delete(cityId: string): Promise<void> {
    this.cities.delete(validateCityId(cityId));
  }

  public async loadMayorProfile(): Promise<MarketMayorProfileV1 | null> {
    return this.profile ? structuredClone(this.profile) : null;
  }

  public async saveMayorProfile(value: MarketMayorProfileInput): Promise<MarketMayorProfileV1> {
    const profile: MarketMayorProfileV1 = {
      schemaVersion: 1,
      mayorName: validateMayorProfileInput(value),
      updatedAt: isoTimestamp(this.now(), 'profile.updatedAt'),
    };
    this.profile = structuredClone(profile);
    return structuredClone(profile);
  }
}

export interface BrowserMarketCityPersistenceOptions extends MarketCityPersistenceOptions {
  indexedDB?: IDBFactory;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
  });
}

function transactionCompletion(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed.'));
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction was aborted.'));
  });
}

function storedCityRecord(value: unknown): StoredCityRecord {
  const source = record(value, 'stored city', ['cityId', 'savedAt', 'state']);
  const state = restorePersistedMarketCityState(source.state);
  const cityId = stringValue(source.cityId, 'stored city.cityId', { nonEmpty: true });
  if (cityId !== state.identity.cityId) restoreError('stored city.cityId', 'must match state.identity.cityId.');
  return { cityId, savedAt: isoTimestamp(source.savedAt, 'stored city.savedAt'), state };
}

function restoredProfile(value: unknown): MarketMayorProfileV1 {
  const source = record(value, 'stored profile', ['schemaVersion', 'mayorName', 'updatedAt']);
  return {
    schemaVersion: exactLiteral(source.schemaVersion, 1, 'stored profile.schemaVersion'),
    mayorName: stringValue(source.mayorName, 'stored profile.mayorName', { nonEmpty: true }),
    updatedAt: isoTimestamp(source.updatedAt, 'stored profile.updatedAt'),
  };
}

/** Browser repository for the incompatible building-unit-fire cutover. */
export class BrowserMarketCityPersistence implements MarketCityPersistence {
  private readonly indexedDB: IDBFactory;
  private readonly now: () => string;
  private databasePromise: Promise<IDBDatabase> | null = null;
  private readonly legacyDatabasePromises = new Map<string, Promise<IDBDatabase | null>>();

  public constructor(options: BrowserMarketCityPersistenceOptions = {}) {
    const indexedDB = options.indexedDB ?? globalThis.indexedDB;
    if (!indexedDB) throw new Error('IndexedDB is unavailable.');
    this.indexedDB = indexedDB;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  private database(): Promise<IDBDatabase> {
    if (this.databasePromise) return this.databasePromise;
    this.databasePromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = this.indexedDB.open(MARKET_CITY_DATABASE_NAME, MARKET_CITY_DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(CITY_STORE_NAME)) {
          database.createObjectStore(CITY_STORE_NAME, { keyPath: 'cityId' });
        }
        if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
          database.createObjectStore(PROFILE_STORE_NAME, { keyPath: 'key' });
        }
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error ?? new Error('Could not open MarketCity IndexedDB.'));
      request.onblocked = () => reject(new Error('MarketCity IndexedDB upgrade is blocked.'));
    }).catch((error: unknown) => {
      this.databasePromise = null;
      throw error;
    });
    return this.databasePromise;
  }

  private legacyDatabase(databaseName: string): Promise<IDBDatabase | null> {
    const existing = this.legacyDatabasePromises.get(databaseName);
    if (existing) return existing;
    let missing = false;
    const promise = new Promise<IDBDatabase | null>((resolve, reject) => {
      // Opening without a version reads every historical DB version. If the DB
      // does not exist, abort its version-zero creation and treat it as absent.
      const request = this.indexedDB.open(databaseName);
      request.onupgradeneeded = () => {
        missing = true;
        request.transaction?.abort();
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => {
        if (missing) resolve(null);
        else reject(request.error ?? new Error(`Could not open legacy MarketCity IndexedDB ${databaseName}.`));
      };
      request.onblocked = () => reject(new Error(`Legacy MarketCity IndexedDB ${databaseName} is blocked.`));
    }).catch((error: unknown) => {
      this.legacyDatabasePromises.delete(databaseName);
      throw error;
    });
    this.legacyDatabasePromises.set(databaseName, promise);
    return promise;
  }

  private async readAllCities(database: IDBDatabase, storeName: string): Promise<StoredCityRecord[]> {
    if (!database.objectStoreNames.contains(storeName)) return [];
    const transaction = database.transaction(storeName, 'readonly');
    const completed = transactionCompletion(transaction);
    const [raw] = await Promise.all([
      requestResult(transaction.objectStore(storeName).getAll()),
      completed,
    ]);
    return raw.map(storedCityRecord);
  }

  private async readCity(
    database: IDBDatabase,
    storeName: string,
    cityId: string,
  ): Promise<MarketCityStateV2 | null> {
    if (!database.objectStoreNames.contains(storeName)) return null;
    const transaction = database.transaction(storeName, 'readonly');
    const completed = transactionCompletion(transaction);
    const [raw] = await Promise.all([
      requestResult(transaction.objectStore(storeName).get(cityId)),
      completed,
    ]);
    return raw === undefined ? null : storedCityRecord(raw).state;
  }

  public async listCitySummaries(): Promise<MarketCitySummary[]> {
    const database = await this.database();
    const current = await this.readAllCities(database, CITY_STORE_NAME);
    const legacyDatabases = await Promise.all(LEGACY_DATABASES.map(async (source) => ({
      source,
      database: await this.legacyDatabase(source.databaseName),
    })));
    const byCityId = new Map(current.map((entry) => [entry.cityId, entry]));
    for (const { source, database: legacy } of legacyDatabases) {
      if (!legacy) continue;
      for (const entry of await this.readAllCities(legacy, source.cityStoreName)) {
        if (!byCityId.has(entry.cityId)) byCityId.set(entry.cityId, entry);
      }
    }
    return [...byCityId.values()].map((entry) => summaryFor(entry.state, entry.savedAt)).sort(compareSummaries);
  }

  public async load(cityId: string): Promise<MarketCityStateV2 | null> {
    const validCityId = validateCityId(cityId);
    const database = await this.database();
    const current = await this.readCity(database, CITY_STORE_NAME, validCityId);
    if (current) return current;
    for (const source of LEGACY_DATABASES) {
      const legacy = await this.legacyDatabase(source.databaseName);
      if (!legacy) continue;
      const restored = await this.readCity(legacy, source.cityStoreName, validCityId);
      if (restored) return restored;
    }
    return null;
  }

  public async save(value: MarketCityStateV2): Promise<MarketCitySummary> {
    const state = cloneCanonicalState(value);
    const savedAt = isoTimestamp(this.now(), 'savedAt');
    const stored: StoredCityRecord = { cityId: state.identity.cityId, savedAt, state };
    const database = await this.database();
    const transaction = database.transaction(CITY_STORE_NAME, 'readwrite');
    const completed = transactionCompletion(transaction);
    await Promise.all([requestResult(transaction.objectStore(CITY_STORE_NAME).put(stored)), completed]);
    return summaryFor(state, savedAt);
  }

  public async delete(cityId: string): Promise<void> {
    const database = await this.database();
    const transaction = database.transaction(CITY_STORE_NAME, 'readwrite');
    const completed = transactionCompletion(transaction);
    await Promise.all([
      requestResult(transaction.objectStore(CITY_STORE_NAME).delete(validateCityId(cityId))),
      completed,
    ]);
  }

  public async loadMayorProfile(): Promise<MarketMayorProfileV1 | null> {
    const database = await this.database();
    const transaction = database.transaction(PROFILE_STORE_NAME, 'readonly');
    const completed = transactionCompletion(transaction);
    const [raw] = await Promise.all([
      requestResult(transaction.objectStore(PROFILE_STORE_NAME).get(PROFILE_KEY)),
      completed,
    ]);
    if (raw !== undefined) {
      const source = record(raw, 'stored profile record', ['key', 'profile']);
      exactLiteral(source.key, PROFILE_KEY, 'stored profile record.key');
      return restoredProfile(source.profile);
    }
    for (const legacySource of LEGACY_DATABASES) {
      const legacy = await this.legacyDatabase(legacySource.databaseName);
      if (!legacy || !legacy.objectStoreNames.contains(legacySource.profileStoreName)) continue;
      const legacyTransaction = legacy.transaction(legacySource.profileStoreName, 'readonly');
      const legacyCompleted = transactionCompletion(legacyTransaction);
      const [legacyRaw] = await Promise.all([
        requestResult(legacyTransaction.objectStore(legacySource.profileStoreName).get(PROFILE_KEY)),
        legacyCompleted,
      ]);
      if (legacyRaw === undefined) continue;
      const source = record(legacyRaw, 'stored profile record', ['key', 'profile']);
      exactLiteral(source.key, PROFILE_KEY, 'stored profile record.key');
      return restoredProfile(source.profile);
    }
    return null;
  }

  public async saveMayorProfile(value: MarketMayorProfileInput): Promise<MarketMayorProfileV1> {
    const profile: MarketMayorProfileV1 = {
      schemaVersion: 1,
      mayorName: validateMayorProfileInput(value),
      updatedAt: isoTimestamp(this.now(), 'profile.updatedAt'),
    };
    const stored: StoredProfileRecord = { key: PROFILE_KEY, profile };
    const database = await this.database();
    const transaction = database.transaction(PROFILE_STORE_NAME, 'readwrite');
    const completed = transactionCompletion(transaction);
    await Promise.all([requestResult(transaction.objectStore(PROFILE_STORE_NAME).put(stored)), completed]);
    return structuredClone(profile);
  }

  public async close(): Promise<void> {
    if (this.databasePromise) (await this.databasePromise).close();
    for (const databasePromise of this.legacyDatabasePromises.values()) {
      (await databasePromise)?.close();
    }
    this.databasePromise = null;
    this.legacyDatabasePromises.clear();
  }
}
