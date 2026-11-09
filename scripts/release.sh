#!/usr/bin/env sh
# Cut a release: bump manifest version, run tests, commit, tag, push.
# CI then builds the zip, creates the GitHub Release, and uploads to the Chrome Web Store.
# Usage: ./scripts/release.sh 1.0.1
set -e
cd "$(dirname "$0")/.."
v="$1"
case "$v" in *.*.*) ;; *) echo "usage: release.sh X.Y.Z"; exit 2;; esac
[ -z "$(git status --porcelain)" ] || { echo "working tree not clean — commit or stash first"; exit 1; }

node -e "
const fs=require('fs');const p='extension/manifest.json';const m=JSON.parse(fs.readFileSync(p));
m.version='$v';fs.writeFileSync(p,JSON.stringify(m,null,2)+'\n');"
./scripts/sync-shared.sh
for f in extension/*.js web/*.js; do node --check "$f"; done
( cd tests && [ -d node_modules ] || npm install --no-audit --no-fund >/dev/null; npm test )

git add -A
# nothing to commit when the version was already bumped in a pull request
[ -z "$(git status --porcelain)" ] || git commit -m "Release v$v"
git tag "v$v"
git push origin main "v$v"
echo "Pushed v$v — watch https://github.com/gywreb/gytakusub/actions"
