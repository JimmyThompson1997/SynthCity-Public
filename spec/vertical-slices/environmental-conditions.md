# Environmental conditions vertical slice

## Intent and source boundary

This slice establishes the first local city-condition loop: **Air Pollution**, **Water Pollution**, and **Land Value**. These are three distinct, authoritative, per-tile simulation fields. They connect the existing coal plant, occupied Industrial development, routed road/highway use, trees, fresh-water pumps, zoning growth, finance, Query, and Review surfaces without pretending that the wider Environment or City Planning departments are complete.

The governing source is the archived SimCity 3000 Unlimited manual whose SHA-256 is `39219465579d48310a661c720e19d0175c56b934abf26125a671a18d16cdf556`. Page numbers below are the manual's printed page labels, not PDF leaf numbers.

This slice includes:

- deterministic local air-pollution emission, spread, and tree mitigation;
- deterministic local water pollution, severe-pollution water browning, and fresh-water pump efficiency loss;
- deterministic local land value influenced by current pollution, utilities, and convenient transport access;
- land value as the finance tax-base input and as a constraint on development quality/density and later redevelopment;
- player-readable Land Value, Air Pollution, and Water Pollution data maps with legends, staged Apply/Default behavior, and one active overlay at a time;
- Query values that come from the same authoritative fields as maps, growth, pumps, and finance;
- strict migration, save/restore, replay, batch-advance, and canonical-hash behavior for all three fields.

It deliberately excludes garbage generation/disposal/pollution, litter, radiation, nuclear incidents, health/life expectancy, crime, fire, aura/approval, parks, civic-service desirability, NIMBY buildings, ordinances, water-treatment plants, clean/high-tech industry progression, wind or terrain-dependent dispersion, seasonal/weather effects, historical pollution graphs, advisor charts, and the full original Data Maps catalog. Those later systems may add sources, sinks, or land-value factors through explicit interfaces; this slice must not invent placeholder values for them.

## Manual-grounded contracts

1. Coal power is inexpensive but creates substantial pollution (page 51). An intact coal-plant anchor is therefore a stationary air-pollution source.
2. Heavy traffic and smokestack industry are identified as the two largest air-pollution causes. Mass transit and cleaner industry can reduce the problem, while trees and parks clean the air "a bit" (page 104). In this bounded slice, emissions come from **actual settled road/highway use**, not unused pavement, and from **occupied Industrial buildings**, not empty Industrial zoning. Trees provide the available mitigation. Parks, clean-industry classes, and ordinances remain excluded.
3. Air pollution lowers land value and health (page 104). This slice implements the land-value effect only; the future health model must consume the same air-pollution field rather than create a second pollution calculation.
4. Water pollution comes primarily from industry. Severe pollution turns nearby surface water brown, reduces pump efficiency, and lowers health (page 105). This slice implements occupied-industry sources, localized pollution of surface-water tiles, the visible severe threshold, and efficiency loss for fresh-water pumping stations drawing from affected water. Health remains excluded.
5. Land value represents how pleasant an area is and is influenced by pollution, crime, convenient access, and nearby desirable or undesirable buildings. It fluctuates when local conditions change; higher values permit higher-density, larger, and more exclusive development, while changed values can replace existing zoned buildings (page 101). This slice implements the factors for which authoritative state already exists: air pollution, water pollution, utility supply, and transport access. Crime, civic services, parks, and NIMBYs remain explicit missing inputs.
6. Building outcomes reflect zone density and land value (pages 15 and 98). Density is a ceiling rather than a guarantee, and very high land value is required to reach the full zoned density (pages 98-99). Monthly growth/redevelopment must therefore consult the local Land Value field; merely choosing Dense zoning must not force a high-rise outcome.
7. Residential, Commercial, and Industrial tax revenue uses Tax Rate multiplied by sector population, average land value, and a constant (page 88). The finance model must derive each sector's average/taxable land value from occupied tiles in the canonical Land Value field, replacing the finance slice's fixed placeholder without changing the already documented provisional tax constant or rounding policy.
8. Query can inspect any structure, land, or tree; a house reports zone density and land value (page 39). Land value is also specifically listed as Query information for a selected building or piece of land (page 101). Query must report the selected tile's authoritative Land Value, Air Pollution, and Water Pollution values where applicable, plus contextual source/mitigation and pump-efficiency facts, without recomputing simulation truth in the UI.
9. View City Layers allows one city data view at a time. Higher Land Value is shown with greater blue intensity, higher Pollution with greater red intensity, Apply updates the City View, Default View restores the original settings after Apply, and the checkmark applies and closes (pages 41-42).
10. View Data exposes advisor-maintained maps with a legend explaining the displayed data; maps can also be shown in the City View. The manual lists Land Value and a segmented Pollution map covering air, water, and garbage (pages 66-67). This bounded slice exposes separate Land Value, Air Pollution, and Water Pollution selections so each canonical field and legend can be tested directly. Garbage remains unavailable rather than appearing as a false zero-valued map.
11. Map color, legend value, Query detail, pump efficiency, building outcome, and finance use must agree for one settled snapshot. Rotating, zooming, opening Review, staging a view, applying/defaulting a view, or querying must never advance or mutate the three condition fields.

