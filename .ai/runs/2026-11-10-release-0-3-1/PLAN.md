# Plan: release 0.3.1

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | package.json 0.3.1, CHANGELOG 0.3.1 entry and links | done | see log |

## Validation

- `node -p "require('./package.json').version"`
- `grep -n '^## \[' CHANGELOG.md`
- `pnpm run typecheck`, `pnpm run lint`, version-related tests

## Non-goals

Workflows, scripts, dependencies, source, tags, releases, primitives map.
