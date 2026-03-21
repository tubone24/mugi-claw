#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROFILE="$SCRIPT_DIR/mugi-claw.sb"
if [[ ! -f "$PROFILE" ]]; then
  echo "ERROR: Sandbox profile not found: $PROFILE" >&2
  exit 1
fi
if ! command -v sandbox-exec &>/dev/null; then
  echo "ERROR: sandbox-exec not found (macOS only)" >&2
  exit 1
fi
sandbox-exec -f "$PROFILE" "$@"
