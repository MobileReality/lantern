#!/bin/sh
port="${1:-31337}"
token_file="${2:-}"
token=""
if [ -n "$token_file" ] && [ -f "$token_file" ]; then
  token="$(tr -d '\r\n' < "$token_file" 2>/dev/null)"
fi
if [ -n "$token" ] && command -v curl >/dev/null 2>&1; then
  curl --silent --max-time 1 --connect-timeout 1 --output /dev/null \
    --request POST "http://127.0.0.1:${port}/codex/event" \
    --header 'Content-Type: application/json' \
    --header @/dev/fd/3 \
    --data-binary @- 2>/dev/null 3<<HEADER || true
X-Lantern-Codex-Token: ${token}
HEADER
else
  cat >/dev/null 2>&1 || true
fi
printf '{}\n'
exit 0
