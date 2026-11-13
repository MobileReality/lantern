# Plan: uninstallUserCli for Linux and Windows

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Failing tests for Linux and Windows uninstall | done | - |
| 2 | uninstallUserCli in cli-user-install.ts, shared PATH-entry matcher | done | - |

## Validation

- pnpm run typecheck
- pnpm test
- pnpm vitest run test/cli-user-install.test.ts

## Non-goals

macOS link, src/main/cli.ts, IPC, preload, renderer, installer, docs.
