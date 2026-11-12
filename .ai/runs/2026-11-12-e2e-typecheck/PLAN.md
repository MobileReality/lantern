# Plan: e2e typecheck green

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Include svg.d.ts and skill-scripts.d.ts in test/e2e/tsconfig.json; use toBitmap() in graph-pixi.spec.ts | done | pending |

## Validation
- pnpm run test:graph:typecheck
- pnpm run typecheck
- pnpm run lint
- pnpm test

## Non-goals
- No suppressions, no loosened compiler options, no spec logic changes, no docs/primitives.md edit (another delegate owns it; no comparable typecheck entry exists there).
