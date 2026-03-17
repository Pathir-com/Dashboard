#!/usr/bin/env bash
#
# sync-from-base44.sh — Extract a Base44 export and diff it against the live codebase.
#
# Usage:
#   ./scripts/sync-from-base44.sh path/to/export.zip
#
# What it does:
#   1. Extracts the Base44 zip into a temp directory
#   2. Finds all .jsx, .js, .css, .html files in the export
#   3. Tries to match each to a file in the live codebase
#   4. Shows a diff summary of what changed
#   5. Leaves the extracted files in .base44-import/ for manual review
#
# After running:
#   - Review the diffs in .base44-import/diffs/
#   - Port relevant changes into the real codebase
#   - The Base44 code is prototype-quality — never copy-paste wholesale
#   - Focus on: UI layout, class names, new components, copy text
#   - Ignore: data fetching (Base44 uses its own SDK), auth, API calls

set -euo pipefail

ZIP="${1:?Usage: $0 path/to/export.zip}"
LIVE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
IMPORT_DIR="$LIVE_DIR/.base44-import"
DIFF_DIR="$IMPORT_DIR/diffs"

# Clean previous import
rm -rf "$IMPORT_DIR"
mkdir -p "$IMPORT_DIR/extracted" "$DIFF_DIR"

echo "==> Extracting $ZIP..."
unzip -q "$ZIP" -d "$IMPORT_DIR/extracted"

# Find all source files in the export
echo "==> Scanning for source files..."
find "$IMPORT_DIR/extracted" -type f \( -name '*.jsx' -o -name '*.js' -o -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.html' \) | sort > "$IMPORT_DIR/file-list.txt"

FILE_COUNT=$(wc -l < "$IMPORT_DIR/file-list.txt")
echo "   Found $FILE_COUNT source files in export"

# Try to match each file to something in the live codebase
MATCHED=0
NEW=0
echo ""
echo "==> Matching files..."
echo "------------------------------------------------------------"

while IFS= read -r export_file; do
  basename=$(basename "$export_file")

  # Look for a match in the live codebase
  live_match=$(find "$LIVE_DIR/src" "$LIVE_DIR/public" -name "$basename" 2>/dev/null | head -1)

  if [ -n "$live_match" ]; then
    MATCHED=$((MATCHED + 1))
    rel_live="${live_match#$LIVE_DIR/}"
    rel_export="${export_file#$IMPORT_DIR/extracted/}"

    # Generate diff
    diff_file="$DIFF_DIR/${basename}.diff"
    if diff -u "$live_match" "$export_file" > "$diff_file" 2>/dev/null; then
      echo "  SAME  $rel_live"
      rm "$diff_file"  # no diff needed
    else
      lines=$(wc -l < "$diff_file")
      echo "  DIFF  $rel_live  ($lines lines changed) → $diff_file"
    fi
  else
    NEW=$((NEW + 1))
    rel_export="${export_file#$IMPORT_DIR/extracted/}"
    echo "  NEW   $rel_export  (no match in codebase)"
    # Copy to a "new files" area
    mkdir -p "$DIFF_DIR/new"
    cp "$export_file" "$DIFF_DIR/new/"
  fi
done < "$IMPORT_DIR/file-list.txt"

echo "------------------------------------------------------------"
echo ""
echo "==> Summary:"
echo "   $MATCHED matched files ($( ls "$DIFF_DIR"/*.diff 2>/dev/null | wc -l ) with diffs)"
echo "   $NEW new files (in $DIFF_DIR/new/)"
echo ""
echo "==> Next steps:"
echo "   1. Review diffs:  ls $DIFF_DIR/"
echo "   2. Port changes into the real codebase (don't copy Base44 SDK calls)"
echo "   3. Test:  npx vite build"
echo "   4. Commit and push"
echo ""
echo "   Extracted files are in: $IMPORT_DIR/extracted/"
echo "   Clean up when done:     rm -rf $IMPORT_DIR"
