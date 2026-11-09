# Handoff

Plan unreviewed (unattended run).

State: ci.yml has `e2e` and `coverage` jobs; ci-workflow.test.ts guards them. The workflow itself was never run on Actions.

Excluded from e2e: `@visual` specs (snapshots exist for darwin only), `test:graph:perf`, `test:flow:layout` (skips without a Chromium binary), and specs no `test:*:e2e` script lists.
