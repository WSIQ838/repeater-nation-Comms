#!/usr/bin/env bash
# Publishes one platform's entry of the in-app update feed: a small JSON file on the
# "dispatch-updates" release that the app's updater reads (see plugins.updater in
# src-tauri/tauri.conf.json). Usage: update-feed.sh <target-arch> <signature file> <download url>
# Runs only when the build was signed (TAURI_SIGNING_PRIVATE_KEY secret is set).
set -euo pipefail
NAME="$1"; SIG_FILE="$2"; URL="$3"
VERSION=$(node -p "require('./package.json').version")
FEED_TAG="dispatch-updates"
# A pre-release that is never marked latest, so the console's own update check (releases/latest) and the
# release list keep pointing at the real versions.
gh release view "$FEED_TAG" >/dev/null 2>&1 || \
  gh release create "$FEED_TAG" --prerelease --latest=false --title "Dispatch update feed" \
    --notes "Files the Repeater Nation Dispatch console reads to update itself. Download the console from the dispatch-v… releases instead." || true
SIG_FILE="$SIG_FILE" URL="$URL" VERSION="$VERSION" OUT="$NAME.json" node -e '
  const fs = require("fs");
  fs.writeFileSync(process.env.OUT, JSON.stringify({
    version: process.env.VERSION,
    notes: "Repeater Nation Dispatch " + process.env.VERSION,
    pub_date: new Date().toISOString(),
    url: process.env.URL,
    signature: fs.readFileSync(process.env.SIG_FILE, "utf8").trim(),
  }, null, 2));'
gh release upload "$FEED_TAG" "$NAME.json" --clobber
echo "Update feed $NAME.json -> $VERSION ($URL)"
