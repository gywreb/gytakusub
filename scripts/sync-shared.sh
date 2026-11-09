#!/usr/bin/env sh
# Thin wrapper; the logic lives in sync-shared.mjs (works on Windows too).
exec node "$(dirname "$0")/sync-shared.mjs"
