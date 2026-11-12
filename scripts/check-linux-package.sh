#!/usr/bin/env bash
set -euo pipefail

zip="${1:-dist/Lantern-linux-x64.zip}"
app="${2:-dist/Lantern-linux-x64}"
root="$(basename "$app")"

names="$(zipinfo -1 "$zip")"

for entry in \
  Lantern \
  chrome-sandbox \
  resources/app.asar \
  resources/cli/lantern \
  resources/lsp-runtime/node \
  resources/licenses/ELECTRON-LICENSE \
  resources/licenses/THIRD_PARTY_LICENSES.txt; do
  grep -Fx -- "$root/$entry" <<< "$names" > /dev/null || { echo "Missing from $zip: $root/$entry"; exit 1; }
done

for executable in Lantern resources/lsp-runtime/node resources/cli/lantern; do
  zipinfo "$zip" "$root/$executable" | grep -q '^-rwx' || { echo "Not executable in $zip: $root/$executable"; exit 1; }
done

pnpm exec electron-fuses read --app "$app/Lantern" | grep -F 'RunAsNode is Disabled' > /dev/null || { echo "The RunAsNode fuse is not disabled in $app/Lantern"; exit 1; }

echo "$zip holds the expected files, and RunAsNode is disabled"
