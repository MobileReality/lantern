# Plan: app parses #guide lines (guided-pr-review s2.2)

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | lantern-guide-parse.ts, LanternGuide types, wire into pr-parse, prs and local loaders | done | pending |
| 2 | Parity cases and limit pin in test/lantern-pr-parity.test.ts | done | pending |
| 3 | Lantern map and PR record | todo | |

## Validation

- `pnpm exec vitest run test/lantern-pr-parity.test.ts`
- `pnpm test`, `pnpm run typecheck`

## Non-goals

Renderer, review screen, skills, `.lantern/` by hand.
