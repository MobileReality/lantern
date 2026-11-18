# Plan: seed claudeCode.preferredLocation

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Seed the key in mergeEditorSettings and cover it in test/serveweb-settings.test.ts | done | see log |

## Validation
- pnpm run typecheck
- pnpm exec vitest run test/serveweb-settings.test.ts
- pnpm test

## Non-goals
Extension files, other seeded settings, UI, IPC, docs.
