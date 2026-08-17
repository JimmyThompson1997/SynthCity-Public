import { applyWorldCommand, classifyZoneTileOutcomes, type MarketZoneTileOutcome } from '../market-city/commands';
import { marketFacilityVisualFootprint } from '../market-city/catalog';
import { serializeMarketCityState } from '../market-city/state';
import type {
  MarketCityStateV2,
  MarketFireDifficulty,
  MarketPlaybackSpeed,
  MarketCityWorldCommand,
} from '../market-city/types';
import { translateDashboardCommand } from './command-adapter';
import type { MarketCityController, MarketCityIdentityUpdate } from './controller';
import type { MarketCityPersistence } from './persistence';

export interface MarketDashboardRenderUpdate {
  initial?: boolean;
  command?: unknown;
  changedTileIds?: number[];
  settled?: boolean;
}

export interface MarketDashboardRuntimeHooks {
  render(state: MarketCityStateV2, update: MarketDashboardRenderUpdate): void;
  inspect(coordinate: { x: number; y: number }): void;
  clearInspection(): void;
}

export interface MarketDashboardCommandPlan {
  accepted: boolean;
  reason?: string | undefined;
  message: string;
  cost: 0;
  affectedTileIds: number[];
  changedTileIds: number[];
  /**
   * The exact, non-persisted city state that the accepted command would
   * produce.  It is renderer-only: commit still replays marketCommand after
   * the basis-hash check against the authoritative controller.
   */
  prospectiveState: MarketCityStateV2 | null;
  normalizedCommand: unknown | null;
  basisHash: string;
  marketCommand: MarketCityWorldCommand | null;
  /** Renderer-only outcomes for a partial R/C/I zoning brush. */
  tileOutcomes: MarketZoneTileOutcome[];
  /** Renderer-only outcomes for an empty-only Dezone brush. */
  dezoneTileIds: number[];
}

export interface MarketDashboardCommandResult {
  accepted: boolean;
  reason?: string | undefined;
  message: string;
  cost: 0;
  changedTileIds: number[];
}

function copy<T>(value: T): T {
  return structuredClone(value);
}

function messageFor(result: { ok: boolean; reason?: string }, fallback: string): string {
  return result.ok ? fallback : result.reason ?? 'That market-city command was refused.';
}

function affectedTilesForCommand(state: MarketCityStateV2, command: MarketCityWorldCommand): number[] {
  if ('tileIds' in command) return [...new Set(command.tileIds)].sort((left, right) => left - right);
  if ('path' in command) return [...new Set(command.path)].sort((left, right) => left - right);
  if (command.type === 'reset-elevation') {
    return Array.from({ length: state.map.size * state.map.size }, (_, tile) => tile);
  }
  if (command.type !== 'place-facility') return [];
  const footprint = marketFacilityVisualFootprint(command.kind) ?? { width: 1, height: 1 };
  const [width, height] = [footprint.width, footprint.height];
  const anchorX = command.anchor % state.map.size;
  const anchorY = Math.floor(command.anchor / state.map.size);
  const tiles: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const column = anchorX + x;
      const row = anchorY + y;
      if (column < state.map.size && row < state.map.size) tiles.push(row * state.map.size + column);
    }
  }
  return tiles;
}

/**
 * Synchronous map-command facade plus a serialized durability queue. The page
 * can keep its atomic preview/commit gestures without becoming a second state
 * store, and every accepted mutation is queued to the V2 repository.
 */
export class MarketCityDashboardRuntime {
  private readonly controller: MarketCityController;
  private readonly persistence: MarketCityPersistence;
  private readonly hooks: MarketDashboardRuntimeHooks;
  private durability: Promise<unknown> = Promise.resolve();
  private pendingStepRender: { state: MarketCityStateV2; update: MarketDashboardRenderUpdate } | null = null;
  private stepRenderFrame: number | null = null;

  public constructor(
    controller: MarketCityController,
    persistence: MarketCityPersistence,
    hooks: MarketDashboardRuntimeHooks,
  ) {
    this.controller = controller;
    this.persistence = persistence;
    this.hooks = hooks;
  }

  private queueSave(): void {
    this.durability = this.durability.then(() => this.controller.save());
  }

  private cancelPendingStepRender(): void {
    if (this.stepRenderFrame !== null && typeof globalThis.cancelAnimationFrame === 'function') {
      globalThis.cancelAnimationFrame(this.stepRenderFrame);
    }
    this.stepRenderFrame = null;
    this.pendingStepRender = null;
  }

  private render(update: MarketDashboardRenderUpdate, state?: MarketCityStateV2): void {
    this.cancelPendingStepRender();
    this.hooks.render(state ?? this.controller.snapshot(), update);
  }

  private renderSteppedState(state: MarketCityStateV2, update: MarketDashboardRenderUpdate): void {
    if (typeof globalThis.requestAnimationFrame !== 'function') {
      this.render(update, state);
      return;
    }
    this.pendingStepRender = { state, update };
    if (this.stepRenderFrame !== null) return;
    this.stepRenderFrame = globalThis.requestAnimationFrame(() => {
      this.stepRenderFrame = null;
      const pending = this.pendingStepRender;
      this.pendingStepRender = null;
      if (pending) this.hooks.render(pending.state, pending.update);
    });
  }

  public ready(): void {
    this.render({ initial: true, changedTileIds: [] });
  }

