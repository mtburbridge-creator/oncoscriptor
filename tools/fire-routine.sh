#!/usr/bin/env sh
# Fire the OncoGenik Claude routine. Best effort: never fails the caller.
#   tools/fire-routine.sh "<hint text>"
# Needs ROUTINE_FIRE_URL and ROUTINE_FIRE_TOKEN in the environment.
[ -n "$ROUTINE_FIRE_URL" ] && [ -n "$ROUTINE_FIRE_TOKEN" ] || { echo "fire-routine: not configured, skipping"; exit 0; }
hint=$(printf '%s' "${1:-hermes}" | sed 's/"/\\"/g')
curl -sS -m 20 -X POST "$ROUTINE_FIRE_URL" \
  -H "Authorization: Bearer $ROUTINE_FIRE_TOKEN" \
  -H "anthropic-beta: experimental-cc-routine-2026-04-01" \
  -H "anthropic-version: 2023-06-01" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$hint\"}" >/dev/null && echo "fire-routine: fired ($hint)" || echo "fire-routine: fire failed, the routine will catch up"
exit 0
