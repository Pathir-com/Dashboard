#!/usr/bin/env bash
#
# deploy-to-base44.sh — Build the live app and deploy to Base44 hosting.
#
# Usage:
#   ./scripts/deploy-to-base44.sh
#
# Prerequisites:
#   - base44 CLI installed (npm install -g base44)
#   - Logged in (base44 login)
#   - Pathir project ejected at ../base44-pathir/
#
# What it does:
#   1. Builds the live app with Vite
#   2. Copies dist/ to the ejected Base44 project
#   3. Deploys to Base44 hosting via `base44 site deploy`

set -euo pipefail

LIVE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
BASE44_DIR="$LIVE_DIR/../base44-pathir"

if [ ! -d "$BASE44_DIR/base44" ]; then
  echo "Error: Base44 Pathir project not found at $BASE44_DIR"
  echo "Run: base44 eject --path $BASE44_DIR  (select Pathir)"
  exit 1
fi

echo "==> Building live app..."
cd "$LIVE_DIR"
npx vite build

echo ""
echo "==> Copying build to Base44 project..."
rm -rf "$BASE44_DIR/dist"
cp -r "$LIVE_DIR/dist" "$BASE44_DIR/dist"

echo ""
echo "==> Deploying to Base44..."
cd "$BASE44_DIR"
base44 site deploy -y

echo ""
echo "==> Done! Base44 preview is now in sync with the live codebase."
