#!/usr/bin/env sh
# Release what is on main: the same as `node scripts/release.mjs` (kept for Unix shells).
# Versions are bumped in pull requests (scripts/check-version.mjs); this only checks, tests and tags.
exec node "$(dirname "$0")/release.mjs" "$@"
