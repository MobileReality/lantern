#!/usr/bin/env bash
set -euo pipefail

dir="${1:-release-assets}"
installer="Lantern-Setup.exe"

cd "$dir"
zips=(*.zip)
[ -e "${zips[0]}" ] || { echo "No zips in $dir" >&2; exit 1; }
[ -f "$installer" ] || { echo "No $installer in $dir" >&2; exit 1; }

sha256sum -- "${zips[@]}" "$installer" > SHA256SUMS
echo "Wrote $dir/SHA256SUMS for ${#zips[@]} zips and $installer"
