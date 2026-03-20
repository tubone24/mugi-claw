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

# 安全なツールは承認不要
case "$TOOL_NAME" in
  ToolSearch|Read|Glob|Grep|WebSearch|WebFetch|NotebookEdit)
    exit 0
    ;;
esac

# スレッド情報を追加（環境変数から取得）
if [ -n "$APPROVAL_CHANNEL" ] && [ -n "$APPROVAL_THREAD_TS" ]; then
  # JSONにchannel/thread_ts情報を追加
  INPUT=$(echo "$INPUT" | sed 's/}$//')
  INPUT="${INPUT},\"approval_channel\":\"${APPROVAL_CHANNEL}\",\"approval_thread_ts\":\"${APPROVAL_THREAD_TS}\"}"
fi

# Send to approval server (11 min timeout - slightly longer than approval timeout)
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
