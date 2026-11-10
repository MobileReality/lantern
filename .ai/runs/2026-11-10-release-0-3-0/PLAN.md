# Plan: release 0.3.0

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Set package.json version to 0.3.0 and add the 0.3.0 changelog entry with link references | done | see log |

## Validation

- `node -p "require('./package.json').version"`
- `grep -n '^## \[' CHANGELOG.md`
- `pnpm run typecheck`, `pnpm run lint`, `pnpm exec vitest run test/app-identity.test.ts test/docs-website.test.ts`

## Non-goals

No tag, no release, no source, workflow, script or lockfile change.
