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

# Send to approval server (11 min timeout - slightly longer than approval timeout)
RESPONSE=$(curl -s --max-time 660 -X POST "$APPROVAL_URL" \
  -H 'Content-Type: application/json' \
  -d "$INPUT" 2>/dev/null)

# Check if curl succeeded
if [ $? -ne 0 ]; then
  echo "Approval server unreachable - denying" >&2
  exit 2
fi

# Check approval result
if echo "$RESPONSE" | grep -qE '"approved"\s*:\s*true'; then
  exit 0
else
  echo "Tool use denied by user" >&2
  exit 2
fi
