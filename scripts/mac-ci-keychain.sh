#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/mac-ci-keychain.sh <create|delete>

CI only. Needs RUNNER_TEMP.

  create   build a temporary keychain with a random password, import the Developer ID certificate into it
           and put it on the search list. Reads MACOS_CERTIFICATE_P12_BASE64, MACOS_CERTIFICATE_PASSWORD
           and MACOS_SIGNING_IDENTITY from the environment.
  delete   remove the keychain, the decoded certificate and the notarization scratch folders (safe to run twice)
EOF
}

: "${RUNNER_TEMP:?RUNNER_TEMP is not set; this script is for GitHub Actions runners}"
KEYCHAIN="$RUNNER_TEMP/lantern-signing.keychain-db"
CERTIFICATE="$RUNNER_TEMP/lantern-certificate.p12"
LOCK_TIMEOUT_SECONDS=21600

fail() {
  echo "mac-ci-keychain: $*" >&2
  exit 1
}

add_to_search_list() {
  local existing=() line
  while IFS= read -r line; do
    line="${line//\"/}"
    line="${line#"${line%%[![:space:]]*}"}"
    existing+=("$line")
  done < <(security list-keychains -d user)
  security list-keychains -d user -s "$KEYCHAIN" ${existing[@]+"${existing[@]}"}
}

create_keychain() {
  : "${MACOS_CERTIFICATE_P12_BASE64:?MACOS_CERTIFICATE_P12_BASE64 is not set}"
  : "${MACOS_CERTIFICATE_PASSWORD:?MACOS_CERTIFICATE_PASSWORD is not set}"
  : "${MACOS_SIGNING_IDENTITY:?MACOS_SIGNING_IDENTITY is not set}"
  local password
  password="$(openssl rand -base64 32)"
  echo "::add-mask::$password"
  trap 'rm -f "$CERTIFICATE"' EXIT
  (umask 077 && printf '%s' "$MACOS_CERTIFICATE_P12_BASE64" | base64 --decode > "$CERTIFICATE")
  security create-keychain -p "$password" "$KEYCHAIN"
  security set-keychain-settings -lut "$LOCK_TIMEOUT_SECONDS" "$KEYCHAIN"
  security unlock-keychain -p "$password" "$KEYCHAIN"
  security import "$CERTIFICATE" -P "$MACOS_CERTIFICATE_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN" > /dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$password" "$KEYCHAIN" > /dev/null
  add_to_search_list
  local identities
  identities="$(security find-identity -p codesigning "$KEYCHAIN")"
  grep -Fq "$MACOS_SIGNING_IDENTITY" <<< "$identities" || fail "the imported certificate does not provide the identity '$MACOS_SIGNING_IDENTITY'"
  echo "keychain ready: $KEYCHAIN"
}

delete_keychain() {
  security delete-keychain "$KEYCHAIN" 2> /dev/null || true
  rm -f "$CERTIFICATE"
  rm -rf "$RUNNER_TEMP"/lantern-notarize.*
}

case "${1:-}" in
  create) create_keychain ;;
  delete) delete_keychain ;;
  *) usage; exit 2 ;;
esac
