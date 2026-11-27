# Plan: guide wraps the PR review screen

Plan unreviewed (unattended run).

## Validation
pnpm run typecheck, pnpm run lint, pnpm test, pnpm run test:pr-review:e2e

## Non-goals
skills/, scripts/e2e-delegate, scripts/skill-test, record grammar, src/main parsers, sync gates, docs/primitives.md, macro redesign.

## Tasks
| # | Step | Status |
|---|------|--------|
| 1 | Pure guide helpers: stops in guide order, step note, line marking | done |
| 2 | Left-pane guide pane replaces the PR file list; Guide view code removed | done |
| 3 | Review pane shows step note and marks line ranges; nav walks stops | done |
| 4 | Unit and e2e tests follow the new behaviour | done |
| 5 | Lantern map update | pending |