## Exact manual rules versus provisional rules

### Exact manual rules

- Coal power, occupied heavy industry, and heavy traffic contribute air pollution.
- Trees and parks mitigate air pollution to some degree; only the already available tree input is in scope here.
- Air pollution reduces land value.
- Industry is the primary water-pollution source; severe local water pollution browns surface water and reduces pump efficiency.
- Pollution and convenient access contribute to land value.
- Local land value changes with conditions, affects the kind/quality/density of zoned development, and participates in redevelopment.
- Sector tax revenue uses average land value as one multiplicative input.
- Query reports local land value, while data maps use increasing blue for Land Value and increasing red for Pollution.
- One city data overlay is active at a time; Apply, Default, and apply-and-close have the manual-described display semantics.

### Explicitly provisional until licensed-original measurement

- Numeric domains, emission strengths, distance kernels, falloff, clamping, tree absorption strength/radius, and whether pollution persists or is completely recalculated each month.
- Whether coal emissions depend on current load, plant age, maintenance, or merely an intact operating plant. The bounded implementation may use one centralized intact-plant source rule.
- Industrial emission differences by zone density, building archetype, era, education, occupancy, or high-tech class. The bounded implementation may use occupied activity and density through one centralized rule.
- The transport-usage conversion for roads versus highways, congestion sensitivity, and any vehicle-to-pollution coefficient. Geometry without settled use must always contribute zero.
- Water-pollution transport across land, coast, and connected water bodies; source radius; decay; severe/brown threshold; and the pump sampling/efficiency curve.
- Land-value numeric range, base value, falloff, access/utility bonuses, pollution penalties, neighborhood radius, sector weighting, and waterfront/elevation effects.
- Development land-value bands, building choice inside a band, redevelopment cadence/chance, hysteresis, abandonment thresholds, and the exact meaning of "very high" for full zoned density.
- Map palettes, breakpoints, legend labels, overlay opacity, original window geometry, and whether separate Air/Water choices appeared exactly this way in the original. Separate selections are a bounded personal-game presentation of the manual's segmented Pollution map.
- Whether applied display settings persist with an original save. For this slice, display selection is pure local UI preference state and persists across a local autosave reload; simulation fields persist independently and exactly.

Every provisional coefficient must be centralized, integer/rational where practical, deterministic, explicitly named provisional, and replaceable without rewriting historical commands. No provisional result may be labeled `parity_verified`.

## Canonical condition model

The simulation owns exactly three new tile-aligned fields, each with the same width, height, row-major indexing, and rotation-independent coordinates as terrain:

- `airPollution`: bounded non-negative integer intensity on every tile;
- `waterPollution`: bounded non-negative integer intensity, with zero required on non-surface-water tiles;
- `landValue`: bounded non-negative integer value for every queryable land tile, with a documented neutral value for non-developable/water tiles.

The fields are canonical settled simulation state. Renderer colors, legends, Query, finance, pumps, and growth read them; none maintains a private copy or derives a different value. Source contributions and intermediate accumulators are deterministic transient calculations, not independently editable save data. Each field carries or is covered by the world's settled condition tick so a save cannot pair arrays with a different month.

Source accounting is deliberately narrow:

