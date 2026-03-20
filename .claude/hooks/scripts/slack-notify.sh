#!/bin/bash
# Claude Code Notification → Slack 通知スクリプト
# ~/.claude/.env に SLACK_WEBHOOK_URL を設定してください
#
# 設定方法:
#   echo 'SLACK_WEBHOOK_URL=https://hooks.slack.com/services/T.../B.../...' >> ~/.claude/.env

input=$(cat)

# ~/.claude/.env から環境変数を読み込む
if [ -f "$HOME/.claude/.env" ]; then
  set -a
  source "$HOME/.claude/.env"
  set +a
fi

WEBHOOK_URL="${SLACK_WEBHOOK_URL:-}"
if [ -z "$WEBHOOK_URL" ]; then
  echo "[Slack Hook] SLACK_WEBHOOK_URL not set, skipping" >&2
  echo "$input"
  exit 0
fi

# フック入力からメッセージを抽出
message=$(echo "$input" | jq -r '.message // "Claude Codeが許可を求めています"')
title=$(echo "$input" | jq -r '.title // "Claude Code"')
cwd=$(echo "$input" | jq -r '.cwd // "unknown"')
timestamp=$(date '+%Y-%m-%d %H:%M:%S')
project_name=$(basename "$cwd")

# Block Kit形式のリッチ通知ペイロード
payload=$(jq -n \
  --arg fallback "${title}: ${message}" \
  --arg message "$message" \
  --arg cwd "$cwd" \
  --arg project "$project_name" \
  --arg ts "$timestamp" \
  '{
    text: $fallback,
    blocks: [
      {
        type: "header",
        text: {
          type: "plain_text",
          text: "Claude Code - 確認待ち",
          emoji: true
        }
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: $message
        }
      },
      {
        type: "divider"
      },
      {
        type: "section",
        fields: [
          {
            type: "mrkdwn",
            text: ("*:file_folder: プロジェクト:*\n" + $project)
          },
          {
            type: "mrkdwn",
            text: ("*:round_pushpin: パス:*\n`" + $cwd + "`")
          }
        ]
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: (":clock1: " + $ts + " | :robot_face: Claude Code")
          }
        ]
      }
    ]
  }')

curl -s -X POST -H 'Content-type: application/json' \
  --data "$payload" \
  "$WEBHOOK_URL" > /dev/null 2>&1

echo "$input"
