# Plan: Linux x64 build

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | build:linux and pack:linux scripts, fuses and licences for linux | done |
| 2 | release.yml build-linux job, publish needs it | done |
| 3 | ci.yml ubuntu leg packages, zips and checks the zip | done |
| 4 | Linux updater and layout tests | done |
| 5 | docs: installation.md, README, CONTRIBUTING | done |
| 6 | Lantern map update | pending |

## Validation

`pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm exec vitest run test/workflow-hygiene.test.ts`.

## Non-goals

macOS or Windows signing, secrets, e2e specs, the decision record, a tag or a release.
