# LAN-121 Diagnostics

Plan unreviewed (unattended run).

## Validation
- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm test`

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | Shared record shape, channels, payload parsers (`src/shared/diagnostics.ts`) | done |
| 2 | Pure main modules: redact, record, rotation, store, lifecycle, throttle, report, github, editor-server, capture, ipc-guard, ipc, service | done |
| 3 | Wire main.ts and serveweb.ts, preload bridge | done |
| 4 | Renderer: capture, model, view, feature, crash notice, load-screen link, command | done |
| 5 | Tests for all of the above | done |
| 6 | Docs page, bug report template section | done |
| 7 | Lantern map | pending |

## Non-goals
Remote export, analytics, any network call, agent session content, release workflow, dependencies.
