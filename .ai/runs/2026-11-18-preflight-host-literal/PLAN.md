# Plan: four lantern-delegate test files green on any machine

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Find why preflight loses its host, identity and permissions lines | done | |
| 2 | classify a remote that names bitbucket.org or github.com without asking ssh | done | |
| 3 | Regression test for a remote routed through another HostName | done | |
| 4 | Lantern map | pending | |

## Validation

- `npx vitest run test/lantern-delegate-scripts.test.ts test/lantern-delegate-commit-identity.test.ts test/lantern-delegate-delivery-flow.test.ts test/skill-test-harness.test.ts`
- `pnpm test`, `pnpm run typecheck`, `pnpm run lint`

## Non-goals

- permissions.mjs lists, docs/primitives.md, decision records, the Macro view, the release.
