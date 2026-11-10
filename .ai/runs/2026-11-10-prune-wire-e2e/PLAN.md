# Plan: prune and wire e2e

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Delete the four pointless tests and graph-performance (spec, md, script) | done | f9bed3a6 |
| 2 | Add test:graph:macro:e2e, test:pr-review:e2e, test:text-select:e2e, test:lsp:e2e | done | f9bed3a6 |
| 3 | Document in docs/primitives.md | done | f9bed3a6 |
| 4 | Lantern map | pending | |

## Validation
pnpm run typecheck, test:graph:typecheck, lint, pnpm test; each new script run once.

## Non-goals
Fixing failing orphaned specs, src/ changes, CI, snapshots.
