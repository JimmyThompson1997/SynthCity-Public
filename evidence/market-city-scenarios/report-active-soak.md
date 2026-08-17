# MarketCity deterministic scenario proof

- Result: **PASS**
- Rules: `claude-market-2.16.0`
- Runtime: `v24.19.0` on `darwin-arm64`
- Full active 10,000-month soak: `true`

| Proof | Result | Runtime |
|---|---:|---:|
| map-fixtures | PASS | 235.0 ms |
| no-bootstrap | PASS | 120.4 ms |
| residential-bootstrap | PASS | 109.9 ms |
| c-and-i-first | PASS | 312.2 ms |
| one-coal-equilibrium | PASS | 3246.6 ms |
| land-shortage-and-slurp | PASS | 737.1 ms |
| pollution-relocation | PASS | 839.9 ms |
| plant-comparison | PASS | 186.8 ms |
| power-severance-and-repair | PASS | 185.1 ms |
| seeded-fire-coverage | PASS | 156.2 ms |
| deterministic-checkpoint-hashes | PASS | 18544.8 ms |
| 1200-month-performance | PASS | 9064.2 ms median / 9067.5 ms max (3 samples) |
| 10000-month-active-soak | PASS | 29096.3 ms |
