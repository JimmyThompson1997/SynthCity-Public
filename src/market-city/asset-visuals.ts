/**
 * Browser-global visual defaults for existing gameplay slots.
 *
 * These choices deliberately never enter a MarketCityState: a Fire Station is
 * still a `fire-station` to the simulation, hashes, and saves. The selected
 * renderer is an appearance preference shared by every city on this origin.
 */
export const ASSET_VISUAL_SELECTION_STORAGE_KEY = 'synthcity.asset-visual-selections.v1' as const;
export const ASSET_VISUAL_SELECTION_CHANGED_EVENT = 'synthcity:asset-visual-selection-changed' as const;

export type AssetVisualSlot = 'facility:fire-station';
export type AssetVisualVariantId =
  | 'facility:fire-station:classic'
  | 'facility:fire-station:modern-test';

export interface AssetVisualVariant {
  readonly id: AssetVisualVariantId;
  readonly slot: AssetVisualSlot;
  readonly kind: 'fire-station';
  readonly label: string;
  readonly default: boolean;
  readonly footprint: Readonly<{ width: 1; height: 1 }>;
  readonly rendererVariantId: 'civic-fire-classic' | 'civic-fire-modern-test';
  readonly authority: 'public/design-review/catalog-world-art.js';
}

export type AssetVisualSelections = Readonly<Record<AssetVisualSlot, AssetVisualVariantId>>;

export const VISUAL_ASSET_VARIANTS: readonly AssetVisualVariant[] = Object.freeze([
  Object.freeze({
    id: 'facility:fire-station:classic',
    slot: 'facility:fire-station',
    kind: 'fire-station',
    label: 'Fire Station',
    default: true,
    footprint: Object.freeze({ width: 1, height: 1 }),
    rendererVariantId: 'civic-fire-classic',
    authority: 'public/design-review/catalog-world-art.js',
  }),
  Object.freeze({
    id: 'facility:fire-station:modern-test',
    slot: 'facility:fire-station',
    kind: 'fire-station',
    label: 'Fire Station — Modern Test',
    default: false,
    footprint: Object.freeze({ width: 1, height: 1 }),
    rendererVariantId: 'civic-fire-modern-test',
    authority: 'public/design-review/catalog-world-art.js',
  }),
]);

const VISUAL_SLOTS: readonly AssetVisualSlot[] = Object.freeze(['facility:fire-station']);

const VISUAL_SLOT_CONTRACTS: Readonly<Record<AssetVisualSlot, Readonly<{
  kind: AssetVisualVariant['kind'];
  footprint: AssetVisualVariant['footprint'];
}>>> = Object.freeze({
  'facility:fire-station': Object.freeze({
    kind: 'fire-station',
    footprint: Object.freeze({ width: 1, height: 1 }),
  }),
});

type VisualVariantRegistryCandidate = Readonly<{
  id: string;
  slot: string;
  kind: string;
  default: boolean;
  footprint: Readonly<{ width: number; height: number }>;
}>;

/**
 * Reject a candidate that cannot be an art-only replacement for its slot.
 * Keeping this separate from city state makes additions fail fast at build/test
 * time instead of accidentally changing a facility's mechanics at runtime.
 */
export function assertAssetVisualVariantRegistry(
  variants: readonly VisualVariantRegistryCandidate[] = VISUAL_ASSET_VARIANTS,
): void {
  const ids = new Set<string>();
  const defaultsBySlot = new Map<string, number>();
  for (const variant of variants) {
    if (ids.has(variant.id)) throw new Error(`Duplicate asset visual variant ID: ${variant.id}.`);
    ids.add(variant.id);
    const contract = VISUAL_SLOT_CONTRACTS[variant.slot as AssetVisualSlot];
    if (!contract) throw new Error(`Unknown asset visual slot: ${variant.slot}.`);
    if (variant.kind !== contract.kind) throw new Error(`Asset visual ${variant.id} has incompatible kind for ${variant.slot}.`);
    if (variant.footprint.width !== contract.footprint.width || variant.footprint.height !== contract.footprint.height) {
      throw new Error(`Asset visual ${variant.id} has incompatible footprint for ${variant.slot}.`);
    }
    if (variant.default) defaultsBySlot.set(variant.slot, (defaultsBySlot.get(variant.slot) ?? 0) + 1);
  }
  for (const slot of VISUAL_SLOTS) {
    if (defaultsBySlot.get(slot) !== 1) throw new Error(`Asset visual slot ${slot} must have exactly one compiled default.`);
  }
}

