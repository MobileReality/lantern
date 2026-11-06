# Templates

Both files live in `.ai/runs/<YYYY-MM-DD>-<slug>/`.

## PLAN.md

The `## Tasks` table comes first, immediately after the header block. It is parsed on every resume, so keep the column order and don't reorder or rename rows once the run has started — only the `Status` and `Commit` cells change.

```markdown
# Plan — <slug>

**Goal:** <one sentence>
**Branch:** loop/<slug>
**Created:** <UTC ISO-8601>

## Tasks

| Step | Title                                  | Status | Commit  |
| ---- | -------------------------------------- | ------ | ------- |
| 1    | Add session table migration            | done   | a1b2c3d |
| 2    | Session repository + unit tests        | done   | e4f5a6b |
| 3    | Swap login handler to sessions         | todo   |         |
| 4    | Delete JWT middleware                  | todo   |         |
| 5    | Update the Lantern map                 | todo   |         |

Status is one of: `todo`, `done`, `blocked`.

The final `Update the Lantern map` row exists only in projects with a `.lantern/` directory. It is
always last, and it runs after the validation gate is green.

## Validation

Run in this order. Every command must exit zero before the run is complete.

1. `npm run typecheck`
2. `npm test`
3. `npm run build`

## Context

<What a fresh agent needs to know: relevant files, conventions, prior decisions,
anything surprising about this codebase.>

## Non-goals

- <explicitly out of scope>
- <explicitly out of scope>

## Risks

- <what might break, and what to watch>
```

## HANDOFF.md

Rewritten at every checkpoint and at run end. Keep it short — it's read first on every resume, and its value is that it's faster to absorb than the full plan. If it grows past a screen, it's doing the plan's job.

```markdown
# Handoff — <slug>

**Updated:** <UTC ISO-8601>
**Branch:** loop/<slug>
**Current step:** <N — title>
**Last commit:** <short sha> — <subject>

## What just happened

- <one or two bullets>

## Next concrete action

- <the exact next thing to do>

## Blockers

- <or "none">

## Environment notes

- Dependencies installed: <yes|no>
- Full validation last run: <checkpoint N — passed|failed: which command>
- Anything unusual about local state: <or "nothing">
```

## Commit subjects

Steps use conventional commits describing the change:

```
feat(auth): add session cookie helper
test(auth): cover session expiry
fix(api): handle missing session id
refactor(db): extract query builder
```

Loop bookkeeping uses the `chore(loop)` scope, which makes it trivial to filter
the run's own commits out of a review:

```
chore(loop): plan <slug>
chore(loop): checkpoint 2
chore(loop): update the Lantern map
chore(loop): complete <slug>
```

