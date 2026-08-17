# MarketCity deterministic scenario proof

- Result: **PASS**
- Rules: `claude-market-2.16.0`
- Runtime: `v24.19.0` on `darwin-arm64`
- Full active 10,000-month soak: `false`

| Proof | Result | Runtime |
|---|---:|---:|
| map-fixtures | PASS | 239.2 ms |
| no-bootstrap | PASS | 121.8 ms |
| residential-bootstrap | PASS | 111.3 ms |
| c-and-i-first | PASS | 301.8 ms |
| one-coal-equilibrium | PASS | 3245.3 ms |
| land-shortage-and-slurp | PASS | 754.3 ms |
| pollution-relocation | PASS | 859.1 ms |
| plant-comparison | PASS | 188.8 ms |
| power-severance-and-repair | PASS | 189.7 ms |
| seeded-fire-coverage | PASS | 160.7 ms |
| deterministic-checkpoint-hashes | PASS | 18368.8 ms |
| 1200-month-performance | PASS | 8937.3 ms median / 8995.4 ms max (3 samples) |
| 10000-month-inert-soak | PASS | 36.4 ms |