assertAssetVisualVariantRegistry();

export interface AssetVisualStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function variantsForSlot(slot: AssetVisualSlot): readonly AssetVisualVariant[] {
  return VISUAL_ASSET_VARIANTS.filter((variant) => variant.slot === slot);
}

export function defaultAssetVisualVariantForSlot(slot: AssetVisualSlot): AssetVisualVariant {
  const variant = variantsForSlot(slot).find((candidate) => candidate.default);
  if (!variant) throw new Error(`Asset visual slot ${slot} has no compiled default.`);
  return variant;
}

export function assetVisualVariantForSlot(id: string): AssetVisualVariant | null {
  return VISUAL_ASSET_VARIANTS.find((variant) => variant.id === id) ?? null;
}

function defaultSelections(): Record<AssetVisualSlot, AssetVisualVariantId> {
  return Object.fromEntries(VISUAL_SLOTS.map((slot) => [slot, defaultAssetVisualVariantForSlot(slot).id])) as Record<AssetVisualSlot, AssetVisualVariantId>;
}

function validSelection(slot: AssetVisualSlot, value: unknown): AssetVisualVariantId {
  const variant = typeof value === 'string' ? assetVisualVariantForSlot(value) : null;
  return variant?.slot === slot ? variant.id : defaultAssetVisualVariantForSlot(slot).id;
}

export function parseAssetVisualSelections(raw: string | null | undefined): AssetVisualSelections {
  const selections = defaultSelections();
  if (!raw) return Object.freeze(selections);
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; activeBySlot?: unknown };
    if (parsed.version !== 1 || !parsed.activeBySlot || typeof parsed.activeBySlot !== 'object') return Object.freeze(selections);
    const activeBySlot = parsed.activeBySlot as Record<string, unknown>;
    VISUAL_SLOTS.forEach((slot) => { selections[slot] = validSelection(slot, activeBySlot[slot]); });
  } catch {
    return Object.freeze(selections);
  }
  return Object.freeze(selections);
}

export function serializeAssetVisualSelections(selections: Partial<Record<AssetVisualSlot, string>>): string {
  const activeBySlot = defaultSelections();
  VISUAL_SLOTS.forEach((slot) => { activeBySlot[slot] = validSelection(slot, selections[slot]); });
  return JSON.stringify({ version: 1, activeBySlot });
}

function browserStorage(): AssetVisualStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function readAssetVisualSelections(storage: AssetVisualStorage | null = browserStorage()): AssetVisualSelections {
  return parseAssetVisualSelections(storage?.getItem(ASSET_VISUAL_SELECTION_STORAGE_KEY));
}

export function activeAssetVisualVariantForSlot(slot: AssetVisualSlot, storage: AssetVisualStorage | null = browserStorage()): AssetVisualVariant {
  const selected = readAssetVisualSelections(storage)[slot];
  return assetVisualVariantForSlot(selected) ?? defaultAssetVisualVariantForSlot(slot);
}

function emitSelectionChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(ASSET_VISUAL_SELECTION_CHANGED_EVENT));
}

export function makeAssetVisualVariantLive(id: AssetVisualVariantId, storage: AssetVisualStorage | null = browserStorage()): AssetVisualVariant {
  const variant = assetVisualVariantForSlot(id);
  if (!variant) throw new Error(`Unknown asset visual variant ${id}.`);
  if (storage) {
    const selections = readAssetVisualSelections(storage);
    storage.setItem(ASSET_VISUAL_SELECTION_STORAGE_KEY, serializeAssetVisualSelections({ ...selections, [variant.slot]: variant.id }));
  }
  emitSelectionChange();
  return variant;
}

export function restoreBuiltInAssetVisualDefault(slot: AssetVisualSlot, storage: AssetVisualStorage | null = browserStorage()): AssetVisualVariant {
  const defaultVariant = defaultAssetVisualVariantForSlot(slot);
  return makeAssetVisualVariantLive(defaultVariant.id, storage);
}

export function onAssetVisualSelectionChange(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const onStorage = (event: StorageEvent): void => {
    if (event.key === ASSET_VISUAL_SELECTION_STORAGE_KEY) listener();
  };
  window.addEventListener(ASSET_VISUAL_SELECTION_CHANGED_EVENT, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(ASSET_VISUAL_SELECTION_CHANGED_EVENT, listener);
    window.removeEventListener('storage', onStorage);
  };
}
