# Contributing to SynthCity

Thanks for helping make SynthCity better. Large changes should begin with an
issue or a short design discussion before implementation.

## Development setup

Use Node.js 24 or newer and pnpm 11.16.0 or newer.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev
```

Create a focused branch from the latest `main`. Keep unrelated changes in
separate pull requests.

## Project contracts

- `src/market-city/` is the canonical simulation authority.
- Simulation state must remain deterministic. Do not use wall-clock time,
  network results, or unseeded randomness in canonical rules.
- A schema or rules-version change requires an explicit migration and tests.
- Renderer and dashboard projections must not silently mutate simulation state.
- New visual assets require provenance and redistribution information in
  `docs/ASSET_PROVENANCE.md` or `THIRD_PARTY_NOTICES.md`.
- Never commit credentials, `.env` files, private keys, production saves, or
  personal browser data.

## Before opening a pull request

```sh
pnpm public:check
pnpm typecheck
pnpm test
pnpm build
pnpm bundle:check
```

Run `pnpm test:e2e` for user-visible changes. Run `pnpm test:release` for a
release candidate.

Every pull request should explain:

- The player-facing change.
- Why the change belongs in the canonical game.
- Tests and browser interactions used to verify it.
- Any save, rules-version, asset, privacy, or deployment impact.

## Third-party material

Submit only code and assets you created or have the right to redistribute.
Include the original source, author, license, required attribution, and any
modifications. A download being free does not make it redistributable.

By submitting a contribution, you agree to license it under the repository's
MIT License and confirm that you have the right to do so. Do not submit material
whose ownership or licensing is uncertain.
