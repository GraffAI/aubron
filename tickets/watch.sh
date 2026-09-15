#!/usr/bin/env bash
# Poll loop: runs the ticket checker on an interval, sleeping between passes.
# The Python checker fires the IFTTT webhook itself on a qualifying listing.
# This loop exits (so the agent is notified) once a candidate is found.
#
# Usage: tickets/watch.sh [interval_seconds]   (default 900 = 15 min)
set -u
cd "$(dirname "$0")"
INTERVAL="${1:-900}"
echo "watch.sh started $(date -u +%FT%TZ), interval=${INTERVAL}s"
while true; do
  out="$(python3 check_tickets.py 2>&1)"
  printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$(printf '%s\n' "$out" | tail -1)"
  if printf '%s\n' "$out" | grep -q "candidates found"; then
    printf '%s\n' "$out"
    echo "WATCH EXIT: candidate found, webhook fired."
    exit 0
  fi
  sleep "$INTERVAL"
done
