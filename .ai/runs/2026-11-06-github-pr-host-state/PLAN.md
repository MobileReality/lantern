# GitHub pull request state from the host

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Provider table remote aliases, origin parser, request transport | done | |
| 2 | GitHub request and drivers, status layer, account lookup | done | |
| 3 | Tests, stub API, e2e spec | done | |
| 4 | Docs and lang texts | done | |
| 5 | Lantern map update | todo | |

## Validation

`pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run compile`, `pnpm run test:skills:e2e`,
`sync.mjs verify --base main --require-pr --require-reason --require-order --require-flow`.

## Non-goals

No env or `.ai/.env` token fallback for GitHub, no new GitHub endpoint, no change to Bitbucket requests.
