# Plan: the skill linker is the skills catalogue

Plan unreviewed (unattended run).

## Validation
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`
- `env -u ELECTRON_RUN_AS_NODE pnpm run test:skills:e2e`

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Failing tests first: unit test with a temp home, e2e scenarios, harness fixture | done | tests |
| 2 | `skills.ts` derives the repo from the resolved linker when none is saved | done | main |
| 3 | Panel counts, plain-word linker state messages | done | main |
| 4 | Project skills first screen holds the linker row; Lantern tab marks and links not-installed skills | done | renderer |
| 5 | Lantern map | todo | |

## Non-goals
- No change to clone/setRepo, link/unlink symlinking, the extensions file format, the extras slot logic.
