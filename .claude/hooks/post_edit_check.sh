#!/bin/bash
# PostToolUse hook (Edit|Write): typecheck + lint the edited file.
# Exit 2 feeds stderr back to Claude so it fixes the problem immediately.
set -u

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"

file_path=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))' 2>/dev/null)
[ -z "$file_path" ] && exit 0

errors=""

case "$file_path" in
  "$repo_root"/frontend/src/*.ts|"$repo_root"/frontend/src/*.tsx)
    cd "$repo_root/frontend" || exit 0
    out=$(npx tsc -b --noEmit 2>&1) || errors="TypeScript errors:
$out
"
    out=$(npx biome check "$file_path" 2>&1) || errors="${errors}Biome lint errors:
$out
"
    ;;
  "$repo_root"/frontend/src/*.css)
    cd "$repo_root/frontend" || exit 0
    out=$(npx biome check "$file_path" 2>&1) || errors="Biome lint errors:
$out
"
    ;;
  "$repo_root"/backend/*.py|"$repo_root"/storage/*.py)
    cd "$repo_root" || exit 0
    out=$("$repo_root/venv/bin/ruff" check "$file_path" 2>&1) || errors="Ruff lint errors:
$out
"
    ;;
esac

if [ -n "$errors" ]; then
  printf '%s' "$errors" >&2
  exit 2
fi
exit 0
