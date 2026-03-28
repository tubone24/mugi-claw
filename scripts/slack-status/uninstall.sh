#!/bin/bash
# uninstall.sh
# Claude Code Slack Status Integration の削除

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Claude Code Slack Status Uninstaller ==="
echo ""

# =========================================================
# Slack ステータスクリア（config 削除前に実行）
# =========================================================
read -r -p "Slack ステータスもクリアしますか？ (y/N): " confirm
if [[ "$confirm" =~ ^[yY]$ ]]; then
    TOKEN=""
    if [ -f "$PROJECT_DIR/.env" ]; then
        TOKEN=$(grep '^SLACK_USER_TOKEN=' "$PROJECT_DIR/.env" 2>/dev/null | head -1 | cut -d'=' -f2- | tr -d '"' | tr -d "'" || true)
    fi
    if [ -n "$TOKEN" ]; then
        payload=$(jq -n '{profile: {status_text: "", status_emoji: "", status_expiration: 0}}')
        curl -s --max-time 10 -X POST "https://slack.com/api/users.profile.set" \
            -K <(printf -- '-H "Authorization: Bearer %s"' "$TOKEN") \
            -H "Content-type: application/json" \
            -d "$payload" \
            >/dev/null 2>&1 || true
        echo "[OK] Slack status cleared"
    else
        echo "[!!] SLACK_USER_TOKEN not found. Clear status manually."
    fi
fi

echo ""

# =========================================================
# statusline-command.sh からパッチ除去
# =========================================================
STATUSLINE="${HOME}/.claude/statusline-command.sh"
MARKER="# >>> SLACK STATUS UPDATE >>>"
END_MARKER="# <<< SLACK STATUS UPDATE <<<"

if [ -f "$STATUSLINE" ] && grep -q "$MARKER" "$STATUSLINE"; then
    # awk で安全にマーカー間を削除（sed の互換性問題を回避）
    awk -v start="$MARKER" -v end="$END_MARKER" '
        $0 ~ start { skip=1; next }
        $0 ~ end   { skip=0; next }
        !skip
    ' "$STATUSLINE" > "${STATUSLINE}.tmp"
    # 末尾の空行を除去
    awk 'NR==FNR{last=NR; next} FNR<=last' <(
        awk '/[^[:space:]]/{last=NR} END{print last}' "${STATUSLINE}.tmp"
    ) "${STATUSLINE}.tmp" > "${STATUSLINE}.tmp2" 2>/dev/null || cp "${STATUSLINE}.tmp" "${STATUSLINE}.tmp2"
    mv "${STATUSLINE}.tmp2" "$STATUSLINE"
    rm -f "${STATUSLINE}.tmp"
    echo "[OK] statusline patch removed"
else
    echo "[--] statusline patch not found (skip)"
fi

# =========================================================
# スクリプト削除
# =========================================================
SCRIPT="${HOME}/.claude/hooks/scripts/update-slack-status.sh"
if [ -f "$SCRIPT" ]; then
    rm "$SCRIPT"
    echo "[OK] Script removed: $SCRIPT"
else
    echo "[--] Script not found (skip)"
fi

# =========================================================
# Config 削除
# =========================================================
CONFIG_DIR="${HOME}/.config/claude-slack-status"
if [ -d "$CONFIG_DIR" ]; then
    rm -rf "$CONFIG_DIR"
    echo "[OK] Config removed: $CONFIG_DIR"
else
    echo "[--] Config not found (skip)"
fi

# =========================================================
# Throttle / Log / Lock 削除
# =========================================================
rm -f /tmp/claude/slack-status-last-update
rm -f /tmp/claude/slack-status.log
rmdir /tmp/claude/slack-status.lock 2>/dev/null || true
echo "[OK] Temp files cleaned"

echo ""
echo "=== Uninstall Complete ==="
