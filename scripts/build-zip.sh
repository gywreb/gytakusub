#!/usr/bin/env sh
# Build the Chrome Web Store upload: the extension folder only, no dev files.
set -e
cd "$(dirname "$0")/.."
v=$(node -p "require('./extension/manifest.json').version")
mkdir -p dist
out="dist/gytakusub-extension-$v.zip"
rm -f "$out"
tmp=$(mktemp -d)
cp -r extension "$tmp/gytakusub"
rm -f "$tmp/gytakusub/icons/icon512.png"   # listing asset, not needed inside the package
find "$tmp/gytakusub" -name ".DS_Store" -delete
(cd "$tmp/gytakusub" && zip -rq "$OLDPWD/$out" .)
rm -rf "$tmp"
echo "built $out"; unzip -l "$out" | tail -1
