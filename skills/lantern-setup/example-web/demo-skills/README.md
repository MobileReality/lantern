# demo-skills

- Created: 2026-10-05
- Based on: `lantern 1` map format, role `skill` and the `@` relation (`references/format.md`, `references/roles.md`)
- Reference: none — a fictional two-skill repository (`skills/commit`, `skills/deploy`) invented to
  show how markdown skill files are mapped and what the mapper records for them

**Fictional, but complete.** Unlike `demo-ai` and `demo-platforms`, the source files are here and
`.lantern/` is a settled map of them: `node scripts/validate.mjs example-web/demo-skills --settled`
exits 0 (9 files; 6 of the 7 markdown files refer to others). The expected relations are what the mapper records
after running `node scripts/refs.mjs example-web/demo-skills <file>` and judging each candidate;
`test/lantern-skill-files.test.ts` checks that every recorded `@` relation is a candidate and that
the one candidate the mapper drops is exactly the one this file names.

**What the fixture shows**

- Mapped: `CLAUDE.md`, `.claude/commands/ship.md`, both `SKILL.md`, `protocol.md`,
  `references/checklist.md`, `agents/verifier.md`, and the two scripts the skill points at.
- Not mapped: this `README.md` (the repository's, not a skill folder's) and `docs/guide.md`
  (ordinary documentation).
- Reference forms in the text: "the `commit` skill" (a skill name), `[the checklist](references/checklist.md)`
  (a link), `node $D/scripts/preflight.mjs` (a variable resolved against the skill folder),
  `protocol.md` (a bare name beside the file), `../references/checklist.md` (relative), and
  `skills/deploy/protocol.md` (from the repository root).
- Not relations: the `release-notes` skill does not exist, `src/app/main.ts` and `CHANGELOG.md` are
  not mapped files, and `agents/verifier.md` names `scripts/rollback.sh` only to forbid running it,
  so that one candidate is dropped.
