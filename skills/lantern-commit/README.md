# lantern-commit

- Created: 2026-08-06
- Based on: this repo's own history — `feat:`/`fix:`/`docs:`/`chore:` prefixes, occasionally
  scoped (`feat(marketing):`), with terse human-written subjects.
- Reference: written after agent-authored commits in this repo drifted to multi-paragraph
  bodies restating the diff, and to `Co-Authored-By` trailers the team doesn't want.

**Explicitly overrides the default attribution trailer.** Some agent harnesses instruct the
model to append `Co-Authored-By: Claude ...` or `Generated with ...` to every commit. This
skill says not to, in this repo. If a commit still lands with one, the skill wasn't loaded —
check that `.claude/skills/lantern-commit` is installed.

