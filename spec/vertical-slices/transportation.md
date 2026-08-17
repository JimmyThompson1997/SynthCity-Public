# Transportation vertical slice

## Intent and source boundary

This slice replaces the starter road-radius approximation with the first complete public/private transportation loop. The governing manual material is PDF pages 12, 48–50, and 93–97. It covers roads and visible traffic, highways and ramps, bus stops, rail and train stations, subway rail and stations, subway-to-rail transfers, bridges, tunnels, query feedback, dated availability, and transport-supported growth.

This remains a manual-grounded engineering milestone, not a claim of measured original-game parity. The manual supplies several exact interaction rules but not prices, footprints, route-choice coefficients, capacities, walking distance, construction slope thresholds, or ridership curves. Those values stay explicitly provisional until the licensed original is available.

## Manual contracts

1. Route tools draw deterministic straight or diagonal lines with one blue/red Drop Shadow and one atomic release transaction. `Shift` before release cancels without changing state (pages 12, 48, 94).
2. Roads remain two-lane baseline transport. At close zoom, traffic is visibly animated without simulating individual residents (pages 94–95).
3. Highways unlock in 1940, are elevated high-capacity routes, may cross over roads, and do not exchange traffic with roads or another highway branch unless a valid ramp is placed at the corner of the intersection (pages 49, 94–95).
4. Bus stops unlock in 1920. A stop may be placed away from a road, but it is effective only beside a road and when another reachable stop and nearby trip demand exist. Riders may leave a bus anywhere, so the station-pair model is a deliberate conservative approximation (pages 49, 96).
5. Rail is a surface line network. Track alone has zero passenger service; an effective train station must touch rail, and useful service requires reachable demand and another station/transfer on the same component (pages 49, 96).
6. Subway rail and subway stations unlock in 1912. Selecting Lay Subway Rail enters the underground subway view. Subway stations are visible above and below ground and work next to or directly above subway rail (pages 50, 96).
7. A subway-to-rail connection transfers passengers only when it is adjacent to surface rail and next to or directly above subway rail. Query must distinguish geometrically placed from effective (pages 50, 96).
8. Roads, highways, and rail may cross a contiguous body of water only as one straight land-to-land bridge proposal. The preview becomes valid when the far bank is reached; committing opens an engineer cost confirmation before state or funds change (pages 48, 95).
9. Roads, highways, and rail crossing a sufficiently steep ridge may become one engineer-proposed tunnel. The manual gives a minimum of six underground tiles in the reference section; the implementation must require at least six contiguous tunnel cells and explicit confirmation (page 48; page 95 omits the number).
10. Invalid, cancelled, declined, insufficient-funds, locked-year, or malformed construction is transactional: treasury, map layers, usage, sequence, command log, RNG, and hash remain unchanged.
11. Query reports network topology, bridge/tunnel state, station effectiveness, monthly use, and provisional access truth. It never labels track/stations “working” from placement alone.
12. Monthly transport recomputation occurs before zone growth. Roads, effective station networks, and ramp-connected highways can provide access; isolated rail/subway/highway cannot.

## Explicit provisional rules

- Track, structure, bridge, and tunnel prices are centralized deterministic placeholders pending original-game measurement.
- Train stations, subway stations, transfer stations, bus stops, and ramps use one-tile footprints until the original catalog is measured.
- Ordinary surface routes reject adjacent elevation changes greater than three. A straight ridge with at least six cells four or more levels above both endpoints is tunnel-eligible.
- Bridge endpoints must be dry, stable land with no more than two elevation levels of difference; all water between the first and last water tile must be contiguous.
- Effective passenger service uses orthogonally connected components. A line needs at least two compatible effective access structures, or one access structure plus an effective rail/subway transfer.
- Local walking reach, component usage allocation, road traffic, and highway capacity are deterministic macro coefficients. They are visible and testable but remain blocked from `parity_verified`.
- Transport funding degradation, strikes, congestion penalties, pollution, neighbor contracts, and original bridge/tunnel style selection remain later finance/conditions/oracle work.

## Deterministic acceptance matrix

1. Highway and ramp unlocks reject in 1939 and accept in 1940.
2. Bus and subway unlocks reject before 1920/1912 respectively; rail remains available at the baseline start year.
3. Road/highway and highway/highway intersections share geometry but have no interchange use until a corner-adjacent ramp exists.
4. Bus stops may be placed away from roads but report zero use there. Two stops on one road component gain deterministic monthly use; an isolated stop stays at zero.
5. Train/subway track alone and a single station stay at zero. Two effective stations on one component gain use; a broken component loses it at the next month.
6. Subway stations placed directly above or cardinally beside subway rail work in either layer and render in both.
7. A transfer must satisfy both surface-rail and subway adjacency; removing either side makes it ineffective next month.
8. A valid bridge/tunnel without matching engineer approval rejects with no mutation. Matching approval charges the complete project once and marks every special cell save-stably.
9. Bent, shoreless, unstable, too-short, mixed, and wrong-network special projects reject atomically.
10. Demolition clears structures or route cells coherently, preserves unrelated underground systems, and recomputes station use/access monthly.
11. Snapshot, schema migration, portable/local save, worker restore, replay, rotation, and autosave/reload preserve all transport layers exactly.
12. Production Chromium proves dated menu state, line previews, ramp/station validity, subway layer switching, station visibility, engineer accept/decline, Inspect truth, moving traffic, and reload.

## Completion gates

- [x] Every manual contract above has authoritative unit/property coverage where applicable.
- [x] Schema-2 cities migrate integrity-first: road/rail bits move to exact transport grades, power/pipe and existing facilities stay at the same coordinates, and newly introduced access/usage grids start at zero.
- [x] Full TypeScript, unit/property, production build, and five-worker Chromium suites pass.
- [x] A hands-on production localhost run completes a multimodal trip network, bridge, tunnel, query, rotate, save, reload, and clean-console pass.
- [x] Relevant parity-ledger rows advance only to `in_progress`; no original-measured claim is made without the licensed game.

The 2026-07-18 Codex in-app-browser audits completed dated tools, bus and subway placement, subway automatic layer entry, layer-preserving Query, above-track station Query, bridge incomplete preview, engineer decline/approval, a six-cell tunnel proposal, grade-specific Query, rotate, traffic view, and a developed complementary-demand trip. The final live city reported 24 monthly riders on surface rail, 24 through a connected subway-to-rail transfer, and 24 at the subway station. Pause remained stable at tick 2380; autosave/reload restored $35,441, 8/1956, tick 2380, and the same 24-rider transfer truth. Browser warning/error logs were empty.

The post-audit hardening pass then removed undeveloped-zone trips, allocated every mode only to deterministic traversed paths, preserved unramped highway grade separation, made rail-to-subway-to-rail journeys account for both connectors, allowed same-mode crossings and endpoint extensions while billing only new cells, and exposed neutral close-zoom traffic in normal view. The complete production Chromium suite passed 32/32 after asserting the eight newly billed tiles and exact $4,800 cost of a perpendicular highway crossing. A second Codex in-app-browser production run confirmed Review → Inspect retained Traffic & Ridership view, pause held at tick 8, and reload/Continue restored Transport Edge Proof with $49,400, 1/1950, and tick 8 exactly.

Until these engineering gates and later original comparisons pass, the truthful label is **manual-grounded transportation in progress**, never “SimCity 3000 transportation parity complete.”
