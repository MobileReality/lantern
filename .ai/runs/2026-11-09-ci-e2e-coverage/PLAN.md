# Plan: ci-e2e-coverage (LAN-115)

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Add e2e and coverage jobs to ci.yml | done | see branch |
| 2 | Update test/ci-workflow.test.ts guards and add tests for the new jobs | done | see branch |

## Validation

- pnpm run typecheck
- pnpm run lint
- pnpm exec vitest run test/ci-workflow.test.ts
- pnpm coverage (the exact command the coverage job runs)
- pnpm test

## Non-goals

- release.yml, codeql.yml, deploy-docs.yml, README, source code, package.json scripts
- Fixing flaky unit tests
- Visual snapshot and perf specs
