#!/bin/bash
# update-slack-status.sh
# Claude Code のレート制限情報を Slack ユーザーステータスに反映する
# statusline-command.sh からバックグラウンドで呼び出される
#
# 表示例: 5h: 45.0% (reset 14:30) | 7d: 20.0%

set -euo pipefail

# =========================================================
# Config
# =========================================================
CONFIG_DIR="${HOME}/.config/claude-slack-status"
CONFIG_FILE="${CONFIG_DIR}/config"
CACHE_FILE="/tmp/claude/statusline-usage-cache.json"
THROTTLE_FILE="/tmp/claude/slack-status-last-update"
LOG_FILE="/tmp/claude/slack-status.log"

# デフォルト値
MUGI_CLAW_DIR=""
UPDATE_INTERVAL=300  # 5分

# =========================================================
# 排他制御（mkdir ベースのロック: macOS/Linux 両対応）
# =========================================================
LOCK_DIR="/tmp/claude/slack-status.lock"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
    # 古いロックの除去（60秒以上前なら stale とみなす）
    if [ -d "$LOCK_DIR" ]; then
        lock_age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || stat -c %Y "$LOCK_DIR" 2>/dev/null || echo 0) ))
        if [ "$lock_age" -gt 60 ]; then
            rmdir "$LOCK_DIR" 2>/dev/null || true
            mkdir "$LOCK_DIR" 2>/dev/null || exit 0
        else
            exit 0
        fi
    else
        exit 0
    fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

# =========================================================
# Throttle check - 前回更新から十分な時間が経っていなければ即終了
# =========================================================
NOW=$(date +%s)
if [ -f "$THROTTLE_FILE" ]; then
    LAST_UPDATE=$(cat "$THROTTLE_FILE" 2>/dev/null || echo 0)
    DIFF=$((NOW - LAST_UPDATE))
    if [ "$DIFF" -lt "${UPDATE_INTERVAL}" ]; then
        exit 0
    fi
fi

# =========================================================
# Load config（source を避け、必要な変数のみ安全に読み取る）
# =========================================================
if [ ! -f "$CONFIG_FILE" ]; then
    exit 0
fi
while IFS='=' read -r key value; do
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    case "$key" in
        MUGI_CLAW_DIR)  MUGI_CLAW_DIR="$value" ;;
        UPDATE_INTERVAL) UPDATE_INTERVAL="$value" ;;
    esac
done < <(grep -E '^(MUGI_CLAW_DIR|UPDATE_INTERVAL)=' "$CONFIG_FILE" 2>/dev/null)

