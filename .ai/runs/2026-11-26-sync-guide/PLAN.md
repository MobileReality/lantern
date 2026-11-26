# Plan: sync.mjs --guide-file and --require-guide

Plan unreviewed (unattended run).

## Tasks

| # | Step | Status |
|---|---|---|
| 1 | changeHunks from git, collectGuide, pr writes guide, verify --require-guide | done |
| 2 | test/lantern-sync-guide.test.ts | done |
| 3 | SKILL.md and format.md text | done |
| 4 | Lantern map update | todo |

## Validation

- pnpm exec vitest run test/lantern-sync-guide.test.ts
- pnpm test, pnpm run typecheck

## Non-goals

src/, lantern-delegate, e2e-delegate, skill-test, prguide.mjs grammar.
