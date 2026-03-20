#!/bin/bash
# guard-file-access.sh — PreToolUse:Read,Write,Edit フック
# .env ファイルの読み取り・書き込み・編集をブロック
#
# Claude Code の PreToolUse フックとして実行される
# 環境変数 TOOL_INPUT にツール入力(JSON)が渡される
# exit 0 = 許可, exit 2 = ブロック（stderrにメッセージ）

set -euo pipefail

# TOOL_INPUT から file_path を抽出
if command -v jq &>/dev/null; then
  FILE_PATH=$(echo "$TOOL_INPUT" | jq -r '.file_path // .path // empty')
else
  FILE_PATH=$(echo "$TOOL_INPUT" | grep -oP '"file_path"\s*:\s*"\\K[^"]*' || true)
  if [ -z "$FILE_PATH" ]; then
    FILE_PATH=$(echo "$TOOL_INPUT" | grep -oP '"path"\s*:\s*"\\K[^"]*' || true)
  fi
fi

if [ -z "$FILE_PATH" ]; then
  exit 0
fi

# ファイル名を取得
BASENAME=$(basename "$FILE_PATH")

# .env* ファイルかチェック（.env, .env.local, .env.production, etc.）
if echo "$BASENAME" | grep -qE '^\.(env)(\..+)?$'; then
  echo "BLOCKED: .env ファイルへのアクセスは禁止されているわん！ path=$FILE_PATH" >&2
  exit 2
fi

exit 0
