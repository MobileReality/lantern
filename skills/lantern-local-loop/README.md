# lantern-local-loop

- Created: 2026-07-23
- Based on: an autonomous plan-then-execute loop (run folder under `.ai/runs/`, one commit per
  step, checkpoint validation every five steps, local-only), extended here to keep the Lantern
  map true as the final tracked step.
- Reference: pairs with the bundled `lantern-sync` and `lantern-setup`; the map half is inert
  unless the project has a `.lantern/` directory.
- Payload: `references/templates.md` (PLAN / HANDOFF), `scripts/loop.sh` (unattended
  driver; requires bash, so WSL on Windows).
