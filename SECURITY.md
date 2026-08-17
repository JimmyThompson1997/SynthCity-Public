# Security policy

## Supported version

Security fixes target the latest production commit on `main`. Older previews,
feature branches, and saved local builds are not supported releases.

## Report a vulnerability

Do not open a public issue for a vulnerability, credential, private save, or
personal-data exposure.

Use GitHub's private vulnerability reporting for this repository. Do not paste
secrets into an issue, pull request, discussion, screenshot, or browser log.

Include:

- The affected URL, commit, or file.
- Reproduction steps and expected impact.
- Whether the problem exposes credentials, saved cities, or browser data.
- Any temporary mitigation you have already applied.

## Repository security assumptions

- The production client is static and browser-first.
- City saves are stored in local IndexedDB.
- The current runtime has no account system, cloud-save backend, or telemetry.
- Build and deployment credentials must remain in the hosting provider or
  GitHub secret store, never in source control.

The maintainer will validate the report privately, rotate exposed credentials
before discussing source cleanup, and coordinate disclosure after a fix is
available.
