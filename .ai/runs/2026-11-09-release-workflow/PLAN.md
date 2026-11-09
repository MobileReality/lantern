# Plan: release workflow (LAN-113)

## Validation
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`
- `release.yml` parses as YAML, every `uses:` pinned by SHA

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | Add `.github/workflows/release.yml` (mac, windows, publish jobs) | done |
| 2 | Add a Releases section to `docs/installation.md` | done |
| 3 | Re-map `.lantern/` for the changed files | pending |

## Non-goals
- No edits to `ci.yml`, `deploy-docs.yml`, source or package.json scripts
- No README Download section, no tags, no release
