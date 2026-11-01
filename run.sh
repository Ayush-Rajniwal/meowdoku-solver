#!/usr/bin/env bash
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"
export PATH="$PROJECT_ROOT/.tools/node/bin:$PROJECT_ROOT/.tools/platform-tools:$PATH"
if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo 'Node 24+ and npm are required. Run ./setup.sh first.' >&2
  exit 1
fi
if [[ ! -f node_modules/tsx/package.json ]]; then
  echo 'Project packages are missing. Run ./setup.sh first.' >&2
  exit 1
fi
exec npm start -- "$@"
