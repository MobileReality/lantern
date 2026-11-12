# Plan: quit when the last window closes without a reachable tray

## Validation
pnpm run typecheck, pnpm run lint, pnpm test

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Pure decision + handler in `src/main/last-window.ts`, wired in `main.ts`, idle hook in `windows.ts`, tests | done | this branch |

## Non-goals
Tray visuals, popover, icons, `code` lookup, CLI installer, macOS behaviour.
