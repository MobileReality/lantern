#!/usr/bin/env bash
set -euo pipefail

dir="${1:-release-assets}"

cd "$dir"
zips=(*.zip)
[ -e "${zips[0]}" ] || { echo "No zips in $dir" >&2; exit 1; }

sha256sum -- "${zips[@]}" > SHA256SUMS
echo "Wrote $dir/SHA256SUMS for ${#zips[@]} zips"
