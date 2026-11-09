# Plan: fix dependency vulnerabilities

## Validation
- `pnpm audit` and `pnpm audit --prod`
- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run compile`
- packaging smoke: `pnpm run build` (darwin arm64)

## Non-goals
- No workflow, docs or application source changes. No `.github/dependabot.yml`.

## Tasks
| # | Step | Status | Commit |
|---|---|---|---|
| 1 | Bump js-yaml, vitest, @vitest/coverage-v8, @electron/packager, @electron/osx-sign | done | pending |
| 2 | Add pnpm.overrides for transitive findings | done | pending |
| 3 | Verify and package | in progress | |
