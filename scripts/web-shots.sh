#!/bin/sh
# Screenshots for the web, from scripts/screenshots.sh's PNGs: 1600px WebPs
# for the guide (guide/public/shots/), and for the microsite's carousel the
# same plus full-size ones for its gallery (<name>-full.webp). Commit both.
#
#   sh scripts/web-shots.sh [screenshots dir]
set -e
cd "$(dirname "$0")/.."
IN=${1:-screenshots}
SITE=${MICROSITE:-../tarwin-apps-microsites}
command -v cwebp >/dev/null || { echo "Needs cwebp (brew install webp)." >&2; exit 1; }

mkdir -p guide/public/shots
for png in "$IN"/*.png; do
  name=$(basename "$png" .png)
  cwebp -quiet -q 82 -resize 1600 0 "$png" -o "guide/public/shots/$name.webp" 2>/dev/null
  # The microsite shows only some; refresh the ones it has.
  if [ -f "$SITE/tiny-tally/shots/$name.webp" ]; then
    cp "guide/public/shots/$name.webp" "$SITE/tiny-tally/shots/$name.webp"
    cwebp -quiet -q 80 "$png" -o "$SITE/tiny-tally/shots/$name-full.webp" 2>/dev/null
  fi
done
echo "Wrote guide/public/shots/ and refreshed $SITE/tiny-tally/shots/."
