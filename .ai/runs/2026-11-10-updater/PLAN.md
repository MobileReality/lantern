# Updater

Goal: an installed Lantern finds a newer GitHub release; macOS installs it only when nothing would be ended, other platforms show a link.

## Validation
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | Pure parts: version compare, guard, feed readers, process activity | done |
| 2 | Service, Squirrel adapter, manual-check controller, IPC | done |
| 3 | Setting, menu item, notice in the window, messages | done |
| 4 | Tests and docs page | done |
| 5 | Review, Lantern map | pending |

## Non-goals
- Release workflow, packaging scripts, asset names.
- Runtime dependencies for updating.
- The primitives map and the decision record.
