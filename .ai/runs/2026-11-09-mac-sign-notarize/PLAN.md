# Plan: sign and notarize the macOS release build

Plan unreviewed (unattended delegate run).

## Validation
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`
- `plutil -lint build/entitlements.mac.plist build/entitlements.mac.inherit.plist`
- `bash -n` on both new scripts

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Entitlements plists, justified by evidence (JIT test on the bundled node and Electron) | done | - |
| 2 | scripts/mac-sign-notarize.sh and scripts/mac-ci-keychain.sh | done | - |
| 3 | release.yml build-mac: environment, tag guard, keychain, sign, notarize, cleanup | done | - |
| 4 | Guard tests: release-workflow.test.ts, workflow-hygiene.test.ts | done | - |
| 5 | Docs: installation.md, CONTRIBUTING.md, README.md | done | - |
| 6 | Lantern map update | open | - |

## Non-goals
Windows signing, other workflows, ci.yml, source code, running the workflow, pushing tags.
