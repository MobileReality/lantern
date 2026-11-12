# Handoff

Plan was unreviewed (unattended run). Code is done; the map update and the review remain.

## Blockers

`node scripts/esbuild.mjs --target-platform linux --target-arch x64` cannot complete on a Mac: `scripts/lsp-runtime.mjs` throws because it ships the host's Node binary. Left as is; CI on ubuntu is the check.

## Reviewer follow-ups

(none yet)
