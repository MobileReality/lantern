# lantern-sync

- Created: 2026-09-30, in the Lantern repo (`skills/lantern-sync/`, the source of truth; the app bundles it)
- Based on: the `lantern 1` map format and the `lantern-pr 1` pull-request record format
  (`../lantern-setup/references/format.md`, "Pull requests"); `git diff --name-status -M
  <base>...HEAD` for the change set; Node ≥18, no dependencies. Reuses `lantern-setup`'s
  `scripts/lib.mjs`, `texts.mjs`, `prs.mjs` (imported) and `validate.mjs` (run), so the sibling
  `lantern-setup` skill must sit beside it (`../lantern-setup`, in this repo's `skills/` or a project's
  `.claude/skills/`).
- Reference: Lantern app (the desktop app that draws `.lantern/`), delegate runs that end in a pull
  request (`lantern-delegate` sequences them)

Installed into a project by the Lantern app, or with `pnpm run install-skills -- [--provider claude|codex] <project-dir>` from
the Lantern repo.

**Writes into the project's `.lantern/`** (records and text keys of deleted files, `prs/<id>.pr`, `prs/dismissed`, the deletion of dismissed `.pr` records via `dismiss <id>...`, and the deletion of untracked
`.lantern/` copies identical to a base branch via `tidy --base <b>`)
and nothing else. A pull request that changes only `.lantern/` (a seed, a refresh) gets a record too. It never commits or pushes; the agent using it commits and pushes on its own
branch only when told to, as the steps in `SKILL.md` say. Re-mapping the listed files is the calling
agent's work under `lantern-setup`'s model policy (Sonnet, Opus or Fable of any version, or the exact id `gpt-6-astra`; Sonnet 5.5, Opus 5.5 and Fable 5.1 or newer are recommended and a lower version only warns; on the Codex route also `gpt-<version>-sol`, recommended 6.1, `gpt-<version>-astra`, recommended 6, and `gpt-<version>-terra`, with no recommended version, of any version).

Markdown skill and instruction files (`SKILL.md`, `protocol.md`, references, agents, `CLAUDE.md`) are
mapped nodes under `lantern-setup`'s rules, so change detection, hashing, `finish`, `verify` and the PR
record treat them exactly like source files; the selftest covers a stale `SKILL.md`, an `@` reference
to a removed file, and an old map that meets markdown for the first time.

`scripts/selftest.mjs` builds a throwaway git repo and checks every command end to end (no test
runner needed):

```bash
node skills/lantern-sync/scripts/selftest.mjs
```
