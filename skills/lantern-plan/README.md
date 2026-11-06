# lantern-plan

- Created: 2026-10-26, in the Lantern repo (`skills/lantern-plan/`, the source of truth; the app bundles it)
- Based on: the `lantern-plan 1` plan format (`../lantern-setup/references/format.md`, "Plans") and the
  `lantern-pr 1` records that tick its items; Node >= 18, no dependencies. Reuses `lantern-setup`'s
  `scripts/lib.mjs`, `areas-file.mjs`, `cli-args.mjs`, `shell.mjs` and `prs.mjs` (imported) and `validate.mjs`
  (run), so the sibling `lantern-setup` skill must sit beside it. The one piece both skills need, the `#plan`
  record pattern (`PLAN_REF`) with the slug and item patterns, the plans folder and the ISO date check, lives
  in `lantern-setup/scripts/plan-ref.mjs`, and `plan-format.mjs` re-exports it, so the dependency runs one way.
- One definition each: `scripts/plan-format.mjs` is the plan format (header, regexes, limits, the tag, section,
  kind and status names; the app imports it too) and `scripts/messages.json` holds every message the scripts
  and the app's plan parser print, read through `say()` in `scripts/plan-messages.mjs`, plus the `view` section:
  the text of the app's plan strip and stage view, which only the app reads (`src/shared/lantern-plan-messages.ts`).
- Reference: LAN-9 and LAN-35, the planning module.

The entry of a set of five skills, each short and loadable alone: `lantern-plan` (gate, process, which skill
to read at each step), `lantern-plan-impact`, `lantern-plan-stages`, `lantern-plan-review`,
`lantern-plan-handoff`. All scripts live here in `scripts/`; the others point at them.

**Writes into the project's `.lantern/plans/`** and nothing else. It never commits or pushes; the agent
commits an approved plan.

`scripts/selftest.mjs` builds a throwaway git repo and runs the commands end to end:

```bash
node skills/lantern-plan/scripts/selftest.mjs
```

Installed into a project by the Lantern app, or with `pnpm run install-skills -- <project-dir>` from the
Lantern repo (Claude only).
