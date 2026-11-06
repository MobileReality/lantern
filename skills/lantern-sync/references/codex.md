# Codex sync workflow

Read `authority.md` before acting. Resolve `lantern-setup` beside this skill first. If it is absent, run sync commands with `--provider codex`; the script then checks project `.agents/skills/lantern-setup`, `~/.agents/skills/lantern-setup`, and `${CODEX_HOME:-~/.codex}/skills/lantern-setup`. Stop if none contains both `SKILL.md` and `scripts/lib.mjs`.

Pass `--provider codex` to every sync command when the script location does not make the provider unambiguous. Follow the setup skill's `references/codex.md` model gate and dispatch brief.

For uncommitted source edits, run `status --provider codex`, then use the setup skill's `plan.mjs` pending/chunk refresh procedure and `validate.mjs . --settled`. Remove stale records and keys through that refresh procedure. Do not run `finish` or `verify`: `finish` examines `<base>...HEAD`, and `verify` deliberately rejects dirty source.

After the source commit has explicit approval and exists, `finish --provider codex` and `verify --provider codex` cover the committed branch change. The `pr` command is reserved for an authorized, already-created pull request. Commit, push, pull-request creation, PR-record creation, and worktree cleanup remain separate stages subject to `authority.md`.
