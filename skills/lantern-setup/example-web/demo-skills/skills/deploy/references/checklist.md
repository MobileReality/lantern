# Release checklist

1. The preflight is green: `scripts/preflight.mjs`.
2. The previous release is tagged, so a rollback has a target.
3. Staged rollout: 5%, 25%, 100%, with ten minutes between stages.

## Rollback

Run [the rollback script](../scripts/rollback.sh) with the previous release tag, then open an
incident note.
