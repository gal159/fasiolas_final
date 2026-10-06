#!/bin/bash
# SessionStart hook: debesu sesijoje paruosia projekta (priklausomybes serveryje ir kliente).
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-.}"

for dir in server client; do
  if [ -f "$dir/package.json" ]; then
    (cd "$dir" && npm install --no-audit --no-fund)
  fi
done
