# Finance, Budget, and Loans vertical slice

## Intent and source boundary

This slice replaces the starter simulation's opaque monthly treasury adjustment with the first player-governed municipal finance loop. It connects construction, developed Residential/Commercial/Industrial sectors, the completed transportation foundation, the New City Auto Budget choice, and the running-city information bar to one deterministic and auditable budget model.

The governing source is the archived SimCity 3000 Unlimited manual whose SHA-256 is `39219465579d48310a661c720e19d0175c56b934abf26125a671a18d16cdf556`. Page numbers below are the manual's printed page labels, not PDF leaf numbers.

This slice includes:

- continuously visible treasury and categorized cash flow;
- independently adjustable Residential, Commercial, and Industrial tax rates;
- the six manual-listed department budgets;
- annual projection and Auto Budget review behavior;
- exact manual loan limits and repayment shape;
- roads and mass-transit funding effects on the transportation system;
- strict save, migration, replay, and browser-local autosave behavior for all finance state.

It deliberately excludes ordinances, business deals, neighbor utility/garbage deals, disaster relief, civic-building catalogs, police/fire/health/education service simulation, land-value parity, and advisor/petitioner content. Those systems may later consume the finance interfaces, but they must not be represented as implemented by this slice. The stable ledger id `finance-policy.loans-and-bonds` is retained for compatibility, but the manual-backed feature and player-facing title are **Loans**; page 91 does not specify a separate bond system.

## Manual-grounded contracts

1. The information bar continuously exposes current funds alongside city name, population, date, RCI demand, and simulation controls (page 38). Finance events may use the ticker, but a complete advisor/news system remains later work.
2. The Budget window is available through Adjust & Review at any time (pages 20 and 65). It has separate Expenditures and Income faces and closes through an explicit confirmation/checkmark action (pages 20–21 and 89–90).
3. The Expenditures face shows six department budgets: Police, Fire, Roads, Mass Transit, Healthcare, and Education. Each has a player-controlled allocation and an advisor-recommended optimum marker. Optimum needs may change as the city changes; over-funding wastes money, while under-funding reduces effectiveness and may eventually cause strikes (pages 20 and 88–89).
4. The Roads budget maintains roads, highways, bridges, and tunnels. Inadequate maintenance causes deterioration, route avoidance, difficult commutes, and possible population loss (page 96).
5. The Mass Transit budget maintains rail and subway track and stations, bus stops, and transit labor. Low funding causes deterioration and lowers use; sufficiently severe under-funding can cause a transit strike (pages 89 and 96–97).
6. The Income face exposes separate Residential, Commercial, and Industrial tax rates. Lowering a sector's tax rate tends to increase that sector's demand, while raising it tends to decrease demand. Revenue follows the manual's stated relationship: tax rate multiplied by the sector population, average land value, and a constant (pages 21 and 88). City conditions still influence demand, so tax is an input rather than a complete demand model.
7. The Budget window reports projected end-of-year funds and visually distinguishes a projected gain from a projected loss (pages 20–21 and 90).
8. When Auto Budget is enabled at city creation, the financial advisor preserves the status quo for every budget item. At year-end the Budget window appears automatically only when available funds are negative (page 29). The creation option and resulting behavior are save-stable.
9. With no available cash, new construction and zoning are unavailable, including cancellation of a construction project that becomes unaffordable. Existing operating expenses continue to be paid and may push the treasury farther into debt (page 87). Rejected construction remains transactional.
10. A loan can be taken for any reason and at any time while fewer than ten loans are active. Principal is selected in 5,000-Simoleon increments through 25,000; proceeds enter the treasury immediately (page 91).
11. Every loan lasts ten years, cannot be repaid early, requires one annual payment for each of the ten years, is removed after the tenth payment, and costs exactly 150% of original principal in total payments (page 91).
12. Construction costs, monthly income/expenses, loan disbursements, and annual loan payments reconcile to the displayed treasury. Query/review surfaces never invent a second balance or report projections as settled cash.

## Exact manual rules versus provisional rules

### Exact manual rules