- each intact coal-plant anchor contributes once, never once per footprint part;
- each occupied Industrial building contributes from its stable anchor/activity, never once per covered tile unless the centralized rule explicitly normalizes by footprint;
- each routed road/highway usage count contributes once to its traversed network tile; unused roads/highways and rail/subway geometry contribute no air pollution;
- each tree contributes only the centralized air-mitigation kernel and can never make an intensity negative;
- only occupied industry contributes water pollution in this slice, and only surface-water tiles retain a settled water-pollution value.

Land value consumes settled local pollution plus authoritative utility and transport-access facts. It must not inspect rendered sprites, camera state, view selection, hover state, or browser timing. Unimplemented factors contribute no hidden pseudo-random bonus or penalty; their absence is visible in Query/model provenance and remains a parity gap.

## Deterministic whole-month ordering

One month advances in this order, integrated with the existing utility, transport, growth, and finance loop:

1. cross the calendar boundary and retain the start-of-month settled buildings, occupancy, networks, facility anchors, trees, and funding state as the source snapshot;
2. refresh power plus transport routes/usage from that snapshot, including current Roads/Mass Transit effectiveness;
3. clear transient condition accumulators, add coal, occupied-industry, and actual road/highway-use air sources in stable tile/anchor order, spread with the centralized kernel, apply tree mitigation, and clamp once at the documented stage;
4. add occupied-industry water sources in stable order, spread them to eligible surface-water tiles, clamp once, and derive the visible severe/brown classification;
5. derive fresh-water pump efficiency from the settled pollution of the water tiles each pump actually samples, then refresh water capacity/distribution once with that efficiency (never recursively);
6. derive Land Value once from the settled Air Pollution, Water Pollution, final utility supply, and transport-access state;
7. calculate RCI demand and perform growth/redevelopment using that Land Value field; new or replaced buildings do not retroactively emit during the month already being settled;
8. calculate finance from post-growth sector activity and the occupied tiles' settled Land Value, then perform the existing operating/annual settlement ordering;
9. publish one internally consistent snapshot and canonical hash for Query, View Data, renderer, persistence, and the UI.

This one-month transition is the only place pollution is recomputed and the only place ordinary Land Value changes. A structural terrain command may immediately enforce the two save-valid topology invariants—surface water has zero Land Value and non-water has zero Water Pollution—without recomputing any otherwise settled tile; the next monthly transition replaces that narrow hybrid with a fully settled field. Advancing many months in one command must equal advancing one month at a time. Display and Query actions never trigger a recomputation. The one-pass pump rule prevents water pollution -> pump output -> watered state -> land value from becoming a same-month feedback loop.

## Deterministic acceptance matrix

1. Founding or migrating a city creates three correctly sized, bounded, deterministic fields without advancing time, cash, RNG, growth, utilities, transport usage, or command sequence.
2. Adding one coal plant increases Air Pollution in its provisional kernel after the next month; its footprint parts never multiply the anchor emission.
3. Empty Industrial zoning emits nothing. Otherwise-identical occupied Industrial development increases Air and nearby surface-water Pollution after the next month.
4. Unused road/highway geometry emits nothing. Otherwise-identical routed use produces a monotonic Air Pollution increase on the actually used tiles; rail/subway usage does not enter this slice's road-vehicle source.
5. Adding a tree in the affected area weakly reduces next-month Air Pollution relative to an otherwise-identical control, never increases it, and never underflows below zero. Removing it restores the expected source-only result.
6. Multiple sources and mitigators combine in stable coordinate order with one documented rounding/clamping policy; rotation, camera, worker count, save/reload, and batch size cannot change the result.
7. Water Pollution remains zero on non-water tiles. Near-source water weakly exceeds an otherwise-identical far/control tile, and reaching the severe threshold produces the exact renderer classification used for brown water.
8. A fresh-water pump sampling polluted water has lower effective capacity than an otherwise-identical clean-water pump. This can reduce watered coverage through the existing finite allocation order, but cannot alter pipe geometry or mutate the nominal catalog capacity.
9. Higher Air or Water Pollution weakly lowers affected Land Value. Authoritative powered, watered, and convenient-access conditions weakly raise value under otherwise-identical inputs. No excluded factor silently affects it.
10. Querying a coal plant, occupied industry, used road/highway, tree, polluted water, pump, developed zone, and plain land reports the relevant settled field values and source/mitigation/efficiency context from one snapshot.
11. Low- and high-value otherwise-identical zoned tiles produce outcomes constrained by their value bands. Dense zoning at insufficient value does not force full-density development; sustained value changes can cause deterministic redevelopment only during monthly growth.
12. Finance uses occupied tile Land Value to calculate sector taxable value. A controlled land-value increase changes the applicable projected/settled tax category monotonically without changing tax rates or unrelated sectors.
13. Land Value, Air Pollution, and Water Pollution maps each have a readable numeric/ranged legend whose colors match the canvas. At one tile, map classification, Query number, pump/building effect, and authoritative array agree.
14. Only one overlay can be active. Selecting a view stages it; Apply changes the canvas without changing simulation state; Default stages the ordinary city view; Apply after Default removes the overlay; the checkmark applies and closes.
15. Opening/closing View Data, switching or repeatedly applying views, querying, rotating, and zooming preserve tick, date, treasury, RNG, arrays, command log, and canonical hash.
16. Save/restore, browser autosave/reload, worker restore, portable export/import, and replay across source changes and monthly boundaries reproduce all three arrays, water appearance, pump output, building outcomes, finance, and canonical hash exactly.

