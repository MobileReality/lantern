#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/mac-sign-notarize.sh <sign|notarize|verify|all> [options]

  sign       sign every binary and bundle of the app inside out: Developer ID, hardened runtime, timestamp
  notarize   submit the app to Apple, wait for the verdict, staple the ticket
  verify     codesign --verify --deep --strict, stapler validate, spctl --assess
  all        sign, notarize, verify

Options:
  --app <path>              the app to work on (default: dist/Lantern-darwin-arm64/Lantern.app)
  --identity <name>         signing identity (default: $MACOS_SIGNING_IDENTITY); "-" signs ad hoc, a dry run of "sign" only
  --keychain <path>         keychain that holds the identity (default: the search list)
  --keychain-profile <name> notarytool profile from "xcrun notarytool store-credentials" (local use)

Without --keychain-profile, "notarize" reads the App Store Connect API key from the environment:
APPLE_API_KEY_P8_BASE64, APPLE_API_KEY_ID, APPLE_API_ISSUER_ID.

Run it after "pnpm run build && pnpm run fuses"; "pnpm run pack" zips the result.
EOF
}

APP="dist/Lantern-darwin-arm64/Lantern.app"
IDENTITY="${MACOS_SIGNING_IDENTITY:-}"
KEYCHAIN=""
KEYCHAIN_PROFILE=""
ENTITLEMENTS_APP="build/entitlements.mac.plist"
ENTITLEMENTS_INHERIT="build/entitlements.mac.inherit.plist"
BUNDLED_NODE="Contents/Resources/lsp-runtime/node"
STAPLE_ATTEMPTS=4
WORK_DIR=""

fail() {
  echo "mac-sign-notarize: $*" >&2
  exit 1
}

cleanup() {
  if [ -n "$WORK_DIR" ]; then rm -rf "$WORK_DIR"; fi
}
trap cleanup EXIT

require_app() {
  [ -d "$APP" ] || fail "app not found: $APP (run pnpm run build && pnpm run fuses first)"
}

require_identity() {
  [ -n "$IDENTITY" ] || fail "no identity: pass --identity or set MACOS_SIGNING_IDENTITY (yours are listed by: security find-identity -v -p codesigning)"
}

set_codesign_args() {
  CODESIGN_ARGS=(--force --options runtime --sign "$IDENTITY")
  if [ "$IDENTITY" = "-" ]; then CODESIGN_ARGS+=(--timestamp=none); else CODESIGN_ARGS+=(--timestamp); fi
  if [ -n "$KEYCHAIN" ]; then CODESIGN_ARGS+=(--keychain "$KEYCHAIN"); fi
}

is_macho() {
  [[ "$(file -b "$1")" == *Mach-O* ]]
}

# The bundle's own signature covers its main executable, so it is signed with the bundle, not before it.
is_bundle_main_executable() {
  local dir="${1%/*}" name="${1##*/}"
  case "$dir" in
    */Contents/MacOS) return 0 ;;
  esac
  case "${dir%/*}" in
    */"$name".framework/Versions) return 0 ;;
  esac
  return 1
}

sign_loose_binaries() {
  local file
  while IFS= read -r -d '' file; do
    if is_bundle_main_executable "$file" || ! is_macho "$file"; then continue; fi
    echo "sign: ${file#"$APP"/}"
    if [ "$file" = "$APP/$BUNDLED_NODE" ]; then
      codesign "${CODESIGN_ARGS[@]}" --entitlements "$ENTITLEMENTS_INHERIT" "$file"
    else
      codesign "${CODESIGN_ARGS[@]}" "$file"
    fi
  done < <(find "$APP" -type f -print0)
}

sign_nested_bundles() {
  local bundle
  while IFS= read -r -d '' bundle; do
    [ "$bundle" = "$APP" ] && continue
    echo "sign: ${bundle#"$APP"/}"
    case "$bundle" in
      *.app) codesign "${CODESIGN_ARGS[@]}" --entitlements "$ENTITLEMENTS_INHERIT" "$bundle" ;;
      *) codesign "${CODESIGN_ARGS[@]}" "$bundle" ;;
    esac
  done < <(find "$APP" -depth \( -name '*.framework' -o -name '*.app' \) -type d -print0)
}

