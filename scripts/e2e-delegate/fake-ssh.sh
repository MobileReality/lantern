#!/bin/sh
: "${E2E_REMOTES:?E2E_REMOTES must point at the directory holding the bare remotes}"
for last; do :; done
cmd=$(printf '%s' "$last" | sed -E "s#'/?e2e/([^']+)'#'${E2E_REMOTES}/\\1'#")
exec sh -c "$cmd"
