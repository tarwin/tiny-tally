#!/bin/bash
# Package Tiny Tally for Linux. Runs INSIDE an ubuntu:22.04 container: the
# linker bakes the build machine's glibc into the binaries, and 22.04 keeps
# that at 2.35 so the tarball loads on Ubuntu 22.04 / Debian 12 and newer.
# Adapted from tinyjsapp-examples/shelf/pkg-linux-container.sh.
#
#   docker run --rm -v $PWD:/src:ro -v $OUT:/work -e TINYJS_TAG=v0.68.0 \
#     ubuntu:22.04 bash /src/scripts/pkg-linux-container.sh
#
# Output: /work/out/tiny-tally-<ver>-linux-<arch>.tar.gz
set -euo pipefail
: "${TINYJS_TAG:?set TINYJS_TAG to the tinyjs release to build against (e.g. v0.68.0)}"

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  ca-certificates curl git xz-utils build-essential pkg-config binutils \
  libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev \
  libx11-dev libxtst-dev libpipewire-0.3-dev >/dev/null

ARCH=$(uname -m); case "$ARCH" in aarch64) ARCH=arm64;; esac

# Node and pnpm are build tools only: nothing they produce is a native
# binary, so they can't raise the glibc floor of what ships.
NODE_ARCH=$ARCH; [ "$ARCH" = x86_64 ] && NODE_ARCH=x64
curl -fsSL "https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-$NODE_ARCH.tar.xz" \
  | tar -xJ -C /usr/local --strip-components=1
npm install -g --silent "pnpm@$(node -p "require('/src/package.json').packageManager.split('@')[1]")"

cd /work && rm -rf tinyjsapp app out && mkdir -p out
git clone -q --depth 1 --branch "$TINYJS_TAG" https://github.com/tarwin/tinyjsapp.git
(cd tinyjsapp && TINYJS_TJS_RELEASE="$TINYJS_TAG" ./setup.sh >/dev/null)

floor_ok() { # <binary>: glibc floor must stay <= 2.35 (Ubuntu 22.04)
  local top; top=$(objdump -T "$1" | grep -o 'GLIBC_[0-9.]*' | sort -uV | tail -1)
  case "$top" in GLIBC_2.3[0-5]|GLIBC_2.[12]*) return 0;; *) echo "FLOOR REGRESSION: $1 needs $top"; return 1;; esac
}
floor_ok tinyjsapp/bin/tjs && floor_ok tinyjsapp/native/launcher-linux

# A clean copy without the host's node_modules (their native bindings are
# for the host platform).
mkdir app && (cd /src && tar --exclude=./node_modules --exclude=./dist --exclude=./.build -cf - .) | tar -xf - -C app
cd app
pnpm install --frozen-lockfile --reporter=silent
/work/tinyjsapp/tinyjs publish

tb=$(ls dist/publish/*-linux-$ARCH.tar.gz)
name=$(basename "$tb" | sed 's/-[0-9].*//')
# Check what actually landed in the tarball, not just the toolchain.
rm -rf /tmp/tc && mkdir /tmp/tc && tar -xzf "$tb" -C /tmp/tc
floor_ok "/tmp/tc/$name/$name"
floor_ok "/tmp/tc/$name/launcher"
cp "$tb" /work/out/
echo "packaged: $(basename "$tb")"
