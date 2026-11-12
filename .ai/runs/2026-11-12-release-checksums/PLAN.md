# Plan: SHA256SUMS with every release

## Tasks
| # | Step | Status |
|---|---|---|
| 1 | scripts/release-checksums.sh, wired into publish job | done |
| 2 | Verify the download note in README and docs/installation.md | done |

## Validation
typecheck, lint, pnpm test.

## Non-goals
Signing, build jobs, src/.
