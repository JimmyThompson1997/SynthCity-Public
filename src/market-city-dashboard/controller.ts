import type {
  MarketCityCommandResult,
  MarketFireDifficulty,
  MarketCityIdentity,
  MarketCityStateV2,
  MarketCityWorldCommand,
  MarketPlaybackSpeed,
} from '../market-city/types';
import { applyWorldCommand } from '../market-city/commands';
import {
  cloneMarketCityState,
  createMarketCityState,
  hashDeterministicState,
  restoreMarketCityState,
  type MarketCityTerrainFixture,
} from '../market-city/state';
import { stepMonth as stepMarketMonth } from '../market-city/simulation';
import type { MarketCityPersistence, MarketCitySummary } from './persistence';

export interface MarketCityControllerEngine<CreateOptions = unknown> {
  createMarketCityState(options: CreateOptions): MarketCityStateV2;
  restoreMarketCityState(value: unknown): MarketCityStateV2;
  cloneMarketCityState?(state: MarketCityStateV2): MarketCityStateV2;
  applyWorldCommand(state: MarketCityStateV2, command: MarketCityWorldCommand): MarketCityCommandResult;
  stepMonth(state: MarketCityStateV2): MarketCityStateV2;
  hashDeterministicState(state: MarketCityStateV2): string;
}

export interface MarketCityCreateOptions {
  identity?: Partial<MarketCityIdentity>;
  terrainFixture?: MarketCityTerrainFixture;
}

export interface MarketCityIdentityUpdate {
  cityName?: string;
  mayorName?: string;
}

/** Builds the production controller engine from the persisted city state only. */
export function createMarketCityControllerEngine(): MarketCityControllerEngine<MarketCityCreateOptions> {
  return Object.freeze({
    createMarketCityState(options: MarketCityCreateOptions): MarketCityStateV2 {
      return createMarketCityState(options.identity, options.terrainFixture);
    },
    cloneMarketCityState,
    restoreMarketCityState,
    applyWorldCommand,
    stepMonth: stepMarketMonth,
    hashDeterministicState,
  } satisfies MarketCityControllerEngine<MarketCityCreateOptions>);
}

/** Ready-to-use adapter for the production market engine. */
export const DEFAULT_MARKET_CITY_CONTROLLER_ENGINE = createMarketCityControllerEngine();

export interface MarketCityControllerDependencies<CreateOptions = unknown> {
  persistence: MarketCityPersistence;
  engine: MarketCityControllerEngine<CreateOptions>;
  maximumUndoDepth?: number;
}

export class MarketCityNotFoundError extends Error {
  public readonly cityId: string;

  public constructor(cityId: string) {
    super(`Market city ${JSON.stringify(cityId)} was not found.`);
    this.name = 'MarketCityNotFoundError';
    this.cityId = cityId;
  }
}

export class MarketCityControllerContractError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'MarketCityControllerContractError';
  }
}

function maximumUndoDepth(value: number | undefined): number {
  if (value === undefined) return 100;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError('maximumUndoDepth must be a positive safe integer.');
  }
  return value;
}

function validCityId(cityId: string): string {
  if (typeof cityId !== 'string' || cityId.trim().length === 0) {
    throw new TypeError('cityId must be a non-empty string.');
  }
  return cityId;
}

function trimmedIdentityName(value: unknown, field: 'cityName' | 'mayorName'): string {
  if (typeof value !== 'string') throw new TypeError(`${field} must be a string.`);
  const trimmed = value.trim();
  if (trimmed.length === 0) throw new TypeError(`${field} must be a non-empty string.`);
  return trimmed;
}

/**
 * Pure simulation orchestration. Rendering, autosave timers, and browser
 * storage details remain outside this object, so command/undo and reload
 * semantics are identical in tests and the hosted game.
 */
export class MarketCityController<CreateOptions = unknown> {
  private state: MarketCityStateV2;
  private readonly persistence: MarketCityPersistence;
  private readonly engine: MarketCityControllerEngine<CreateOptions>;
  private readonly maximumUndoDepth: number;
  private readonly undoStates: MarketCityStateV2[] = [];

  private constructor(
    initialState: MarketCityStateV2,
    dependencies: MarketCityControllerDependencies<CreateOptions>,
  ) {
    this.persistence = dependencies.persistence;
    this.engine = dependencies.engine;
    this.maximumUndoDepth = maximumUndoDepth(dependencies.maximumUndoDepth);
    this.state = this.restore(initialState);
  }

  public static create<CreateOptions>(
    options: CreateOptions,
    dependencies: MarketCityControllerDependencies<CreateOptions>,
  ): MarketCityController<CreateOptions> {
    return new MarketCityController(dependencies.engine.createMarketCityState(options), dependencies);
  }

  public static async load<CreateOptions = unknown>(
    cityId: string,
    dependencies: MarketCityControllerDependencies<CreateOptions>,
  ): Promise<MarketCityController<CreateOptions>> {
    const validId = validCityId(cityId);
    const state = await dependencies.persistence.load(validId);
    if (!state) throw new MarketCityNotFoundError(validId);
    return new MarketCityController(state, dependencies);
  }

  private restore(value: unknown): MarketCityStateV2 {
    // The engine validates and performs the defensive clone.
    return this.engine.restoreMarketCityState(value);
  }

  private clearUndo(): void {
    this.undoStates.length = 0;
  }

