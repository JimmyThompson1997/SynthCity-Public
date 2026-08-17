# Zoning, Networks, and Starter Utilities Vertical Slice

## Intent and boundary

This slice turns a founded, paused city into the first manual-shaped growth loop: choose any of the nine Residential/Commercial/Industrial density tools, lay zones and transport lines, build one source-backed electric grid and one source-backed water network, then advance whole months and observe deterministic development. The governing manual material is PDF pages 13–18, 45–53, and 97–119.

This is an engineering target, not a claim of original-game parity. Rules stated explicitly by the manual are requirements. Interpretations needed to make those rules executable are labeled **provisional** and remain blocked from `parity_verified` until they are measured in the licensed original.

The slice includes:

- all nine light/medium/dense RCI choices and last-density selection behavior;
- click, drag, cost preview, Shift cancellation, zone-over-zone replacement, and De-Zone;
- road and rail line placement with deterministic connected topology;
- a 4×4 Coal Power Plant, source-connected power lines, and five-tile power transmission;
- a fresh-water pumping station, source-connected underground pipes, seven-tile coverage, and the manual's twelve-tile spacing recommendation;
- monthly utility recomputation and basic power/water/transport-gated development.

It deliberately does not complete the wider power-plant/water catalog, utility aging or capacity crises, transit stations and ridership, bridges/tunnels, traffic simulation, pollution, fire, taxes, abandonment, land value, or final building-art parity.

## Manual-grounded behavior contract

### RCI zoning and replacement

1. Residential, Commercial, and Industrial are restrictions on what the Sims may develop, not direct building-placement tools (pages 13, 45, 47, and 99).
2. Each RCI type exposes Light, Medium, and Dense choices, producing nine distinct tools. The selected type and density are visible in the tool label, cursor/preview, placed zone, and Query result.
3. Opening a type's density submenu and choosing a density updates that type's remembered choice. Clicking that RCI type again without opening the submenu reuses its remembered density (page 100).
4. **Provisional interpretation:** Residential, Commercial, and Industrial each remember their own last density for the current city session, including after another tool is used and the menu is closed. Persistence across a browser reload or a different city is not required until the original is probed.
5. Single-click zones one tile; click-drag zones the deterministic rectangular/line footprint shown by the drop shadow. Preview cost changes with the footprint, a valid release applies one atomic treasury transaction, and holding Shift before release changes neither world state nor funds (pages 45 and 100).
6. Zoning over an already zoned but undeveloped tile replaces its old type and density atomically. No stale zone kind, density, utility, or development state may survive the replacement (page 100).
7. **Conservative rule pending an original probe:** zone-over-zone replacement is accepted only when the existing tile is undeveloped. Re-zoning a developed tile is rejected without mutation rather than silently destroying or reclassifying a building.
8. De-Zone returns an undeveloped zoned tile to unzoned land. It must reject every tile containing an existing building and direct the player to demolish first (page 47). A mixed drag containing an ineligible developed tile is rejected atomically in this slice.

### Road and rail placement and topology

1. Roads and rails place as single tiles or click-drag line networks. The committed path must match the preview exactly and must be deterministic for identical endpoints, camera rotation, and seed (pages 12, 45, 49–50).
2. Every network tile derives a topology value from its connected neighbors: isolated, endpoint, straight, corner, T-junction, or four-way junction. The visible art/orientation and Query result must agree with that value after placement, crossing, extension, demolition, save/load, and replay.
3. Topology is recomputed for the changed cells and their immediate neighbors after every accepted network edit. It is derived state, not a second editable source of truth.
4. Cardinal road/road and rail/rail connections are required. A dragged diagonal is a deterministic sequence of connected cardinal tiles until the licensed original establishes its exact rasterization. Road/rail crossings, bridges, tunnels, highway interactions, and grade-crossing art are outside this slice; unsupported overlaps reject atomically.
5. For starter growth, **provisional transport access** means a zone tile is within Manhattan distance two of a road tile. Rail alone does not grant zone access until stations and transit routing exist. The original's access radius and requirement for a useful connection to other zone types remain oracle work.

### Starter electric grid

