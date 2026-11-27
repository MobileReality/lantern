# Plan: the guide replaces per-file reasons

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | sync.mjs pr and verify accept a covering guide in place of reasons | done | 986c8af5 |
| 2 | Docs, e2e checks, fake agent and tests follow | done | 986c8af5 |
| 3 | docs/installation.md row for pr | done | see log |

## Validation

pnpm run typecheck, pnpm run lint, pnpm test

## Non-goals

src/, docs/primitives.md, removing #reason from the grammar or parsers.
