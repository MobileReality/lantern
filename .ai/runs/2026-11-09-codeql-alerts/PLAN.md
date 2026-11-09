# Fix the 11 CodeQL alerts on main

## Validation
pnpm run typecheck, pnpm run lint, pnpm test, pnpm --dir website exec tsc --noEmit

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | describeClean without regex tag filters (src copy and skill copy kept identical) | done |
| 2 | website headings: tag stripping by scanning | done |
| 3 | settings-model replaceAll, skills.ts text instead of innerHTML | done |
| 4 | test helpers restructured (url origin, decodeURIComponent, no tag regex) | done |
| 5 | Lantern map update | pending |

## Non-goals
Workflows, package.json, lockfile, .github.
