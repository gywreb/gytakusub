#!/usr/bin/env sh
# Build the Chrome Web Store upload: the extension folder only, no dev files.
# Paths are absolute: zip runs inside a temporary copy, and a relative output path would point there.
# (2.2.0's release failed on the ubuntu-26.04 runner when the output path was rebuilt from $OLDPWD.)
set -eu
root=$(cd "$(dirname "$0")/.." && pwd -P)
v=$(node -p "require('$root/extension/manifest.json').version")
out="$root/dist/gytakusub-extension-$v.zip"
mkdir -p "$root/dist"
rm -f "$out"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cp -r "$root/extension" "$tmp/gytakusub"
rm -f "$tmp/gytakusub/icons/icon512.png"   # listing asset, not needed inside the package
find "$tmp/gytakusub" -name ".DS_Store" -delete
(cd "$tmp/gytakusub" && zip -rq "$out" .)
echo "built dist/$(basename "$out")"; unzip -l "$out" | tail -1
