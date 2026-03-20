#!/bin/bash
# guard-bash.sh — PreToolUse:Bash フック
# 1. プロジェクトディレクトリ外のファイル削除をブロック
# 2. .env ファイルへのアクセスをブロック
#
# Claude Code の PreToolUse フックとして実行される
# 環境変数 TOOL_INPUT にツール入力(JSON)が渡される
# exit 0 = 許可, exit 2 = ブロック（stderrにメッセージ）

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# TOOL_INPUT から command を抽出
if command -v jq &>/dev/null; then
  COMMAND=$(echo "$TOOL_INPUT" | jq -r '.command // empty')
else
  COMMAND=$(echo "$TOOL_INPUT" | grep -oP '"command"\s*:\s*"\\K[^"]*' || true)
fi

if [ -z "$COMMAND" ]; then
  exit 0
fi

# .env ファイルへのアクセスをブロック（cat, head, tail, less, more, vi, nano, sed, awk, source, . 等）
if echo "$COMMAND" | grep -qE '(^|\s|/)(\.env(\.[a-zA-Z0-9_]*)?)([\s;|&]|$)'; then
  echo "BLOCKED: .env ファイルへのアクセスは禁止されているわん！" >&2
  exit 2
fi

# プロジェクトディレクトリ外の削除をブロック
check_dangerous() {
  local cmd="$1"

  if ! echo "$cmd" | grep -qE '\b(rm|unlink|rmdir|shred)\b'; then
    return 0
  fi

  echo "$cmd" | tr ';' '\n' | tr '&' '\n' | tr '|' '\n' | while IFS= read -r segment; do
    segment=$(echo "$segment" | xargs)
    [ -z "$segment" ] && continue

    if echo "$segment" | grep -qE '^\s*(sudo\s+)?(rm|unlink|rmdir|shred)\b'; then
      local paths
      paths=$(echo "$segment" | grep -oE '(^|\s)/[^\s]+' | xargs || true)
      paths="$paths $(echo "$segment" | grep -oE '(^|\s)~[^\s]*' | xargs || true)"
      paths="$paths $(echo "$segment" | grep -oE '(^|\s)\.\.[^\s]*' | xargs || true)"

      for p in $paths; do
        [ -z "$p" ] && continue
        p="${p/#\~/$HOME}"
        if [[ "$p" != /* ]]; then
          p="$(pwd)/$p"
        fi
        p=$(cd "$(dirname "$p")" 2>/dev/null && echo "$(pwd)/$(basename "$p")" || echo "$p")

        if [[ "$p" != "${PROJECT_DIR}"* ]]; then
          echo "BLOCKED: プロジェクトディレクトリ外のファイル削除は禁止されているわん！ path=$p" >&2
          exit 2
        fi
      done
    fi
  done
}

check_dangerous "$COMMAND"
