# Opening and Terrain Editor Vertical Slice

## Intent and boundary

This milestone implements the manual's city-entry sequence before normal construction play: the complete opening menu and charter, a terrain editor, then a paused playable city. It covers ledger rows `opening.opening-menu` through `opening.scenario-excluded` (manual PDF pages 29–35) and `terrain.editor-entry` through `terrain.demolish-and-cost` (pages 31–33 and 45–46).

Scenario play remains excluded, as agreed. Starter Town and Real City Terrain are in scope for the final personal sandbox, not this first implementation slice. Audio and legacy `.sc3` import remain out of scope.

## Acceptance sequence

1. Opening screen has the seven manual actions in manual order. Start New City and a harmless local-browser Exit are active. Load City, Starter Town, Real City Terrain, Play Scenario, and Preferences are visibly deferred rather than falsely presented as working; the separate Continue Autosave route remains available when a local save exists.
2. New City Options accepts non-default city/mayor names, difficulty, start year, city size, disasters, and auto-budget, then enters terrain editing instead of starting the simulation. Starting-treasury and date-filtered-catalog previews remain later work.
3. Terrain editor has an isometric preview, four rotations, zoom, map-center/edge navigation, mountain/water/tree controls, deterministic Regenerate, and Accept This Terrain. Slider changes affect only the pending preview until Regenerate.
4. Terrain tools support click and drag preview/commit for raise, lower, level-from-first-cell, tree planting, and surface water. Invalid/protected tiles have red previews; cancellation leaves canonical state unchanged. Terrain costs/refunds are explained before commit.
5. Accepting terrain creates a paused city. Its options, map dimensions, seed, terrain, and treasury survive local autosave/load; an explicit slot-based save/load UI remains later work.

## Exact remaining checkboxes

- [x] `opening.opening-menu`: list all seven manual actions in order and provide safe local-browser Exit behavior; deferred routes are intentionally disabled and still need implementation.
- [x] `opening.new-city-options`: route the charter form through terrain editing and browser-test non-default identity, size, date, and seed values; catalog previews remain.
- [ ] `opening.difficulty-starting-funds`: measure original Unlimited starting funds and difficulty side effects.
- [ ] `opening.start-date-inventions`: implement and test date-filtered catalog/preview.
- [ ] `opening.city-size`: measure original map dimensions and performance choices.
- [ ] `opening.disaster-toggle`: connect the persisted setting to random-disaster scheduling and City Options.
- [ ] `opening.auto-budget`: implement annual budget presentation and status-quo behavior.
- [ ] `opening.starter-town`: catalog/preview planning templates and pass selection into New City Options.
- [ ] `opening.real-city-terrain`: catalog/preview terrain templates and pass selection into New City Options.
- [x] `opening.scenario-excluded`: keep scenario creation/play excluded from this sandbox milestone.
- [x] `terrain.editor-entry`: pre-simulation terrain-editor route has Accept and deterministic Regenerate.
- [x] `terrain.generation-sliders`: pending mountain/water/tree sliders apply only on Regenerate and preserve the selected values.
- [x] `terrain.rotate-and-zoom`: editor-specific camera controls have production-browser coverage.
- [x] `terrain.raise-lower-level`: transactional click/drag gestures, level-source handling, previews, and Shift cancellation are implemented; original visual parity remains unmeasured.
- [ ] `terrain.plant-trees`: click/drag planting works, but repeated-placement variants and city tree choice remain.
- [ ] `terrain.surface-water`: editor interaction/preview works; pump integration remains.
- [ ] `terrain.demolish-and-cost`: free pre-founding feedback and protected-state transactions work; manual-compatible running-city prices/refunds remain unresolved.

## Current evidence and required proof

`tests/ledger/opening-terrain-slice.test.ts` covers charter persistence, the provisional difficulty-treasury table, deterministic seeded terrain at all four selectable sizes, and transactional terrain commands. `tests/sim/terrain-editor.test.ts` covers staged settings, regeneration, free edits, cancellation safety, and terrain transfer. Production Chromium coverage in `tests/e2e/terrain-editor.spec.ts` and `tests/e2e/foundation-hardening.spec.ts` covers opening order, non-default creation, settings retention, visual terrain mutation, regeneration rollback, camera controls, drag batching, Shift cancellation, and founding a paused January city. A separate Codex in-app-browser pass exercised the production bundle through painting, founding, construction, time advance, and a clean browser console. None of this substitutes for licensed-original parity evidence.

Before moving any required row to `parity_verified`, run the unit suite, build a production bundle, and use Chromium at localhost to create a non-default city, edit and accept terrain, save/reload it, and capture screenshots plus canonical state hashes. Then repeat the same controlled probe in the licensed original Unlimited copy for every formula or presentation decision below.

## Oracle gaps and contradictions

- The manual specifies that easy starts with more money but does not give the exact difficulty tables or secondary effects; current `$50k/$20k/$10k` values are provisional until original-copy probes.
- The manual says City Size controls tile count but does not list exact original dimensions; current `64/128/192/256` choices are provisional.
- Terrain slider ranges, distributions, Real City/Starter Town catalogs, terrain costs/refunds, repeated-tree variants, and precise preview colors are not sufficiently specified for near-exact parity.
- Cross-slice dependency: PDF page 52 says a fresh-water pump must be directly next to water for full capacity, while page 117 says it must be very near water or it will not work. Surface-water acceptance must not claim pump-placement parity until the licensed-copy probe resolves this conflict.
