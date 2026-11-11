# Plan: get the three orphaned e2e scripts green

Goal: test:graph:macro:e2e, test:pr-review:e2e and test:graph:e2e exit zero on macOS.

## Validation
- pnpm run typecheck, pnpm run lint, pnpm test
- pnpm run test:graph:macro:e2e, test:pr-review:e2e, test:graph:e2e (twice in a row)

## Tasks
| # | Step | Status |
|---|------|--------|
| 1 | Baseline the three scripts on untouched main and classify each failure | done |
| 2 | Macro/overview specs: open the Overview drawer where they read the side panel | done |
| 3 | PR review specs: scope to the visible body, adapt to the intent-aware composer | done |
| 4 | Graph specs: tooltip is data-tip, strict .lt-side locators, overflow panes | done |
| 5 | App fix: only the primary button taps a pixi node, tile, area or the background | done |
| 6 | Regenerate the two @visual baselines (strip redesign in 752fdf31) | done |
| 7 | Verify twice, review, map, PR | open |

## Non-goals
- test/*.test.ts, .github/workflows, test:lsp:e2e, test:text-select:e2e, test:graph:typecheck
- docs/primitives.md and the decision record