1. The Coal Power Plant is the only plant in this slice. Its placement drop shadow and occupied footprint are exactly 4×4 tiles, as shown by the manual tutorial (page 15). The footprint is all-or-nothing: invalid terrain, collision, or insufficient funds rejects the entire placement.
2. A placed Coal Power Plant is an electric source. A power-line component carries electricity only if it is connected to the plant footprint or to another currently powered building/zone; an orphan line never generates power by itself (pages 52, 115–117).
3. Power lines place with the same click/drag transaction and topology guarantees as roads. They may cross ordinary surface water, as the manual permits, but reject terrain that this slice classifies as too mountainous. The exact mountain threshold is provisional.
4. Power is available to a building or zoned tile within five tiles of a powered plant, powered line, powered building, or powered zone. Once powered, buildings and zones may relay power another five tiles; roads are not required for this relay (pages 115–116).
5. **Provisional interpretation:** “within five tiles” uses Manhattan distance `<= 5`. Source-connected power-line components transmit without a length penalty, and then radiate from every line tile using the same metric. The original distance shape and simultaneous relay semantics require measurement.
6. Removing or de-zoning a relay, demolishing the plant, or breaking the source-connected line must make the next monthly propagation recompute the grid from sources; cached power must not survive a broken path.
7. Coal cost, capacity, pollution, aging, invention-date catalog behavior, overload, blackout allocation, and destruction are not parity claims in this slice. Acceptance fixtures may use deliberately ample provisional capacity.

### Starter water network

1. Selecting Water Pipes automatically enters the Water Pipes underground view and leaves the tool selected. That view shows above-ground context, underground facility components, pipes, and coverage: supplied/watered areas are blue; pipes with no supplied source remain unwatered rather than creating water (pages 18, 53, and 119).
2. Pipes place as single tiles or deterministic click-drag lines with the same preview, cancellation, atomic-cost, and topology rules as roads. A pipe component is supplied only when it connects to an active water source.
3. A Fresh-Water Pump is active only when it is powered, has a connected pipe component, and is sufficiently near fresh surface water.
4. **Explicit provisional rule:** a pump is near fresh water when at least one tile of its footprint is within Manhattan distance `<= 2` of a fresh-water tile. A farther pump may be placed, but Query reports zero active supply and its connected pipes remain unwatered.
5. This two-tile rule is not manual parity. Page 53 says a pumping station must be “directly next to” fresh water to pump at full capacity, while page 118 says it must be built “very near” fresh water or it will not work. Direct adjacency, graded capacity, diagonal contact, shoreline classification, and the pump footprint must be measured in the original.
6. Every tile within seven tiles of any tile in a supplied pipe component is watered. Watered tiles do not relay water: a tile farther than seven from a supplied pipe remains unwatered even when it is adjacent to another watered tile (pages 18, 53, and 119).
7. **Provisional interpretation:** “within seven tiles” uses Manhattan distance `<= 7`. The original coverage shape is an oracle gap. Query and underground coloring must prove the exact-seven boundary and exclude exact-eight.
8. Parallel mains no more than twelve tiles apart are the manual's full-coverage recommendation, not a placement restriction (page 119). The UI may show a spacing guide, but it must allow a wider gap and truthfully show the resulting dry area.
9. Pump cost, footprint, finite monthly capacity, pollution loss, aging, and shortages are provisional or deferred. The acceptance fixture may use ample supply, but orphan or inactive-source pipes must never water tiles.

### Monthly propagation and starter growth

1. Placement commands are immediate, but utility source/connectivity/coverage and development are recomputed at deterministic whole-month boundaries. With the city paused, adding or breaking a network changes geometry immediately while the prior utility result remains marked as pending; crossing the next month applies exactly one propagation pass. The manual tutorial describes water appearing “within a few weeks”; a once-per-month cadence is the deliberate slice model, not measured parity.
2. A usable zone requires power, positive demand, and adequate transport access. Water helps all development; Light RCI may begin development without it, while Medium and Dense RCI must have water to develop or sustain development (pages 99 and 115).
3. The three density levels have strictly increasing development capacity. Density changes the upper bound and visible building family, but does not guarantee immediate or maximum development.
4. For this slice, growth is deterministic from canonical state and RNG. Given an identical snapshot and command/tick sequence, utility bits, developed cells, population, treasury, command log, and state hash must match.
5. The monthly order is fixed: derive source-connected power; derive active pumps and source-connected pipes; derive utility coverage; derive transport access and demand; apply growth; update summary/economy. A zone must not grow during a month using utility state that only becomes available after that month's growth step.
6. Light-without-water means “eligible to grow,” not “guaranteed to grow.” Tests control the seed/RNG or run a bounded deterministic fixture. Medium and Dense without water are categorically ineligible.

## Deterministic unit and property-test matrix

These are engineering gates for the slice. Passing them does not move any rule to `parity_verified`.

