#!/bin/sh
# Builds the user guide (guide/) and publishes it on the microsite, at
# apps.tarwin.art/tiny-tally/docs/: the build replaces tiny-tally/docs/ in
# the microsite repo, which is committed and pushed. Part of a release
# (RELEASING.md); --no-push stops after the commit.
#
#   sh scripts/publish-docs.sh [--no-push]
#
# The microsite repo is ../tarwin-apps-microsites unless MICROSITE says.
set -e
cd "$(dirname "$0")/.."
SITE=${MICROSITE:-../tarwin-apps-microsites}
VERSION=$(node -p "require('./package.json').version")

[ -d "$SITE/.git" ] || { echo "No microsite repo at $SITE (set MICROSITE)." >&2; exit 1; }
if [ -n "$(git -C "$SITE" status --porcelain)" ]; then
  echo "The microsite has uncommitted changes; commit or stash them first." >&2
  exit 1
fi
git -C "$SITE" pull --ff-only --quiet

pnpm exec vitepress build guide
mkdir -p "$SITE/tiny-tally/docs"
rsync -a --delete guide/.vitepress/dist/ "$SITE/tiny-tally/docs/"

git -C "$SITE" add -A tiny-tally/docs
if git -C "$SITE" diff --cached --quiet; then
  echo "The docs haven't changed."
else
  git -C "$SITE" commit --quiet -m "Tiny Tally docs for $VERSION"
  echo "Committed the docs for $VERSION to $SITE."
fi
if [ "$1" != "--no-push" ]; then
  git -C "$SITE" push --quiet
  echo "Pushed: https://apps.tarwin.art/tiny-tally/docs/"
fi