- Three independent tax sectors and the direction of each rate's demand effect.
- Six named department budgets and the distinction between allocation and changing optimum need.
- Under-funding reduces effectiveness; over-funding wastes money; severe or prolonged under-funding can lead to strikes.
- The assets and labor covered by Roads and Mass Transit budgets, plus their stated deterioration/use consequences.
- Auto Budget preserves status quo and suppresses the automatic year-end window unless actual funds are negative.
- Lack of cash blocks new construction/zoning while operating expenses may continue into debt.
- Loan count, principal increment and ceiling, term, lack of early payoff, annual-payment count, and total repayment.
- Expenditures/Income faces, recommended markers, end-of-year projection, and continuously visible funds.

### Explicitly provisional until licensed-original measurement

- Default tax rates, legal rate range, control step, displayed precision, and the tax constant.
- Sector-population accounting for Commercial and Industrial development, because the current building layer stores deterministic occupancy/activity rather than measured SC3KU sector population.
- Average land value used by taxation until the later land-value slice supplies an independently simulated value.
- Whether tax receipts settle monthly or at another cadence, category rounding order, and the exact fiscal-year boundary ordering.
- Recommended annual cost curves for all departments and the maximum over-funding range.
- Roads/transit condition scale, decay and repair rates, route-avoidance response, under-funding duration, strike threshold, strike recovery, and associated population response.
- Whether an automatically opened year-end Budget window pauses simulation and whether Auto Budget disabled means an unconditional annual window. The manual strongly implies the latter but does not state both UI details directly.
- Projection horizon details and how mid-year changes are prorated.
- Exact original Budget-window layout, colors, wording, slider geometry, currency name, and advisor portrait/content. The implementation uses original project branding and art.

Every provisional coefficient must be centralized, integer/rational where practical, deterministic, named as provisional, and changeable without rewriting historical command semantics. No provisional result may be labeled `parity_verified`.

## Canonical finance state and ordering

Finance must be authoritative simulation state, not UI-only state. A save-stable representation must cover:

- R/C/I tax rates;
- six department allocation percentages;
- recommended and allocated annual amounts;
- department effectiveness, consecutive under-funded months, condition, and strike status where applicable;
- active loans with stable ids, principal, issue year, annual payment, payments made, and payments remaining;
- current projection and whether annual review is due;
- categorized, chronological cash events sufficient to reconcile every treasury mutation.

Player changes use ordinary strictly validated commands. Invalid rates, funding, loan amounts, caps, timing, duplicate ids, malformed payloads, stale sequences, or unaffordable construction must leave treasury, finance state, command log, RNG, and canonical hash unchanged.

The deterministic whole-month order is:

1. update the calendar for the boundary being crossed;
2. derive current sector population/activity and department optimum requirements;
3. derive department effectiveness/condition from the settled allocation and prior condition;
4. refresh utilities and transportation using the resulting service effectiveness;
5. calculate RCI demand, including tax and transport-service effects;
6. apply growth/decline;
7. calculate categorized tax income and operating expenses;
8. at the selected annual boundary, settle each due loan payment and update annual-review state;
9. append one ordered settlement record and update treasury and projection.

Advancing many months in one request must equal advancing one month at a time. UI reads, opening/closing Budget, and viewing a projection never settle money or advance under-funding duration.

## Deterministic acceptance matrix