  private copy(value: MarketCityStateV2): MarketCityStateV2 {
    return this.engine.cloneMarketCityState?.(value) ?? this.restore(value);
  }

  private pushUndo(state: MarketCityStateV2): void {
    this.undoStates.push(this.copy(state));
    if (this.undoStates.length > this.maximumUndoDepth) {
      this.undoStates.splice(0, this.undoStates.length - this.maximumUndoDepth);
    }
  }

  private setClock(update: (clock: MarketCityStateV2['clock']) => void): void {
    const next = this.snapshot();
    const before = JSON.stringify(next.clock);
    update(next.clock);
    if (JSON.stringify(next.clock) === before) return;
    this.state = this.restore(next);
    // Undo is for contiguous map edits. Clock/settings changes create a new
    // boundary so undo can never rewind time or silently change difficulty.
    this.clearUndo();
  }

  public get canUndo(): boolean {
    return this.undoStates.length > 0;
  }

  public get undoDepth(): number {
    return this.undoStates.length;
  }

  public get cityId(): string {
    return this.state.identity.cityId;
  }

  /** A strict defensive copy of the complete authoritative state. */
  public snapshot(): MarketCityStateV2 {
    return this.copy(this.state);
  }

  public hash(): string {
    return this.engine.hashDeterministicState(this.state);
  }

  public dispatch(command: MarketCityWorldCommand): MarketCityCommandResult {
    const before = this.snapshot();
    const beforeHash = this.engine.hashDeterministicState(before);
    const result = this.engine.applyWorldCommand(this.snapshot(), structuredClone(command));
    if (!result.ok) {
      return { ...result, state: this.snapshot(), changedTileIds: [...result.changedTileIds] };
    }

    const next = this.restore(result.state);
    if (next.economy.treasury !== before.economy.treasury) {
      throw new MarketCityControllerContractError('World commands must be free and may not change treasury.');
    }
    const nextHash = this.engine.hashDeterministicState(next);
    if (nextHash !== beforeHash) {
      this.pushUndo(before);
      this.state = next;
    }
    return { ...result, state: this.snapshot(), changedTileIds: [...result.changedTileIds] };
  }

  public undo(): boolean {
    const before = this.undoStates.pop();
    if (!before) return false;
    this.state = this.restore(before);
    return true;
  }

  /** Explicit stepping advances even while UI playback is paused. */
  public step(): MarketCityStateV2 {
    this.clearUndo();
    this.state = this.engine.stepMonth(this.state);
    return this.snapshot();
  }

  public stepMonths(months: number): MarketCityStateV2 {
    if (!Number.isSafeInteger(months) || months < 0) {
      throw new RangeError('months must be a non-negative safe integer.');
    }
    if (months === 0) return this.snapshot();
    this.clearUndo();
    for (let month = 0; month < months; month += 1) {
      this.state = this.engine.stepMonth(this.state);
    }
    return this.snapshot();
  }

  public setPaused(paused: boolean): void {
    if (typeof paused !== 'boolean') throw new TypeError('paused must be a boolean.');
    this.setClock((clock) => { clock.paused = paused; });
  }

  public setSpeed(speed: MarketPlaybackSpeed): void {
    if (![0, 1, 2, 3].includes(speed)) throw new RangeError('speed must be 0, 1, 2, or 3.');
    this.setClock((clock) => { clock.speed = speed; });
  }

  public setFireDifficulty(fireDifficulty: MarketFireDifficulty): void {
    if (!['easy', 'normal', 'hard'].includes(fireDifficulty)) {
      throw new RangeError('fireDifficulty must be easy, normal, or hard.');
    }
    this.setClock((clock) => { clock.fireDifficulty = fireDifficulty; });
  }

  /** Updates the persisted citywide base story cap without creating density. */
  public setVerticalDevelopmentLevel(level: number): void {
    if (!Number.isInteger(level)) throw new TypeError('verticalDevelopmentLevel must be an integer.');
    if (level < 1 || level > 10) throw new RangeError('verticalDevelopmentLevel must be between 1 and 10.');
    const next = this.snapshot();
    if (next.market.verticalDevelopmentLevel === level) return;
    next.market.verticalDevelopmentLevel = level;
    this.state = this.restore(next);
    this.clearUndo();
  }

  public updateIdentity(update: MarketCityIdentityUpdate): void {
    if (typeof update !== 'object' || update === null || Array.isArray(update)) {
      throw new TypeError('identity update must be an object.');
    }
    const cityName = Object.hasOwn(update, 'cityName')
      ? trimmedIdentityName(update.cityName, 'cityName')
      : undefined;
    const mayorName = Object.hasOwn(update, 'mayorName')
      ? trimmedIdentityName(update.mayorName, 'mayorName')
      : undefined;

    const next = this.snapshot();
    if (cityName !== undefined) next.identity.cityName = cityName;
    if (mayorName !== undefined) next.identity.mayorName = mayorName;
    this.state = this.restore(next);
    this.clearUndo();
  }

  public async save(): Promise<MarketCitySummary> {
    return this.persistence.save(this.snapshot());
  }

  public async reload(): Promise<MarketCityStateV2> {
    const state = await this.persistence.load(this.cityId);
    if (!state) throw new MarketCityNotFoundError(this.cityId);
    this.state = this.restore(state);
    this.clearUndo();
    return this.snapshot();
  }
}
