#!/bin/sh
# Screenshots of every part of the app, on fresh demo books (macOS):
#
#   sh scripts/screenshots.sh [out-dir]      # default: screenshots/
#
# Starts `tinyjs dev` with TINY_TALLY_TOUR set, so the app makes demo books
# in a temp folder and steps through its screens (src/lib/tour.ts). For
# each one it writes shot.json there; this captures the window as
# <out>/<name>.png and answers with done-<seq>. Your own books and recent
# list are left alone. Needs Screen Recording permission for the terminal.
# Stop any other `tinyjs dev` of this app first (one copy runs at a time).
set -e
cd "$(dirname "$0")/.."
OUT="${1:-screenshots}"
mkdir -p "$OUT"
TOUR="$(mktemp -d)"
swiftc -O scripts/window-id.swift -o "$TOUR/window-id" 2>/dev/null

TINY_TALLY_TOUR="$TOUR" tinyjs dev > "$TOUR/dev.log" 2>&1 &
DEV=$!
cleanup() {
  kill "$DEV" 2>/dev/null || true
  pkill -f "node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173" 2>/dev/null || true
}
trap cleanup EXIT

seen=0
for _ in $(seq 1 1800); do
  [ -f "$TOUR/finished" ] && break
  if [ -f "$TOUR/shot.json" ]; then
    seq=$(sed -n 's/.*"seq":\([0-9]*\).*/\1/p' "$TOUR/shot.json")
    name=$(sed -n 's/.*"name":"\([^"]*\)".*/\1/p' "$TOUR/shot.json")
    if [ -n "$seq" ] && [ "$seq" != "$seen" ]; then
      id=$("$TOUR/window-id" "Tiny Tally")
      if [ -z "$id" ]; then echo "no Tiny Tally window" >&2; exit 1; fi
      screencapture -x -o -l "$id" "$OUT/$name.png"
      echo "  $name"
      : > "$TOUR/done-$seq"
      seen=$seq
    fi
  fi
  sleep 0.2
done
[ -f "$TOUR/finished" ] || { echo "The tour didn't finish; see $TOUR/dev.log" >&2; exit 1; }
echo "Saved $(ls "$OUT"/*.png | wc -l | tr -d ' ') screenshots to $OUT/"