## Red-first automated test plan

Create these tests red before production implementation; do not weaken an assertion to match a convenient provisional implementation.

1. **Field shape and founding:** assert exact lengths, integer domains, neutral values, condition tick, canonical-hash participation, and no founding-time side effects.
2. **Coal anchor accounting:** place plants at center/edge, compare distance bands, and prove one emission per anchor rather than per 4x4 footprint tile.
3. **Industrial occupancy:** compare unzoned, empty-zoned, and occupied Industrial clones at each density; only occupied activity may emit.
4. **Usage-backed traffic:** compare unused road/highway networks with identical networks carrying known deterministic routes; assert only traversed usage emits and prove monotonic usage response.
5. **Tree mitigation property:** vary tree count/location around fixed sources; assert monotonic non-increase, bounded zero, stable overlap, and restoration after removal.
6. **Air superposition:** permute command/source placement order and assert the same settled field, with centralized falloff and clamp boundary fixtures.
7. **Water eligibility/spread:** compare near/far/disconnected surface-water tiles, assert non-water zero, source locality, severe-threshold classification, and no Air/Water field aliasing.
8. **Pump efficiency:** clone clean and polluted intakes with identical powered pipes and demand; assert effective capacity, allocation order, watered coverage, and Query values without nominal-capacity mutation.
9. **Land-value factors:** independently toggle power, water, access, air, and water pollution in controlled valid worlds; assert documented monotonic direction and no excluded-factor contribution.
10. **Growth and redevelopment:** compare identical low/high-value Light/Medium/Dense zones across the provisional band thresholds; prove maximum-density gating, deterministic building choice, bounded redevelopment, and no read-time changes.
11. **Finance integration:** use occupied R/C/I fixtures with controlled local values; independently recompute average taxable land value, projection, category income, rounding, and settled treasury.
12. **Ordering/batch equivalence:** combine occupancy, traffic, trees, polluted intake, growth, and finance; compare N single-month advances with one N-month request byte-for-byte.
13. **Query/map consistency:** for representative tiles, compare canonical arrays, Query text/value, legend bucket/color, renderer overlay, pump efficiency, and growth/tax consumers.
14. **Display purity:** snapshot/hash before and after every View Data selection, Apply, Default, close, Query, rotate, and zoom sequence; assert no simulation mutation and only one overlay.
15. **Migration:** migrate the prior schema from empty, developed, transport-heavy, financed, coal, pump, and tree cities; assert fields are deterministically derived without altering prior terrain/network/building/facility/calendar/RNG/command values. The pre-environment annual projection is the sole finance carve-out: refresh it from the new canonical Land Value field while preserving treasury, journal, rates, budgets, loans, and settled history.
16. **Hostile restore:** reject missing/extra fields, wrong lengths, floats, negatives, overflow, nonzero Water Pollution on non-water, impossible neutral Land Value, stale/future condition ticks, finance projections inconsistent with accepted canonical conditions, and physically forged arrays whenever command/tick provenance makes source-backed rederivation unambiguous.
17. **Replay/save:** replay commands that add/remove trees, coal, industry, roads/highways, and pumps across multiple months; compare worker/main-thread, pre/post-save, portable import, and fresh-browser autosave hashes.
18. **Renderer isolation:** assert the render model consumes numeric fields and classifications but contains no emission, spread, mitigation, pump, land-value, growth, or tax coefficient.

