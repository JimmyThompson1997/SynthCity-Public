# SynthCity Gameplay Principles

This document describes the `claude-market-2.16.0` gameplay authority. Earlier
simulators and saves are intentionally unsupported.

## Legibility before breadth

- The player should be able to connect each visible result to a small number of
  inspectable causes.
- RCI bars report market gaps; they do not secretly force development.
- Spatial constraints should be visible on the map: dry land, road reach,
  conductive power, pollution, congestion, and fire.
- Add a system only when it creates a distinct decision. Inactive services are
  absent from the playable catalogue rather than simulated weakly.

## Market loop

- A live plant contributes `capacity / 600` to residential demand.
- Residential demand is `0.35C + 0.60I + plant base`; commercial and industrial
  demand each equal residential stock.
- Served lots compete through desirability and density caps. The margin solver
  conserves demand when the best land saturates, so unmet demand flows into the
  next-best eligible land.
- Growth closes 25% of the positive target gap each month. Decline closes 8%;
  unserved development loses 0.05 density per month.
- Wealth moves toward `37,242 × desirability`; fixed 2.5% revenue competes with
  explicit monthly road, line, plant, and fire-station expenses.

## Spatial and environmental loop

- A road serves zones and plants within Manhattan radius three without an
  outside-connection or routed-capacity requirement.
- Zoned tiles, power lines, and plant footprints conduct orthogonally. A single
  intervening road may be bridged only in a straight line.
- Overhead power lines may share one surface tile with an ordinary Road or
  Rail line in either placement order. A Road-and-Rail grade crossing cannot
  also accept a Power Line, so triple surface overlap remains invalid.
- Congestion is nearby zoned density, not routed traffic. Pollution is a
  normalized radius-six field with monthly inertia.
- Local same-sector mass creates height capacity; pollution trims it.
- Fire is deterministic, spatial, and destructive. A merged `1x1`, `1x2`,
  `2x1`, `2x2`, or L-shaped building ignites, burns, suppresses, and collapses
  as one unit. Shared building edges spread fire; roads remain firebreaks.
- A fire station is operational with road service and power; water is not
  required. Its fixed suppression is divided across unique incidents within Manhattan radius 21,
  so simultaneous fires can overwhelm an otherwise covered district.
- Landfill collection remains citywide and allocates by stable tile order, but
  only a cardinally contiguous landfill area with direct Road or Avenue contact
  accepts waste. Stored garbage persists through a disconnected interval;
  reconnecting resumes the same capacity and unmanaged-waste behavior.
- Water facilities require road access, live power, and an attached pipe;
  coastal pumps additionally require shoreline. Component-local supply and
  treatment capacity are allocated deterministically to consumers.
- Passenger rail stations require road, rail, power, and allocated water.
  Operational stations generate deterministic component-local ridership.
- Police stations require road and power. Their local coverage grants one
  storey of height capacity, while citywide funding changes the shared crime
  and dereliction rate that modifies every developed tile's height cap.
- Burning structures are pinned until suppression or collapse. A collapse
  leaves its entire footprint as protected rubble for exactly 50 settled
  months; zoning then returns to ordinary market participation.
- Players cannot erase an active fire or shorten rubble through zoning,
  demolition, networking, terrain, elevation, or tree tools. Mixed selections
  skip protected cells rather than damaging them.

## Visual authority

- Economic cells remain independent even when appearance merges them into a
  larger lot.
- Height, footprint, roof, details, shade, fire treatment, and the single
  commercial spire derive deterministically from canonical state.
- Pausing, saving, reloading, or rotating the camera cannot reroll a building.
- Fire visuals use the frozen plume, flame, char, and progression
  reference. Visual animation freezes while paused and never enters the
  authoritative state hash.
- Fire Coverage reports potential service from operational stations. Fire
  History is a read-only lifetime replay that never pauses or mutates the live
  city.
- Subway construction and its station remain placeable visual infrastructure;
  unlike passenger rail, they do not yet alter demand or the economy.
- The public Asset Library reflects cleared live and archived art only. It does
  not create inactive gameplay commands.

## Proof standard

- Every equation and transition receives RED/GREEN unit or property coverage.
- Deterministic map scenarios cover bootstrap, equilibrium, scarcity, slurp,
  relocation, power failure/recovery, mixed energy, and fire overload.
- The production bundle is exercised through real browser controls, then the
  exact state hash and RCI appearance are checked across save/reload and camera
  rotation.
- A feature branch must pass a Vercel preview and human visual review before
  merge. The merged SHA must pass again on the canonical production URL.

## Four-storey residential facades

Residential doors cover heights one through three; windows begin at height
four. This avoids a blank-wall gap at exactly four storeys. The appearance test
suite locks the complete current roof, detail, orientation, and shade matrix
with project-owned deterministic vectors.
