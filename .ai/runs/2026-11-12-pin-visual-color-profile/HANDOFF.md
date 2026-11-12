# Handoff

Plan was unreviewed (unattended run).

Cause: actual and expected images are both 1100x760; layout identical, but about 98% of pixels differ by a
small colour shift. The display colour profile leaks into the screenshot. DPR (already pinned to 1) and
window size were not the cause.
Fix: `--force-color-profile=srgb` in `test/e2e/support/graph-harness.ts`, baselines regenerated.

Non-blocking reviewer follow-ups: none yet.