## Renderer, Review, and accessibility gates

- Ordinary city rendering keeps existing original project art. Air and Water overlays use clearly distinguishable red-family scales; Land Value uses a blue-family scale. Zero/neutral areas remain readable rather than covering the city with an opaque wash.
- Severe polluted surface water is visibly brown in the ordinary city view as well as clearly classified in Water Pollution view. Rotation and every supported zoom preserve the same world-tile classification without seams or coordinate drift.
- Review exposes View Data and exactly the three available slice maps. Each selection has a title, plain-language low/high direction, numeric/ranged legend, selected state, Apply, Default, and apply-and-close/checkmark action.
- A sighted player can distinguish values without color alone through legend labels, Query numbers, and accessible names. The fixed overlay opacity and text contrast remain readable at ordinary and compact viewports; an adjustable opacity control is not part of this bounded slice.
- The View Data dialog receives initial focus, traps Tab/Shift+Tab, closes through Escape using the same safe apply/close policy, restores focus to its opener, and supports keyboard selection/application. No control depends on hover alone.
- Query remains operable with an overlay active and reports world coordinates, tile/object identity, Land Value, Air Pollution, Water Pollution where applicable, source/mitigation context, and pump efficiency. It never reports excluded garbage/radiation/health values.
- View state may be UI-local, but every displayed number and classification must be traceable to the current immutable simulation snapshot. There is no renderer-side smoothing that changes legend buckets or Query truth.

## Persistence and adversarial gates

- Advance the versioned snapshot schema once and validate all three fields strictly before constructing a world. Canonical serialization order, integer representation, and hashing are stable and documented.
- Migration from the previous schema derives all three fields with the same pure condition functions used at founding/current-state refresh, records the current settled tick, and does not run a month or append a command/cash event.
- Restore must reject rather than silently clamp, resize, drop, or regenerate hostile current-schema data. Validation covers dimensions, domains, water-terrain invariants, neutral non-developable values, settled tick, source-backed recomputation, and cross-field consistency.
- An invalid snapshot or command leaves the existing browser slot/world untouched. Corrupt one-save data cannot delete or overwrite other local saves.
- Conditions participate in authoritative snapshots and hashes. Replay never accepts a command that directly sets a pollution or land-value cell; only ordinary terrain, facility, zone, transport, time, and later system commands can alter inputs.
- Worker messages carry the three fields without transfer-order races or detached-buffer reuse. A restored worker must publish the same first snapshot as the main-thread validator before accepting new commands.
- Read surfaces are pure: no autosave, view-open, Query, renderer frame, tooltip, or projection calculation may "repair" or mutate the fields.

## Production-browser acceptance proof

Run the complete automated suite, build the production bundle, and serve that bundle on localhost. Perform the final pass in both production Chromium and the actual Codex in-app Browser, not solely against the Vite development server.

