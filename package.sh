#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Error: missing required command: $1" >&2
    exit 1
  fi
}

require_cmd gnome-extensions
require_cmd python3

uuid="$(python3 - <<'PY'
import json
with open("metadata.json", "r", encoding="utf-8") as f:
    print(json.load(f)["uuid"])
PY
)"

dist_dir="$ROOT/dist"
mkdir -p "$dist_dir"
bundle_path="$dist_dir/${uuid}.shell-extension.zip"
legacy_path="$dist_dir/${uuid}.zip"
rm -f "$bundle_path" "$legacy_path"

if [ ! -f metadata.json ]; then
  echo "Error: metadata.json not found in $ROOT" >&2
  exit 1
fi
if [ ! -f extension.js ]; then
  echo "Error: extension.js not found in $ROOT" >&2
  exit 1
fi

gnome-extensions pack -f -o "$dist_dir" "$ROOT"

if [ ! -f "$bundle_path" ]; then
  echo "Error: expected bundle not found: $bundle_path" >&2
  exit 1
fi

echo "Created: $bundle_path"
