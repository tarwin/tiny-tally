#!/bin/sh
# Build, notarize and stage the macOS release, one CPU at a time:
#
#   sh scripts/release-mac.sh [arm64] [x86_64]     # no arch = both
#
# Needs TINYJS_SIGN_IDENTITY (a Developer ID) and TINYJS_NOTARY_PROFILE.
# Per arch it leaves in dist/release/:
#   tiny-tally-<ver>-macos-<arch>.dmg   the download
#   tiny-tally-<ver>-macos-<arch>.zip   the stapled .app, for updates
# The zip is made from the STAPLED app rather than by `tinyjs publish`,
# which rebuilds (and so re-signs) the bundle after notarization.
# Adapted from tinyjsapp-examples/shelf/release-mac.sh.
set -e
cd "$(dirname "$0")/.."
: "${TINYJS_SIGN_IDENTITY:?set TINYJS_SIGN_IDENTITY}"
: "${TINYJS_NOTARY_PROFILE:?set TINYJS_NOTARY_PROFILE}"
ARCHS="${*:-arm64 x86_64}"
TINYJS="${TINYJS:-tinyjs}"
field() { sed -n "s/^ *\"$1\": *\"\([^\"]*\)\".*/\1/p" tinyjs.json | head -1; }
VER="$(field version)"
NAME="$(field name)"
TITLE="$(field title)"; TITLE="${TITLE:-$NAME}"
OUT=dist/release
mkdir -p "$OUT.tmp"
for ARCH in $ARCHS; do
  echo "==> $NAME $VER ($ARCH)"
  "$TINYJS" build --arch "$ARCH" --dmg
  "$TINYJS" notarize --arch "$ARCH" --dmg
  xcrun stapler validate -q "dist/$TITLE.app"
  cp "dist/$NAME-$VER-macos-$ARCH.dmg" "$OUT.tmp/"
  rm -f "$OUT.tmp/$NAME-$VER-macos-$ARCH.zip"
  ditto -c -k --keepParent "dist/$TITLE.app" "$OUT.tmp/$NAME-$VER-macos-$ARCH.zip"
  echo "    staged $NAME-$VER-macos-$ARCH.{dmg,zip}"
done
# Each build empties dist/, so the staged files wait outside it until the end.
mkdir -p "$OUT" && mv "$OUT.tmp"/* "$OUT"/ && rmdir "$OUT.tmp"
ls -la "$OUT"