# Slack トークン取得: .env から SLACK_USER_TOKEN を読む
SLACK_USER_TOKEN=""
if [ -n "${MUGI_CLAW_DIR}" ] && [ -f "${MUGI_CLAW_DIR}/.env" ]; then
    SLACK_USER_TOKEN=$(grep '^SLACK_USER_TOKEN=' "${MUGI_CLAW_DIR}/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
fi

if [ -z "$SLACK_USER_TOKEN" ]; then
    echo "[$(date '+%H:%M:%S')] ERROR: SLACK_USER_TOKEN not found in ${MUGI_CLAW_DIR:-?}/.env" >> "$LOG_FILE" 2>/dev/null || true
    exit 0
fi

# =========================================================
# Read cache
# =========================================================
if [ ! -f "$CACHE_FILE" ]; then
    exit 0
fi

usage_data=$(cat "$CACHE_FILE" 2>/dev/null || true)
if [ -z "$usage_data" ] || ! echo "$usage_data" | jq -e '.five_hour' >/dev/null 2>&1; then
    exit 0
fi

# =========================================================
# Format status text
# =========================================================
five_hour_pct=$(echo "$usage_data" | jq -r '.five_hour.utilization // 0' | awk '{printf "%.1f", $1}')
five_hour_reset_iso=$(echo "$usage_data" | jq -r '.five_hour.resets_at // empty')
seven_day_pct=$(echo "$usage_data" | jq -r '.seven_day.utilization // 0' | awk '{printf "%.1f", $1}')

# リセット時刻をフォーマット（macOS / Linux 両対応）
reset_time=""
if [ -n "$five_hour_reset_iso" ] && [ "$five_hour_reset_iso" != "null" ]; then
    stripped="${five_hour_reset_iso%%.*}"
    stripped="${stripped%%Z}"
    stripped="${stripped%%+*}"
    epoch=""
    # GNU date (Linux)
    epoch=$(date -d "${five_hour_reset_iso}" +%s 2>/dev/null) || true
    # BSD date (macOS)
    if [ -z "$epoch" ]; then
        if [[ "$five_hour_reset_iso" == *"Z"* ]] || [[ "$five_hour_reset_iso" == *"+00:00"* ]]; then
            epoch=$(env TZ=UTC date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null) || true
        else
            epoch=$(date -j -f "%Y-%m-%dT%H:%M:%S" "$stripped" +%s 2>/dev/null) || true
        fi
    fi
    if [ -n "$epoch" ]; then
        reset_time=$(date -d "@$epoch" +"%H:%M" 2>/dev/null || date -j -r "$epoch" +"%H:%M" 2>/dev/null || true)
    fi
fi

# ステータステキスト組み立て: 5h: 45.0% (reset 14:30) | 7d: 20.0%
STATUS_TEXT="5h: ${five_hour_pct}%"
if [ -n "$reset_time" ]; then
    STATUS_TEXT="${STATUS_TEXT} (reset ${reset_time})"
fi
STATUS_TEXT="${STATUS_TEXT} | 7d: ${seven_day_pct}%"

# 使用率に応じた絵文字
five_hour_int=$(printf "%.0f" "$five_hour_pct" 2>/dev/null || echo 0)
if ! [[ "$five_hour_int" =~ ^[0-9]+$ ]]; then
    five_hour_int=0
fi
if [ "$five_hour_int" -le 30 ]; then
    STATUS_EMOJI=":large_green_circle:"
elif [ "$five_hour_int" -le 60 ]; then
    STATUS_EMOJI=":large_yellow_circle:"
else
    STATUS_EMOJI=":red_circle:"
fi

# =========================================================
# Update Slack status（jq で安全に JSON 構築、トークンはプロセス置換で隠蔽）
# =========================================================
payload=$(jq -n \
    --arg text "$STATUS_TEXT" \
    --arg emoji "$STATUS_EMOJI" \
    '{profile: {status_text: $text, status_emoji: $emoji, status_expiration: 0}}')

response=$(curl -s --max-time 10 -X POST "https://slack.com/api/users.profile.set" \
    -K <(printf -- '-H "Authorization: Bearer %s"' "$SLACK_USER_TOKEN") \
    -H "Content-type: application/json" \
    -d "$payload" \
    2>/dev/null || true)

# =========================================================
# ログ（サイズ制限付き: 100KB 超で切り詰め）
# =========================================================
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE" 2>/dev/null || echo 0)" -gt 102400 ]; then
    tail -50 "$LOG_FILE" > "${LOG_FILE}.tmp" && mv "${LOG_FILE}.tmp" "$LOG_FILE" 2>/dev/null || true
fi

if echo "$response" | jq -e '.ok == true' >/dev/null 2>&1; then
    echo "$NOW" > "$THROTTLE_FILE"
    echo "[$(date '+%H:%M:%S')] OK: ${STATUS_TEXT}" >> "$LOG_FILE" 2>/dev/null || true
else
    error=$(echo "$response" | jq -r '.error // "unknown"' 2>/dev/null || echo "parse_error")
    echo "[$(date '+%H:%M:%S')] FAIL: ${error}" >> "$LOG_FILE" 2>/dev/null || true
fi