1. Founding defaults create one complete, valid finance state and preserve the selected Auto Budget value.
2. Each tax sector can be changed independently; a command affecting one sector changes no other rate.
3. In controlled otherwise-identical worlds, lowering one rate weakly increases that sector's demand and raising it weakly decreases demand after the next monthly calculation.
4. Tax revenue uses only settled state for that month and has a stable category breakdown. Projection changes immediately after a rate edit without changing current cash.
5. All six allocations accept only the centralized valid range and update their allocated/recommended display without charging money immediately.
6. A zero-need department has zero recommended expense. A later civic slice may make its service effective, but this slice does not charge or simulate nonexistent civic infrastructure merely because its slider is visible.
7. Adequately funded Roads/Mass Transit preserve service condition. Controlled under-funding saves operating expense and deterministically reduces condition/effectiveness; restored funding deterministically repairs it.
8. Low Mass Transit funding reduces otherwise-identical monthly ridership. Sustained severe under-funding reaches a strike with zero or explicitly reduced service, and adequate funding provides a deterministic recovery path.
9. Road under-funding affects roads, highways, bridges, and tunnels but never utility networks or rail/subway state. Mass Transit under-funding affects bus/rail/subway service but never road geometry.
10. Query, traffic/ridership view, and Budget report the same funding, condition, strike, and usage results for one snapshot.
11. Operating settlements continue when treasury is zero or negative; new positive-cost construction/zoning rejects atomically while free review/speed commands remain available.
12. Valid loan principals are exactly 5,000, 10,000, 15,000, 20,000, and 25,000. Any other amount rejects without mutation.
13. A valid loan immediately credits principal. A tenth active loan is accepted; an eleventh rejects. Loans cannot be paid early because no early-payoff command exists.
14. Each loan produces exactly ten equal annual payments totaling exactly 150% of principal and is removed only after payment ten. Multiple loans settle in stable id/issue order.
15. Crossing December to January produces exactly one annual settlement/review decision even when a request advances several years or starts/ends exactly on the boundary.
16. With Auto Budget enabled, current allocations remain unchanged and annual review becomes due only when actual post-settlement funds are negative. The non-Auto behavior remains explicitly provisional until original observation.
17. End-of-year projection is a pure calculation: opening Budget or changing tabs cannot alter treasury, RNG, calendar, loans, service condition, or command history.
18. Every treasury mutation is represented exactly once in the cash journal; the founding balance plus all signed journal amounts equals current treasury.
19. Schema migration supplies deterministic finance defaults without altering any schema-3 terrain, zone, building, utility, transport, command, calendar, RNG, or treasury bytes/values.
20. Save/restore, autosave/reload, worker restore, and replay across tax changes, funding changes, loans, monthly settlements, and annual boundaries reproduce finance state, world layers, and canonical hash exactly.

## Red-first automated test plan

Create the following tests red before production implementation; do not weaken an assertion to match a provisional implementation after the fact.

1. **Founding and validation:** assert exact default finance shape, Auto Budget retention, strict keys, bounded integer/rational values, and transactional rejection for every malformed finance command.
2. **Tax independence:** change every sector across representative rates and assert only the selected rate and projection change immediately.
3. **Tax monotonicity:** clone a developed controlled city into low/baseline/high tax worlds and compare next-month demand and categorized revenue for only the selected sector.
4. **Tax equation:** use controlled sector activity and provisional land value to verify the documented multiplication and rounding order.
5. **Budget optimum:** build representative road, highway, bridge, tunnel, bus, rail, and subway assets and assert only the applicable Roads/Mass Transit recommendation changes.
6. **Funding savings/effectiveness:** compare 100%, under-funded, and over-funded clones for expense, effectiveness, condition, and projection without geometry changes.
7. **Condition and repair:** run bounded under-funding and restored-funding months and assert deterministic deterioration, route use, repair, and no hidden read-time mutation.
8. **Transit strike:** prove the configured consecutive-month threshold, service loss, ticker/event state, recovery, and no strike in a sufficiently funded control.
9. **Debt while operating:** settle a negative-balance month, then assert paid operating entries, negative treasury, rejected construction, and unchanged hash after that rejection.
10. **Loan amount property:** exhaust integer amounts around every valid increment, assert only the five manual values succeed, and assert immediate principal credit.
11. **Loan cap and lifecycle:** issue ten loans, reject eleven, run ten annual boundaries, assert exact payment count/total/removal, and compare batched with single-boundary advancement.
12. **Annual Auto Budget matrix:** cross year-end with Auto Budget on/off and positive/zero/negative actual funds; assert the exact implemented/manual distinction and retained allocations.
13. **Cash reconciliation:** combine construction, demolition, twelve monthly settlements, multiple loans, and annual payments; independently sum signed events to current treasury.
14. **Projection purity:** inspect/switch/close Budget repeatedly and assert snapshot/hash equality; change a rate/allocation and assert only canonical command effects.
15. **Migration and hostile restore:** migrate schema 3, then reject bad journal arithmetic, duplicate loan ids, impossible payment counts, invalid rates/funding, future issue years, and inconsistent review state.
16. **Replay/save:** replay a command timeline across several month/year boundaries and compare finance/world/hash before and after portable save plus browser-local restore.
17. **Information-bar consistency:** in production Chromium, compare funds/date/population/demand/speed against the same authoritative snapshot before and after a settlement.