1. **Nine zone encodings:** for every Cartesian pair of three RCI kinds and three densities, apply a one-tile command; assert a distinct canonical encoding, correct Query description, correct cost, and snapshot/replay equality.
2. **Remembered density state:** choose a different density for each RCI type; interleave road/query/tool cancellation; reopen each RCI tool without its submenu and assert its remembered density. Reload/cross-city behavior is tested only after the oracle decision.
3. **Area transaction property:** generate valid rectangular drags and assert preview cells equal committed cells and cost equals the exact accepted cell set. For insufficient funds, invalid terrain, overlap, duplicate cells, out-of-bounds cells, or Shift cancellation, assert identical pre/post state hash and treasury.
4. **Replacement and De-Zone:** replace every undeveloped kind/density pair with every other pair and assert no stale bits/building state. De-zone undeveloped succeeds; De-Zone and re-zone of developed cells reject atomically, including a mixed eligible/ineligible batch.
5. **Network topology property:** generate connected road and rail shapes for all six topology classes; after additions and removals, compare every derived topology to a fresh full-map recomputation. Rotate the camera and assert canonical connectivity does not change.
6. **Line determinism:** for cardinal and provisional diagonal endpoint pairs, repeat preview/commit across replay and save/restore; assert identical ordered unique cell paths, cost, topology, and hash.
7. **Coal footprint:** exhaustively place a 4×4 plant near every map edge and representative land/water/elevation/network collisions. Only fully in-bounds valid footprints succeed, and one accepted command owns all sixteen tiles.
8. **Power source/connectivity:** an orphan line powers nothing; connecting that same component to the Coal Plant powers it on the next month; breaking one articulation tile removes downstream power on the following month. No geometry mutation occurs merely from propagation.
9. **Power reach/relay:** under the provisional Manhattan metric, sources power distance five and not six. Then add an eligible powered zone at distance five and assert relay out to another five, while a branch outside every relay radius remains unpowered. Compare incremental recomputation to a fresh breadth-first reference implementation.
10. **Pipe source/connectivity:** an orphan pipe and a pipe attached to an unpowered/far pump supply nothing. A powered, within-two pump supplies only its connected component. Connecting and breaking an articulation tile changes coverage on the next month and never changes pipe geometry.
11. **Water radius/no relay:** for straight, bent, looped, and branched pipe components, every tile at provisional Manhattan distance seven is watered, every tile at distance eight is not, and adjacency to a watered non-pipe tile never extends coverage.
12. **Twelve-tile guide:** two supplied parallel mains twelve tiles apart leave no dry tile between them under the provisional metric; a deliberately wider layout is allowed and reports its actual dry gap.
13. **Monthly idempotence/order:** repeated read/query/render operations within a month do not alter utility state. One month boundary produces one recomputation. Advancing `N` months in one call matches `N` single-month advances byte-for-byte.
14. **Growth prerequisites:** in controlled positive-demand fixtures, all RCI densities fail without power or road access; every Light type can grow with power and road but no water; every Medium/Dense type remains empty without water and becomes eligible after supplied pipes arrive. Rail without a station does not satisfy transport access.
15. **Save/replay:** snapshot just before and just after a monthly boundary, restore, and replay placement/breakage/growth commands. Assert the same plant/pump footprints, network topology, utility coverage, building state, treasury, RNG state, and canonical hash.

## Exact production-browser acceptance script

Run this against the production bundle in Chromium, not the Vite development server:

```sh
pnpm test:all
pnpm build
pnpm preview --host 127.0.0.1 --port 4173
```

Then automate and screen-capture this exact flow at `http://127.0.0.1:4173/?acceptance=zoning-utilities-v1`:

