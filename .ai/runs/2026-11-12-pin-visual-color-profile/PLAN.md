# Plan: pin the visual render

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Pin `--force-color-profile=srgb` in the graph harness, regenerate the two darwin baselines | done | pending |

## Validation
- `env -u ELECTRON_RUN_AS_NODE pnpm run test:graph:visual` x3
- `env -u ELECTRON_RUN_AS_NODE pnpm run test:graph:e2e`
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`

## Non-goals
Loosening the comparison, touching src/, other specs, workflows.
