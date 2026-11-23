# Plan: dev profile does not open the vault

## Tasks

| # | Step | Status | Commit |
|---|---|---|---|
| 1 | `vaultCipher` gates safeStorage on dev profile and `LANTERN_DEV_VAULT`; main.ts uses it; tests; docs | done | see log |
| 2 | Lantern map | pending | |

## Validation
pnpm test, pnpm run typecheck, pnpm run lint

## Non-goals
Encrypted format, account store API, credential kinds, credential server answers.
