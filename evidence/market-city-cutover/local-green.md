# Local cutover verification

Verified on macOS arm64 with Node 24.14.0 on 2026-08-11.

| Gate | Result |
|---|---:|
| TypeScript project references | PASS |
| Unit, property, oracle, renderer, persistence, and cutover tests | 217/217 PASS |
| Deterministic behavioral proofs | 13/13 PASS |
| One-coal 1,200-month active run | 7,977.0 ms, PASS under 10 seconds |
| Active 10,000-month soak | 52,035.7 ms, PASS |
| Browser cutover and retained-visual contracts | 3/3 PASS |
| Browser month-step latency (single worker) | p95 4.40 ms, max 4.40 ms |
| Market dashboard bundle | 86,360 gzip bytes, PASS under 160,000 |
| Legacy outputs in `dist` | 0 |

The browser contract founded a fresh city through visible controls, placed a
road, coal plant, power line, all three RCI zones, and a fire station; advanced
growth and fire; inspected a lot; rotated the camera; saved; reloaded; and
matched both the deterministic state hash and RCI appearance signature.

Hosted-preview and real-session evidence is intentionally separate because it
must be produced from the pushed commit and exact Vercel deployment.
