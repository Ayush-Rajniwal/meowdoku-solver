#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"
TOOLS="$PROJECT_ROOT/.tools"
export PATH="$TOOLS/node/bin:$TOOLS/platform-tools:$PATH"
CHECK_ONLY=0
case "${1:-}" in
  --check) CHECK_ONLY=1 ;;
  --help|-h) echo 'Usage: ./setup.sh [--check]'; echo 'Install project-local Node 24 and Android platform-tools when missing, then npm ci.'; exit 0 ;;
  '') ;;
  *) echo "Unknown option: $1" >&2; exit 1 ;;
esac
[[ $# -le 1 ]] || { echo 'Too many arguments' >&2; exit 1; }
fail() { echo "Setup: $*" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) NODE_OS=darwin; ADB_OS=darwin ;;
  Linux) NODE_OS=linux; ADB_OS=linux ;;
  *) fail 'setup.sh supports macOS and Linux. Windows: install Node 24+ and Android platform-tools, set ADB_PATH, then run npm ci and npm start.' ;;
esac
case "$(uname -m)" in
  arm64|aarch64) NODE_ARCH=arm64 ;;
  x86_64|amd64) NODE_ARCH=x64 ;;
  *) fail 'Unsupported CPU architecture; install Node 24+ and ADB manually.' ;;
esac

node_ready() { command -v node >/dev/null 2>&1 && node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' >/dev/null 2>&1 && command -v npm >/dev/null 2>&1 && npm --version >/dev/null 2>&1; }
ADB_BIN=''
if [[ -n "${ADB_PATH:-}" ]]; then
  ADB_BIN="$(command -v "$ADB_PATH" || true)"
  [[ -n "$ADB_BIN" && -x "$ADB_BIN" ]] || fail 'ADB_PATH does not point to an executable. Correct it or unset it.'
else
  adb_candidates=("$TOOLS/platform-tools/adb")
  if [[ -n "${ANDROID_HOME:-}" ]]; then adb_candidates+=("$ANDROID_HOME/platform-tools/adb"); fi
  if [[ -n "${ANDROID_SDK_ROOT:-}" ]]; then adb_candidates+=("$ANDROID_SDK_ROOT/platform-tools/adb"); fi
  for candidate in "${adb_candidates[@]}"; do
    if [[ -x "$candidate" ]]; then ADB_BIN="$candidate"; break; fi
  done
  if [[ -z "$ADB_BIN" ]]; then ADB_BIN="$(command -v adb || true)"; fi
fi
if [[ -n "$ADB_BIN" ]] && ! "$ADB_BIN" version >/dev/null 2>&1; then fail 'The selected ADB cannot run on this computer.'; fi

if [[ "$CHECK_ONLY" == 1 ]]; then
  missing=0
  if node_ready; then echo "Node: $(node --version); npm: $(npm --version)"; else echo 'Node 24+ and npm: missing'; missing=1; fi
  if [[ -n "$ADB_BIN" ]]; then echo "ADB: $ADB_BIN"; else echo 'ADB: missing'; missing=1; fi
  if [[ -f node_modules/tsx/package.json && -f node_modules/ink/package.json ]]; then echo 'Project dependencies: present'; else echo 'Project dependencies: missing'; missing=1; fi
  exit "$missing"
fi

if [[ -f runtime/loop.lock ]]; then
  controller_pid="$(sed -n 's/.*"pid"[[:space:]]*:[[:space:]]*\([0-9][0-9]*\).*/\1/p' runtime/loop.lock)"
  [[ "$controller_pid" =~ ^[1-9][0-9]*$ ]] || fail 'Invalid controller lock; inspect runtime/loop.lock first.'
  if kill -0 "$controller_pid" 2>/dev/null; then fail 'Stop the running controller before setup replaces dependencies. --check is safe while it runs.'; fi
fi
if [[ -z "$ADB_BIN" && "$NODE_OS" == linux && "$NODE_ARCH" != x64 ]]; then
  fail 'Google provides Linux platform-tools for x86_64. Install a native ADB using your Linux package manager, then rerun setup.'
fi
[[ ! -L "$TOOLS" ]] || fail 'Refusing to install into a symlinked .tools folder.'
mkdir -p "$TOOLS"
STAGING="$(mktemp -d "$TOOLS/.setup.XXXXXX")"
trap 'rm -rf -- "$STAGING"' EXIT
need() { command -v "$1" >/dev/null 2>&1 || fail "Missing prerequisite: $1. Install it with your OS package manager and rerun setup."; }
download() { curl --fail --location --retry 3 --connect-timeout 15 --max-time 600 --proto '=https' --tlsv1.2 --output "$2" "$1"; }

if ! node_ready; then
  need curl; need tar; need gzip; need awk
  if command -v shasum >/dev/null 2>&1; then HASHER=shasum; elif command -v sha256sum >/dev/null 2>&1; then HASHER=sha256sum; else fail 'Install shasum or sha256sum to verify the Node download.'; fi
  download 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' "$STAGING/SHASUMS256.txt"
  suffix="-$NODE_OS-$NODE_ARCH.tar.gz"
  archive="$(awk -v suffix="$suffix" '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-/ && substr($2,length($2)-length(suffix)+1)==suffix {print $2; exit}' "$STAGING/SHASUMS256.txt")"
  [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-[a-z0-9-]+\.tar\.gz$ ]] || fail 'No matching Node 24 binary found in the official checksum list.'
  node_version="${archive#node-}"; node_version="${node_version%%-$NODE_OS-*}"
  download "https://nodejs.org/dist/$node_version/$archive" "$STAGING/$archive"
  expected="$(awk -v name="$archive" '$2==name {print $1; exit}' "$STAGING/SHASUMS256.txt")"
  if [[ "$HASHER" == shasum ]]; then actual="$(shasum -a 256 "$STAGING/$archive" | awk '{print $1}')"; else actual="$(sha256sum "$STAGING/$archive" | awk '{print $1}')"; fi
  [[ "$actual" == "$expected" ]] || fail 'Node checksum mismatch; download was not installed.'
  tar -xzf "$STAGING/$archive" -C "$STAGING"
  extracted="$STAGING/${archive%.tar.gz}"
  [[ -x "$extracted/bin/node" && -f "$extracted/bin/npm" ]] || fail 'Node archive is incomplete.'
  "$extracted/bin/node" --version
  rm -rf -- "$TOOLS/node"
  mv -- "$extracted" "$TOOLS/node"
  hash -r
fi
node_ready || fail 'Node 24+ and npm could not run. Check OS compatibility with official Node binaries.'
echo "Using Node $(node --version) and npm $(npm --version)"

if [[ -z "$ADB_BIN" ]]; then
  need curl; need unzip
  download "https://dl.google.com/android/repository/platform-tools-latest-$ADB_OS.zip" "$STAGING/platform-tools.zip"
  unzip -tq "$STAGING/platform-tools.zip" >/dev/null
  unzip -q "$STAGING/platform-tools.zip" -d "$STAGING/adb"
  "$STAGING/adb/platform-tools/adb" version
  rm -rf -- "$TOOLS/platform-tools"
  mv -- "$STAGING/adb/platform-tools" "$TOOLS/platform-tools"
  ADB_BIN="$TOOLS/platform-tools/adb"
fi
echo "Using ADB: $ADB_BIN"
npm ci --include=dev --no-audit --no-fund
npm run typecheck
echo 'Setup complete. Run ./run.sh (or ./run.sh --pair for wireless pairing).'
