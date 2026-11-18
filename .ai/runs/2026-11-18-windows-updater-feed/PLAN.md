# Plan: windows updater feed (item s4.1)

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | tests first (feed, service, adapter, launchedBySquirrel) | done |
| 2 | feed.ts: windowsFeedUrl, squirrelFeedUrl, readWindowsFeed | done |
| 3 | native.ts: win32 setFeedURL without serverType, launchedBySquirrel | done |
| 4 | service.ts + main.ts wiring | done |

## Validation
pnpm run typecheck; pnpm test

## Non-goals
Build script, squirrel-events, workflow, docs, signing, settings panel, macOS behaviour.
