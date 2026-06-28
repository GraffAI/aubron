#!/usr/bin/env bash
#
# Populate assets/flags/ from the ReffPixels pixel-art flag pack.
#
# The pack is CC-BY 4.0 — usable but NOT redistributable — so the PNGs are kept
# out of git (see assets/flags/.gitignore). Run this once on each machine with
# your own copy of the pack to drop the native 12×8 and 24×16 flags into place.
# Without them the app still runs, falling back to the hand-coded DSL flags.
#
# Usage:
#   ./deploy/install-flags.sh ~/Downloads/Flag_Assets_by_ReffPixels_v2.zip
#   ./deploy/install-flags.sh /path/to/extracted/pack/
set -euo pipefail

SRC="${1:?usage: install-flags.sh <path-to-ReffPixels-pack-or-.zip>}"
PKG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$PKG_DIR/assets/flags"

cleanup=""
if [[ "$SRC" == *.zip ]]; then
  cleanup="$(mktemp -d)"
  unzip -q "$SRC" -d "$cleanup"
  SRC="$cleanup"
fi

f12="$(find "$SRC" -type d -name 'rectangle_12x8' | head -1)"
f24="$(find "$SRC" -type d -name 'rectangle_24x16' | head -1)"
f48="$(find "$SRC" -type d -name 'rectangle_48x32' | head -1)"
if [ -z "$f12" ] || [ -z "$f24" ] || [ -z "$f48" ]; then
  echo "error: couldn't find rectangle_12x8 / 24x16 / 48x32 under $SRC" >&2
  exit 1
fi

mkdir -p "$DEST/12x8" "$DEST/24x16" "$DEST/48x32"
cp "$f12/"*.png "$DEST/12x8/"
cp "$f24/"*.png "$DEST/24x16/"
cp "$f48/"*.png "$DEST/48x32/"
[ -f "$SRC/LICENCE.txt" ] && cp "$SRC/LICENCE.txt" "$DEST/LICENCE.txt" || true

echo "Installed $(ls "$DEST/12x8" | wc -l | tr -d ' ') flags into $DEST/{12x8,24x16,48x32}"
[ -n "$cleanup" ] && rm -rf "$cleanup" || true