1. Clear only this origin's IndexedDB/local storage. Start a new Easy, 1950, Miniature city named `Nine Grids`, mayor `Utility Proof`, seed `3000119`. Regenerate an all-land/dry-center test region, accept it, and assert the founded city is paused in January 1950.
2. Open Zones. Visit all nine RCI density choices. For each, assert an accessible selected label of the form `Light Residential`, `Medium Residential`, through `Dense Industrial`, and assert a visible density-specific preview legend.
3. Set remembered selections to Dense Residential, Medium Commercial, and Light Industrial. Select Road, close/reopen Zones, click each RCI type without opening its density submenu, and assert those three remembered selections return.
4. On nine separated clear patches, place one 2×2 patch with each RCI kind/density combination. Query one cell in every patch and assert exact type, density, `undeveloped`, `unpowered`, `unwatered`, and `no transport access`. Capture the above-ground screenshot.
5. Place Light Residential on one clear tile, then zone Dense Commercial over it before time advances. Assert one atomic cost transaction and a Query result of Dense Commercial with no Residential or building residue. De-Zone it and assert unzoned land.
6. Draw a horizontal road, extend a perpendicular branch, and add/remove one arm so isolated, endpoint, straight, corner, T, and four-way topology states are each visible and queryable. Repeat with rail in a separate area. Assert funds change once per accepted gesture, topology updates neighboring cells, and unsupported road/rail overlap is rejected without mutation. Capture the network screenshot.
7. Open Power Plants, choose Coal, and hover one invalid footprint and one valid footprint. Assert the drop shadow is exactly 4×4, red when invalid and blue when valid. Place the valid plant and assert Query reports one Coal Plant occupying sixteen tiles.
8. Draw a disconnected power line near one isolated Light zone. Advance exactly one month and assert the line and zone remain unpowered. Pause, connect that component to the Coal Plant, advance exactly one month, and assert the component becomes powered.
9. In an isolated probe area, place targets at provisional Manhattan distance five and six from a powered line, arranged so the distance-five target cannot relay to the distance-six target. Advance one month; assert distance five is powered and distance six is not. Add a chain of zones spaced five apart, advance another month, and assert zone relay. Break the line, advance one month, and assert downstream power disappears.
10. Create fresh surface water. Place one pump whose footprint is within provisional Manhattan distance two and one farther away. Power both. Query them and assert the near pump can become active while the far pump reports no active fresh-water supply.
11. Select Water Pipes and assert the city automatically switches to the underground Water Pipes view without losing the selected tool. Draw one orphan pipe and one pipe from the active pump toward the zone probes. Before advancing time, assert both networks are shown as pending/unwatered. Advance exactly one month; assert only the source-connected pipe and its coverage turn blue.
12. Query controlled cells at provisional Manhattan distances seven and eight from the supplied pipe. Assert exact seven is watered, exact eight is not. Assert a tile adjacent to the watered distance-seven tile remains dry when it is farther than seven from every supplied pipe. Lay two parallel mains twelve tiles apart, advance a month, and assert no dry stripe between them.
13. Build equal positive-demand, road-accessible, powered Light/Medium/Dense RCI probes outside water coverage. Run the deterministic fixture for at most twelve months at speed four, then pause. Assert at least the seeded Light probes develop while every Medium/Dense probe remains undeveloped. Extend supplied pipes to all probes, advance the fixture's documented bounded month count, and assert Medium/Dense become eligible and at least the seeded targets develop.
14. Query one developed target and attempt De-Zone. Assert a clear rejection telling the player to demolish first, unchanged funds, unchanged building/zone, and unchanged canonical hash. De-Zone an adjacent undeveloped zone and assert success.
15. Save, reload the page, load the city, and assert plant/pump footprints, zone kinds/densities, road/rail/line/pipe topology, camera layer, treasury, tick/month, utility coverage, and developed targets match the pre-reload snapshot. Continue one month and compare the resulting canonical hash to the no-reload control run.
16. Inspect Chromium console/page errors: there must be zero uncaught exceptions, unhandled rejections, failed local asset requests, React key warnings, or worker errors. Preserve screenshots for the nine-zone overview, network topology, 4×4 Coal preview, above-ground power state, underground water state, and developed-vs-blocked density probes.

The production-browser pass is complete only when every assertion is automated in the browser suite and the same flow has also been exercised once through the Codex in-app browser against that production localhost.

## Licensed-original parity probes for later

Run these as controlled A/B experiments once the original copy is available. Record screenshots/video, dates, treasury deltas, Query text, exact tile coordinates, elapsed simulation time, and repeat results before changing any `requires_oracle` rule.