1. Clear only the localhost origin's storage. Start a deterministic Miniature city with trees available, accept terrain, and pause. Open Review -> View Data; confirm only Land Value, Air Pollution, and Water Pollution are offered for this slice, with readable legends and Apply/Default/checkmark controls.
2. Select Air Pollution and Apply. Confirm a clean/near-zero baseline, then build one coal plant, advance exactly one month, pause, and verify a localized red overlay plus matching coal Query value/context. The 4x4 footprint must show one coherent source rather than sixteen independent peaks.
3. Zone an Industrial control area but leave it empty and confirm no industrial emission. Supply power/water/access, allow occupancy, advance one month, and verify localized Air and nearby Water Pollution changes from occupied buildings only.
4. Build two equivalent road/highway branches but route trips through only one. Advance one month and verify only the used branch receives traffic-backed Air Pollution. Query usage and pollution on both branches and compare with the map legend.
5. Add trees inside one polluted area, advance one month, and verify a weak local reduction against a saved no-tree control. Demolish the trees, advance again, and verify deterministic recovery without negative or flickering values.
6. Select Water Pollution, Apply, and verify affected surface water reaches the documented red legend buckets. Raise the controlled source to the severe threshold and confirm the same tiles appear brown in ordinary view.
7. Place otherwise-identical clean-water and polluted-water fresh pumps with powered, connected pipes and controlled demand. Advance one month and verify lower polluted-pump efficiency in Query and the expected deterministic watered-capacity difference, with pipe geometry unchanged.
8. Select Land Value, Apply, and query comparable powered/watered/accessible clean and polluted sites. Confirm greater blue intensity and higher numeric value at the clean site. Toggle Default then Apply; confirm the ordinary view returns without changing tick/hash.
9. Develop controlled R/C/I zones across low/high local values. Advance the documented bounded months and verify high-value locations can reach better/higher-density outcomes while Dense zoning at low value does not force the maximum. Confirm changed values can trigger only the documented monthly redevelopment path.
10. Open Budget before and after a controlled occupied-tile land-value change. Confirm unchanged tax rates, matching sector population, changed average taxable land value/category projection, and a settled next-month tax amount that reconciles with the same field.
11. With an overlay active, rotate and zoom through every supported camera state, query source/edge/water/developed tiles, and inspect ordinary plus compact viewports. Require stable tile alignment, readable non-color cues, no clipped dialog/legend, correct focus trap/restoration, and no console error or warning.
12. Save/autosave, reload, Continue, and recheck arrays through representative Query/map values, brown-water classification, pump efficiency, building outcome, finance projection, date, and hash. Advance one more month and compare with an unsaved no-reload control.
13. Run hostile current-schema restore cases in automation, then finish with the full production Chromium suite and one hands-on Codex in-app Browser walkthrough. Capture screenshots of all three maps, severe brown water, Query consistency, and the compact View Data dialog.

## Completion gates

- [ ] The three canonical fields, schema migration, deterministic update ordering, pump/finance/growth integrations, and strict restore rules satisfy every acceptance item above.
- [ ] Red-first unit/property tests cover source accounting, actual traffic use, trees, water/pump effects, land value, growth, tax, ordering, migration, replay, and hostile restore.
- [ ] Renderer, Query, and View Data implement three consistent maps with legends, Apply/Default/checkmark, keyboard/focus behavior, rotation/zoom stability, and no display-time simulation mutation.
- [ ] The full TypeScript, unit/property, ledger, production build, and production Chromium suites pass after implementation.
- [ ] A hands-on Codex in-app Browser run completes the production-browser flow against the built localhost bundle with screenshots, clean console, save/reload parity, and an unsaved control hash.
- [ ] The ledger's touched Land Value, Pollution, Data Maps, Query consistency, and building-density/land-value rows advance no farther than their evidence supports; garbage, radiation, health, parks, and other excluded rows remain unchanged.
- [ ] Every provisional coefficient and oracle gap is centralized/documented, and none is represented as exact SimCity 3000 Unlimited parity.

## Original-game oracle follow-up

When the licensed original copy is available, record isolated fixtures rather than relying on memory:

1. Measure clean baseline and distance falloff for one coal plant at several loads/ages.
2. Compare empty Industrial zoning with occupied Light/Medium/Dense and old/heavy versus clean/high-tech buildings.
3. Measure road/highway pollution against exact traffic density, congestion, transit substitution, and funding condition.
4. Place/remove trees and parks at controlled distances and measure mitigation timing, radius, stacking, and floor.
5. Measure water-pollution spread across shorelines, separate water bodies, and distance from industry; capture the exact brown threshold.
6. Measure fresh-water pump output at controlled water-pollution levels and determine which water tiles each pump samples.
7. Isolate land-value factors for access, power, water, air/water pollution, crime, services, NIMBYs, elevation, and waterfronts; record ranges and neighborhood falloff.
8. Hold demand constant while varying Land Value and zoned density; record development bands, replacement timing, abandonment, and hysteresis.
9. Compare Query numbers with Data Map legend buckets/palettes and exact Apply, Default, close, opacity, and save/reload view behavior.
10. Reconcile sector tax revenue against controlled occupied-tile land values to identify averaging, constants, timing, and rounding.