sign_app() {
  require_app
  require_identity
  [ -f "$ENTITLEMENTS_APP" ] && [ -f "$ENTITLEMENTS_INHERIT" ] || fail "entitlements files missing under build/"
  set_codesign_args
  sign_loose_binaries
  sign_nested_bundles
  echo "sign: $(basename "$APP")"
  codesign "${CODESIGN_ARGS[@]}" --entitlements "$ENTITLEMENTS_APP" "$APP"
  codesign --verify --deep --strict --verbose=2 "$APP"
  local details
  details="$(codesign -dv "$APP" 2>&1)"
  grep -Eq 'flags=.*runtime' <<< "$details" || fail "hardened runtime flag missing on $APP"
}

set_notary_auth() {
  if [ -n "$KEYCHAIN_PROFILE" ]; then
    NOTARY_AUTH=(--keychain-profile "$KEYCHAIN_PROFILE")
    return
  fi
  : "${APPLE_API_KEY_P8_BASE64:?APPLE_API_KEY_P8_BASE64 is not set (or pass --keychain-profile)}"
  : "${APPLE_API_KEY_ID:?APPLE_API_KEY_ID is not set}"
  : "${APPLE_API_ISSUER_ID:?APPLE_API_ISSUER_ID is not set}"
  local key_file="$WORK_DIR/AuthKey.p8"
  (umask 077 && printf '%s' "$APPLE_API_KEY_P8_BASE64" | base64 --decode > "$key_file")
  chmod 600 "$key_file"
  NOTARY_AUTH=(--key "$key_file" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER_ID")
}

json_field() {
  node -e 'try { process.stdout.write(String(JSON.parse(require("fs").readFileSync(0, "utf8"))[process.argv[1]] ?? "")); } catch {}' "$1"
}

# Apple's ticket can take a moment to reach the CDN stapler reads from.
staple_app() {
  local attempt
  for attempt in $(seq 1 "$STAPLE_ATTEMPTS"); do
    if xcrun stapler staple "$APP"; then return 0; fi
    [ "$attempt" -lt "$STAPLE_ATTEMPTS" ] && sleep 20
  done
  fail "stapler could not attach the notarization ticket"
}

notarize_app() {
  require_app
  WORK_DIR="$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/lantern-notarize.XXXXXX")"
  set_notary_auth
  local archive="$WORK_DIR/Lantern-notarize.zip" result="$WORK_DIR/result.json" id status
  ditto -c -k --keepParent "$APP" "$archive"
  xcrun notarytool submit "$archive" "${NOTARY_AUTH[@]}" --wait --output-format json > "$result" || true
  cat "$result"
  echo
  id="$(json_field id < "$result")"
  status="$(json_field status < "$result")"
  if [ "$status" != "Accepted" ]; then
    if [ -n "$id" ]; then xcrun notarytool log "$id" "${NOTARY_AUTH[@]}" || true; fi
    fail "notarization ended with status '${status:-none}'"
  fi
  staple_app
}

verify_app() {
  require_app
  codesign --verify --deep --strict --verbose=2 "$APP"
  xcrun stapler validate "$APP"
  spctl --assess --type execute --verbose=4 "$APP"
}

COMMAND="${1:-}"
if [ -z "$COMMAND" ]; then usage; exit 2; fi
shift

while [ $# -gt 0 ]; do
  case "$1" in
    --app) APP="${2:?--app needs a path}"; shift 2 ;;
    --identity) IDENTITY="${2:?--identity needs a name}"; shift 2 ;;
    --keychain) KEYCHAIN="${2:?--keychain needs a path}"; shift 2 ;;
    --keychain-profile) KEYCHAIN_PROFILE="${2:?--keychain-profile needs a name}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) usage; fail "unknown option: $1" ;;
  esac
done
APP="${APP%/}"

case "$COMMAND" in
  sign) sign_app ;;
  notarize) notarize_app ;;
  verify) verify_app ;;
  all) sign_app; notarize_app; verify_app ;;
  -h|--help) usage ;;
  *) usage; fail "unknown command: $COMMAND" ;;
esac
