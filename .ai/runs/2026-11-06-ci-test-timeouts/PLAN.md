# ci-test-timeouts

Make the CI workflow's `pnpm test` pass on a 2-vCPU hosted runner.

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | vitest config: CI-aware testTimeout, hookTimeout, maxWorkers | done |
| 2 | explicit 60 s timeout on the seven heavy tests | done |
| 3 | Lantern map update | pending |

## Validation

- `pnpm run typecheck`, `pnpm run lint`, `CI=true pnpm test`, `pnpm test`, `pnpm run compile`

## Non-goals

Application code, assertions, workflow steps, retries, skipping tests.
