#!/usr/bin/env sh
# bubble.js, typeset.js and prompt.js are shared; the copies under extension/ are canonical.
set -e
cd "$(dirname "$0")/.."
for f in bubble.js typeset.js prompt.js; do cp "extension/$f" "web/$f"; done
cp extension/icons/icon*.png web/icons/
mkdir -p web/fonts && cp extension/fonts/* web/fonts/
echo "synced shared files into web/"