1. Determine whether last-density memory is global, per RCI type, per city, or persisted across save/load/restart, and record the startup default for each type.
2. Re-zone every kind/density combination in both undeveloped and developed states. Measure cost/refund, whether buildings remain, abandonment/redevelopment behavior, and what a mixed drag does.
3. Measure the road/rail drag rasterizer for all endpoint octants, tie cases, reversals, camera rotations, intersections, crossings, and demolition. Catalog the original topology sprites and orientation transitions.
4. Measure the maximum distance from road/transit that each zone footprint may develop, whether the route must connect to another zone, whether cul-de-sacs work, and how rail stations change access.
5. Probe the Coal Plant's exact 4×4 anchor, date availability, price, capacity, pollution, maintenance, aging, overload, and blackout order.
6. Map power coverage around a point source, line, building, and zone to distinguish Manhattan, Chebyshev, Euclidean, or another metric. Probe whether multi-hop relays settle in one simulation update or spread over time, and how competing plant capacity changes reach.
7. Probe disconnected powered remnants, line-over-water and mountain limits, source/line contact rules, power-grid break timing, and whether geometry updates power immediately or at a weekly/monthly cadence.
8. Place fresh-water pumps at direct cardinal adjacency, diagonal adjacency, and distances one through four from lake, river, placed surface water, polluted water, and coast. Record whether placement is rejected or capacity changes, resolving the pages 53/118 contradiction.
9. Map pipe coverage around points, corners, diagonals, loops, and parallel mains to identify the exact seven-tile metric. Verify the manual's twelve-tile guidance and whether boundary tiles differ visually before/after water arrives.
10. Measure pump footprints, price, power need, pipe connection points, monthly capacity allocation, aging, pollution efficiency, shortage order, and how quickly underground coloring responds.
11. For all nine RCI densities, isolate power, water, road/transit, demand, land value, and elapsed time. Confirm Light-without-water behavior, Medium/Dense water requirements, development timing, capacity, redevelopment, and utility-loss abandonment.
12. Compare utility/growth update cadence by placing or breaking a source immediately before and after month boundaries at every speed, including pause, save/load, and long single-step advances.

## Truthful status checklist

### Existing substrate (useful, but not completion of this slice)

- [x] Canonical commands can already represent three RCI kinds with three density values.
- [x] Canonical network state can already represent road, rail, power-line, and water-pipe tiles.
- [x] The deterministic simulation has transactional commands, monthly boundaries, snapshots, replay, and hashing.
- [x] Production-browser coverage already proves basic click/drag batching, Shift cancellation, pause/speed timing, autosave, and restore.

### Engineering acceptance for this slice

- [x] All nine density choices and truthful last-selection behavior are visible and browser-tested.
- [x] Zone-over-zone replacement works without stale state; developed De-Zone/re-zone rejection is atomic.
- [ ] Road and rail rendering/query state covers every required topology and survives demolition/replay.
- [x] A 4×4 Coal Plant is a real power source; orphan lines never self-power.
- [ ] Source connectivity, five-tile power transmission, relay, and grid-break recomputation pass unit/property/browser tests.
- [ ] A powered, near-fresh-water pump is a real water source; far/unpowered pumps and orphan pipes never self-supply.
- [x] Selecting pipes automatically opens the truthful underground view.
- [ ] Seven-tile pipe coverage, no water relay, and the twelve-tile spacing guide pass unit/property/browser tests.
- [x] Monthly utility ordering and Light-versus-Medium/Dense water prerequisites pass deterministic tests.
- [x] The full production Chromium suite, build, in-app-browser pass, persistence/replay comparison, screenshots, and clean console all pass.

### Milestone evidence — 2026-07-18

- Root acceptance gate: TypeScript, 93 Vitest regressions, production Vite build, and all 26 Playwright/Chromium scenarios passed in the normal five-worker configuration. The fixed scheduler additionally passed 10 parallel stress repetitions at exact `5/10/15/20` tick deltas.
- Persistence and replay: schema-1 saves are verified in their raw form before strict migration to schema 2; incompatible current revisions fall back to a compatible predecessor; accepted terrain recipes, facilities, commands, RNG, and canonical hashes round-trip and replay deterministically.
- Codex in-app browser: founded `Harbor Grid`, placed a sampling-sparse five-tile road, a Medium Residential block, a 4×4 Coal Plant, source-connected power lines, and a six-tile underground pipe. After monthly recomputation, Query reported the district `Powered, Not watered` with provisional road access and correctly left Medium density undeveloped. Reload restored the city at tick 160 / June 1950 with zero browser logs.
- This evidence advances the relevant parity-ledger rows only to `in_progress`. The unchecked engineering items and every licensed-original comparison remain required before this slice can be called parity-complete.

### Near-exact parity acceptance

- [ ] Every provisional rule above has a recorded licensed-original probe or has been replaced by measured behavior.
- [ ] Original UI timing, cursor/drop-shadow semantics, placement rasterization, topology, distances, colors, costs, capacity, and update cadence have comparison evidence.
- [ ] Relevant ledger rows may move to `parity_verified` only after both engineering gates and original-game comparisons pass.

Until both sections are checked, the truthful milestone label is **manual-grounded zoning and starter utilities in progress**, never “SimCity 3000 zoning/utilities parity complete.”