## Production-browser acceptance proof

Run the complete automated suite, build the production bundle, and serve that bundle on localhost. Perform the final pass in both five-worker Chromium and the actual Codex in-app Browser, never solely against the Vite development server.

1. Clear only the localhost origin's storage. Start a Miniature city with Auto Budget disabled and a deterministic seed; accept terrain and confirm the continuously visible city, population, funds, date, RCI demand, ticker, and pause/speed controls.
2. Open Review, choose Budget, and confirm Expenditures and Income faces, six department controls, advisor optimum markers, three tax controls, current funds, categorized totals, projection, Loans entry, and explicit close/checkmark.
3. Change only Residential tax. Confirm current funds do not move, the projection changes, the other tax rates remain byte-for-byte/display-identical, and one finance command is recorded.
4. Advance exactly one month, pause, and confirm the funds delta equals the visible categorized settlement. Confirm Residential demand reflects the tax input while Commercial/Industrial rates remain unchanged.
5. Build a road/highway/bridge/tunnel and a used bus/rail/subway network. Reopen Budget and confirm only Roads and Mass Transit recommendations respond to these assets.
6. Under-fund Roads and Mass Transit, advance the documented bounded month count, then pause. Query representative assets and inspect the traffic/ridership view: condition/effectiveness and use must match Budget, while geometry remains intact.
7. Continue severe transit under-funding to the provisional strike threshold. Confirm a visible warning, strike state, and suppressed service. Restore adequate funding and prove the documented recovery path.
8. Issue a 5,000 loan. Confirm immediate funds increase of exactly 5,000, one active-loan row, ten years remaining, a 750 annual payment, and a projection that includes the payment. Invalid principal and eleventh-loan paths must be covered in automation rather than requiring repetitive manual entry.
9. Cross one year-end with Auto Budget disabled and record the review behavior. In a separate Auto Budget city, cross year-end once with non-negative funds and once with negative post-settlement funds; confirm allocations persist and automatic Budget visibility follows page 29.
10. Force treasury below zero through settled operating costs. Confirm review and speed controls remain usable, a positive-cost construction preview says funds are insufficient, release changes nothing, and the next operating settlement still occurs.
11. Save/autosave, reload, continue the city, and recheck funds, rates, budgets, optimums, conditions, strike state, loans, journal, projection, Auto Budget review state, date, and usage. Advance one more month and compare the canonical hash with a no-reload control.
12. Rotate, zoom, open/close both Budget faces, and inspect the browser console. Capture screenshots at ordinary and compact viewport sizes; require no clipped controls, unreadable projection, uncaught error, warning, or accessibility failure.

## Completion gates

- [x] The finance protocol, schema migration, simulation ordering, transactional commands, and player-facing Budget window satisfy every deterministic acceptance item above.
- [x] Red-first unit/property tests cover taxes, budgets, service condition/strikes, debt, loans, annual behavior, reconciliation, hostile restore, replay, and save stability.
- [x] The full TypeScript, unit/property, ledger, production build, and five-worker Chromium suites pass after implementation.
- [ ] A hands-on Codex in-app-browser run completes the exact production-browser flow, including a real used transport network, annual transition, negative-balance construction rejection, save/reload, responsive visual inspection, and clean console.
- [x] The ledger advances `transport.transport-funding`, `finance-policy.treasury-cashflow`, `finance-policy.tax-rates`, `finance-policy.department-budgets`, `finance-policy.annual-budget-cycle`, `finance-policy.loans-and-bonds`, `opening.auto-budget`, and `ui.information-bar` to `in_progress`; excluded finance rows remain `not_started`.
- [x] Provisional constants and behaviors remain visibly documented and centralized; no row advances to `parity_verified` without controlled licensed-original comparisons.

Passing the engineering gates earns the label **manual-grounded finance and budget core in progress**. It does not establish exact SimCity 3000 Unlimited economy parity.
