# Plan: lantern CLI install on Linux and Windows

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | Pure per-platform installer with a file-system/registry port (`src/main/cli-user-install.ts`, `cli-user-port.ts`) | done |
| 2 | Linux launch branch in `src/cli/lantern`, Windows `src/cli/lantern.cmd` | done |
| 3 | Wire IPC, panel wording and notes, docs | done |
| 4 | Tests with mutation checks | done |

## Validation
`pnpm run typecheck`, `pnpm run lint`, `pnpm test`.

## Non-goals
macOS installer, signing, release.yml, tray, `code` lookup.
