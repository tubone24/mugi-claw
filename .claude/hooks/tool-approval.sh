#!/bin/bash
# PreToolUse hook: Slackでツール承認を求める
# stdin: JSON { hook_event_name, tool_name, tool_input, session_id, ... }
# exit 0 = 承認, exit 2 = 拒否

# Slack bot context でなければ即座に許可
if [ "$MUGI_CLAW_APPROVAL" != "1" ]; then
  exit 0
fi

APPROVAL_PORT="${APPROVAL_PORT:-3456}"
APPROVAL_URL="http://127.0.0.1:${APPROVAL_PORT}/api/approval"

# Read tool info from stdin
INPUT=$(cat)

# ツール名を取得
TOOL_NAME=$(echo "$INPUT" | grep -o '"tool_name"\s*:\s*"[^"]*"' | head -1 | sed 's/.*"tool_name"\s*:\s*"//' | sed 's/"//')

# 低リスクツールは承認不要で自動許可
case "$TOOL_NAME" in
  # Claude内部ツール（読み取り系）
  ToolSearch|Read|Glob|Grep|WebSearch|WebFetch|NotebookEdit)
    exit 0
    ;;
  # デスクトップ（読み取り・情報取得・待機系）
  mcp__desktop__desktop_screenshot|mcp__desktop__desktop_get_screen_info|mcp__desktop__desktop_wait|mcp__desktop__desktop_mouse_move)
    exit 0
    ;;
  # ブラウザ（読み取り系）
  mcp__browser__browser_screenshot|mcp__browser__browser_get_text|mcp__browser__browser_wait|mcp__browser__browser_navigate|mcp__browser__browser_evaluate)
    exit 0
    ;;
esac

# スレッド情報を追加（環境変数から取得）
if [ -n "$APPROVAL_CHANNEL" ] && [ -n "$APPROVAL_THREAD_TS" ]; then
  INPUT=$(echo "$INPUT" | sed 's/}$//')
  INPUT="${INPUT},\"approval_channel\":\"${APPROVAL_CHANNEL}\",\"approval_thread_ts\":\"${APPROVAL_THREAD_TS}\"}"
fi

# Send to approval server (11 min timeout)
RESPONSE=$(curl -s --max-time 660 -X POST "$APPROVAL_URL" \
  -H 'Content-Type: application/json' \
  -d "$INPUT" 2>/dev/null)

CURL_EXIT=$?
if [ $CURL_EXIT -ne 0 ]; then
  echo "Approval server unreachable (exit=$CURL_EXIT) - denying" >&2
  exit 2
fi

# Check approval result
if echo "$RESPONSE" | grep -qE '"approved"\s*:\s*true'; then
  exit 0
else
  echo "Tool use denied by user" >&2
  exit 2
fi
