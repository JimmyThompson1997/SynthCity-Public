# Release checklist

Use this checklist for every public release candidate.

## Source and security

- Confirm the candidate is based on current `main`.
- In the private release environment, set `SYNTHCITY_PRIVATE_IDENTITIES_JSON`
  to a JSON array containing every private name, account handle, and deployment
  owner slug that must not appear in the exported tree or build.
- Run `SYNTHCITY_PUBLIC_RELEASE=1 pnpm public:check`.
- Run the dependency audit and review any new third-party material.
- Confirm no credentials, direct emails, machine paths, private saves, browser
  data, or deployment artifacts are tracked or emitted by the build.
- Confirm every bundled asset is cleared in `docs/ASSET_PROVENANCE.md`.

## Verification

- Run `pnpm test:release` from a frozen install.
- Verify the exact candidate SHA in GitHub Actions.
- Run `pnpm test:hosted` against the exact preview SHA.
- Inspect the playable city and Asset Library in a fresh browser session with
  no console errors or failed requests.

## Deployment

- Record the prior production SHA.
- Deploy only the reviewed `main` SHA.
- Run the hosted suite against production with the expected-commit guard.
- Verify the canonical URL, save/reload behavior, and browser console.
- Roll back to the recorded deployment if identity, security, or gameplay proof
  fails.
