# Handoff

Plan unreviewed (unattended run). Change is done: the e2e tsconfig now includes the existing `src/renderer/svg.d.ts` and `src/main/skill-scripts.d.ts`, and `graph-pixi.spec.ts` calls `toBitmap()` (typed Buffer) instead of the legacy `getBitmap()` (typed void). Remaining: review, map, PR.
