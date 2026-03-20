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

# ツール名を取得（macOS BSD grep/sed 互換）
TOOL_NAME=$(echo "$INPUT" | grep -oE '"tool_name" *: *"[^"]+"' | head -1 | sed 's/"tool_name" *: *"//' | sed 's/"//')

# --- 自動承認ルール ---
case "$TOOL_NAME" in
  # Claude内部ツール（読み取り系）
  ToolSearch|Read|Glob|Grep|WebSearch|WebFetch|NotebookEdit)
    exit 0
    ;;
  # デスクトップ（読み取り・情報取得・待機・移動系）
  mcp__desktop__desktop_screenshot|mcp__desktop__desktop_get_screen_info|mcp__desktop__desktop_wait|mcp__desktop__desktop_mouse_move)
    exit 0
    ;;
  # ブラウザ（読み取り・遷移系）
  mcp__browser__browser_screenshot|mcp__browser__browser_get_text|mcp__browser__browser_wait|mcp__browser__browser_navigate|mcp__browser__browser_evaluate)
    exit 0
    ;;
  # Bashコマンド（内容で判定）
  Bash)
    # コマンド内容を取得
    BASH_CMD=$(echo "$INPUT" | grep -oE '"command" *: *"[^"]*"' | head -1 | sed 's/"command" *: *"//' | sed 's/"$//')

    # 危険なコマンドパターン（これに該当したら承認を求める）
    if echo "$BASH_CMD" | grep -qE '(^| )(sudo |rm |rm$|rmdir |mv |chmod |chown |kill |pkill |killall )'; then
      break  # 承認フローへ
    fi
    if echo "$BASH_CMD" | grep -qE '(git (push|commit|reset|rebase|merge|checkout \.|restore \.))|( --force| -f$)'; then
      break
    fi
    if echo "$BASH_CMD" | grep -qE '(npm (install|uninstall|run)|brew (install|uninstall|remove)|pip (install|uninstall))'; then
      break
    fi
    if echo "$BASH_CMD" | grep -qE '(launchctl |shutdown |reboot )'; then
      break
    fi
    # 上記に該当しなければ自動承認（read系・情報取得系）
    exit 0
    ;;
  # Write/Editは常に承認が必要
  Write|Edit)
    break
    ;;
esac

# --- 承認が必要なツール: Slackで承認を求める ---
# 高リスク:
#   デスクトップ: click, right_click, double_click, type, key, hotkey, scroll, open_app
#   ブラウザ: click, type
#   Bash: 危険コマンド
#   Write, Edit

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
if echo "$RESPONSE" | grep -qE '"approved" *: *true'; then
  exit 0
else
  echo "Tool use denied by user" >&2
  exit 2
fi
