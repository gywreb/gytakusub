#!/usr/bin/env sh
# The engine, vendored libraries, prompt and text modules are shared between the
# extension and the web app; the copies under extension/ are canonical.
set -e
cd "$(dirname "$0")/.."
for f in prompt.js text.js; do cp "extension/$f" "web/$f"; done
rm -rf web/engine web/vendor
cp -R extension/engine web/engine
cp -R extension/vendor web/vendor
cp extension/icons/icon*.png web/icons/
mkdir -p web/fonts && cp extension/fonts/* web/fonts/
echo "synced shared files into web/"