  public preview(command: unknown): MarketDashboardCommandPlan {
    const state = this.controller.snapshot();
    const basisHash = this.controller.hash();
    const translated = translateDashboardCommand(state, command);
    if (!translated.ok) {
      return {
        accepted: false,
        reason: translated.reason,
        message: translated.reason,
        cost: 0,
        affectedTileIds: [],
        changedTileIds: [],
        prospectiveState: null,
        normalizedCommand: null,
        basisHash,
        marketCommand: null,
        tileOutcomes: [],
        dezoneTileIds: [],
      };
    }
    const result = applyWorldCommand(state, translated.command);
    const tileOutcomes = translated.command.type === 'zone'
      ? classifyZoneTileOutcomes(state, translated.command.zone, translated.command.tileIds)
      : [];
    const dezoneTileIds = translated.command.type === 'dezone'
      ? [...result.changedTileIds]
      : [];
    const affectedTileIds = translated.command.type === 'place-avenue' && result.ok
      ? [...result.changedTileIds]
      : affectedTilesForCommand(state, translated.command);
    return {
      accepted: result.ok,
      reason: result.reason,
      message: messageFor(result, 'Free market-city placement ready.'),
      cost: 0,
      affectedTileIds,
      changedTileIds: [...result.changedTileIds],
      prospectiveState: result.ok ? result.state : null,
      normalizedCommand: result.ok ? copy(command) : null,
      basisHash,
      marketCommand: result.ok ? copy(translated.command) : null,
      tileOutcomes,
      dezoneTileIds,
    };
  }

  public commit(plan: MarketDashboardCommandPlan): MarketDashboardCommandResult {
    if (!plan.accepted || !plan.marketCommand || plan.normalizedCommand === null) {
      const reason = plan.reason ?? 'That preview is not valid.';
      return { accepted: false, reason, message: reason, cost: 0, changedTileIds: [] };
    }
    if (plan.basisHash !== this.controller.hash()) {
      const reason = 'The city changed after this preview; move the pointer and try again.';
      return { accepted: false, reason, message: reason, cost: 0, changedTileIds: [] };
    }
    return this.apply(plan.marketCommand, plan.normalizedCommand);
  }

  private apply(command: MarketCityWorldCommand, sourceCommand: unknown): MarketDashboardCommandResult {
    const result = this.controller.dispatch(command);
    const output: MarketDashboardCommandResult = {
      accepted: result.ok,
      reason: result.reason,
      message: messageFor(result, 'City state updated.'),
      cost: 0,
      changedTileIds: [...result.changedTileIds],
    };
    if (!result.ok) return output;
    this.render({ command: copy(sourceCommand), changedTileIds: [...result.changedTileIds] });
    this.queueSave();
    return output;
  }

  public dispatch(command: unknown): MarketDashboardCommandResult {
    const translated = translateDashboardCommand(this.controller.snapshot(), command);
    if (!translated.ok) {
      return {
        accepted: false,
        reason: translated.reason,
        message: translated.reason,
        cost: 0,
        changedTileIds: [],
      };
    }
    return this.apply(translated.command, command);
  }

  public inspect(coordinate: { x: number; y: number }): void {
    this.hooks.inspect(coordinate);
  }

  public queryRoutes(coordinate: { x: number; y: number }): void {
    this.hooks.inspect(coordinate);
  }

  public clearQuery(): void {
    this.hooks.clearInspection();
  }

  public pause(): void {
    this.setSpeed(0);
  }

  public setSpeed(speed: MarketPlaybackSpeed): void {
    this.controller.setSpeed(speed);
    this.controller.setPaused(speed === 0);
    this.render({ changedTileIds: [] });
    this.queueSave();
  }

  public setFireDifficulty(difficulty: MarketFireDifficulty): void {
    this.controller.setFireDifficulty(difficulty);
    this.render({ changedTileIds: [] });
    this.queueSave();
  }

  public setVerticalDevelopmentLevel(level: number): void {
    this.controller.setVerticalDevelopmentLevel(level);
    this.render({ changedTileIds: [] });
    this.queueSave();
  }

  public updateIdentity(update: MarketCityIdentityUpdate): void {
    this.controller.updateIdentity(update);
    this.render({ changedTileIds: [] });
    this.queueSave();
  }

  public step(months = 1): MarketCityStateV2 {
    const state = this.controller.stepMonths(months);
    this.renderSteppedState(state, { command: { type: 'step-market-month', months }, changedTileIds: [] });
    this.queueSave();
    return state;
  }

  public hash(): string {
    return this.controller.hash();
  }

  public get canUndo(): boolean {
    return this.controller.canUndo;
  }

  public snapshot(): MarketCityStateV2 {
    return this.controller.snapshot();
  }

  /** Re-renders session-only projections without mutating or autosaving state. */
  public refresh(): void {
    this.render({ changedTileIds: [] });
  }

  public canonicalSnapshot(): string {
    return serializeMarketCityState(this.controller.snapshot());
  }

  public async undo(): Promise<boolean> {
    const undone = this.controller.undo();
    if (!undone) return false;
    this.render({ command: { type: 'undo' }, changedTileIds: [] });
    this.queueSave();
    return true;
  }

  public async save(): Promise<boolean> {
    this.queueSave();
    await this.whenDurable();
    return true;
  }

  public async reload(): Promise<boolean> {
    await this.whenDurable();
    await this.controller.reload();
    this.render({ initial: true, changedTileIds: [] });
    return true;
  }

  public async delete(): Promise<void> {
    await this.whenDurable();
    await this.persistence.delete(this.controller.cityId);
  }

  public async whenDurable(): Promise<boolean> {
    await this.durability;
    return true;
  }
}
