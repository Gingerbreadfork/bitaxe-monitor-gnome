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

require_cmd python3
require_cmd glib-compile-schemas
require_cmd zip

uuid="$(python3 - <<'PY'
import json
with open("metadata.json", "r", encoding="utf-8") as f:
    print(json.load(f)["uuid"])
PY
)"

schema_dir="$ROOT/schemas"
if [ -d "$schema_dir" ]; then
  glib-compile-schemas "$schema_dir"
fi

dist_dir="$ROOT/dist"
mkdir -p "$dist_dir"
zip_path="$dist_dir/${uuid}.zip"
rm -f "$zip_path"

include_paths=()
for p in metadata.json extension.js prefs.js stylesheet.css schemas icons; do
  if [ -e "$p" ]; then
    include_paths+=("$p")
  fi
done

if [ ! -f metadata.json ]; then
  echo "Error: metadata.json not found in $ROOT" >&2
  exit 1
fi
if [ ! -f extension.js ]; then
  echo "Error: extension.js not found in $ROOT" >&2
  exit 1
fi

zip -r -9 "$zip_path" "${include_paths[@]}"
echo "Created: $zip_path"
