# Plan

Group VS Code server stderr bursts into one Diagnostics entry.

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Buffer lines in createServerOutputReporter, flush on quiet window, exit and error; `panicked` is serious | done | see log |
| 2 | Tests with fake timers | done | see log |

## Validation

pnpm test, pnpm run typecheck
