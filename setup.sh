#!/bin/bash
# =============================================================================
# mugi-claw 初回セットアップスクリプト
#
# git管理外のファイルを生成し、依存関係をインストールする。
# 使い方: ./setup.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 色付き出力
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }
ask()   { echo -en "${CYAN}[?]${NC} $1"; }

# =============================================================================
# 1. ディレクトリ作成
# =============================================================================
info "ディレクトリを作成中..."

mkdir -p "$HOME/.mugi-claw/chrome-profile"
mkdir -p "$HOME/.claude/logs"
mkdir -p "$HOME/.claude/snapshots"

ok "ディレクトリ作成完了"

# =============================================================================
# 2. .env ファイル生成
# =============================================================================
if [ -f .env ]; then
  warn ".env は既に存在します。スキップします。"
else
  info ".env ファイルを生成します。必要な情報を入力してください。"
  echo ""

  ask "SLACK_BOT_TOKEN (xoxb-...): "
  read -r SLACK_BOT_TOKEN
  ask "SLACK_APP_TOKEN (xapp-...): "
  read -r SLACK_APP_TOKEN
  ask "SLACK_SIGNING_SECRET: "
  read -r SLACK_SIGNING_SECRET
  ask "SLACK_USER_TOKEN (xoxp-..., 空欄でスキップ): "
  read -r SLACK_USER_TOKEN
  ask "OWNER_SLACK_USER_ID (例: U12345678): "
  read -r OWNER_SLACK_USER_ID

  # Claude CLI パスを自動検出
  CLAUDE_CLI_PATH=$(command -v claude 2>/dev/null || echo "claude")
  ask "CLAUDE_CLI_PATH [${CLAUDE_CLI_PATH}]: "
  read -r INPUT_CLI_PATH
  CLAUDE_CLI_PATH="${INPUT_CLI_PATH:-$CLAUDE_CLI_PATH}"

  cat > .env << EOF
# Slack
SLACK_BOT_TOKEN=${SLACK_BOT_TOKEN}
SLACK_APP_TOKEN=${SLACK_APP_TOKEN}
SLACK_SIGNING_SECRET=${SLACK_SIGNING_SECRET}
SLACK_USER_TOKEN=${SLACK_USER_TOKEN}
OWNER_SLACK_USER_ID=${OWNER_SLACK_USER_ID}

# Claude
CLAUDE_MAX_CONCURRENT=3
CLAUDE_MAX_TURNS=50
CLAUDE_CLI_PATH="${CLAUDE_CLI_PATH}"

# Browser
CHROME_DEBUGGING_PORT=9222
CHROME_USER_DATA_DIR=~/.mugi-claw/chrome-profile

# Database
DB_PATH=~/.mugi-claw/mugi-claw.db

# App
LOG_LEVEL=info
NODE_ENV=development

# Sandbox
SANDBOX_ENABLED=true
EOF

  ok ".env を生成しました"
fi

# =============================================================================
# 3. ~/.claude/.env (Langfuse / Slack Webhook)
# =============================================================================
CLAUDE_ENV="$HOME/.claude/.env"
if [ -f "$CLAUDE_ENV" ]; then
  warn "$CLAUDE_ENV は既に存在します。スキップします。"
else
  info "Langfuse / Slack Webhook の設定を行います。"
  echo "  (空欄にするとその項目はスキップされます)"
  echo ""

  ask "LANGFUSE_PUBLIC_KEY: "
  read -r LANGFUSE_PUBLIC_KEY
  ask "LANGFUSE_SECRET_KEY: "
  read -r LANGFUSE_SECRET_KEY
  ask "LANGFUSE_BASE_URL [https://us.cloud.langfuse.com]: "
  read -r LANGFUSE_BASE_URL
  LANGFUSE_BASE_URL="${LANGFUSE_BASE_URL:-https://us.cloud.langfuse.com}"

  ask "SLACK_WEBHOOK_URL (通知用, 空欄でスキップ): "
  read -r SLACK_WEBHOOK_URL

  cat > "$CLAUDE_ENV" << EOF
# Langfuse (Claude Code Hooks トレーシング)
LANGFUSE_PUBLIC_KEY=${LANGFUSE_PUBLIC_KEY}
LANGFUSE_SECRET_KEY=${LANGFUSE_SECRET_KEY}
LANGFUSE_BASE_URL=${LANGFUSE_BASE_URL}

# Slack Webhook (許可リクエスト通知)
SLACK_WEBHOOK_URL=${SLACK_WEBHOOK_URL}
EOF

  ok "$CLAUDE_ENV を生成しました"
fi

# =============================================================================
# 4. .claude/settings.local.json 生成
# =============================================================================
SETTINGS_LOCAL=".claude/settings.local.json"
if [ -f "$SETTINGS_LOCAL" ]; then
  warn "$SETTINGS_LOCAL は既に存在します。スキップします。"
else
  info "$SETTINGS_LOCAL を生成中..."

  # Bashパーミッション内のパスを実際の$HOMEに置換
  PROJECT_DIR="$SCRIPT_DIR"

  cat > "$SETTINGS_LOCAL" << SETTINGS_EOF
{
  "permissions": {
    "allow": [
      "mcp__desktop__desktop_screenshot",
      "WebFetch(domain:api.github.com)",
      "WebFetch(domain:raw.githubusercontent.com)",
      "WebFetch(domain:github.com)",
      "Bash(npx tsx:*)",
      "Bash(cd .claude/skills:*)",
      "Bash(chmod +x ${PROJECT_DIR}/.claude/hooks/scripts/langfuse-logger.sh)",
      "Bash(npm install:*)",
      "Bash(plutil:*)",
      "Bash(wc -l ${PROJECT_DIR}/src/**/*.ts)"
    ]
  },
  "enableAllProjectMcpServers": true,
  "enabledMcpjsonServers": [
    "browser",
    "desktop"
  ],
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": ".claude/hooks/tool-approval.sh",
            "timeout": 660000
          }
        ]
      },
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\ninput=\$(cat)\np=\$(echo \"\$input\" | jq -r '.tool_input.file_path // \"\"')\nBLOCKED=(\".env\" \".env.local\" \".env.production\" \"credentials\" \"secrets\" \".ssh\" \"id_rsa\" \"id_ed25519\" \".pem\" \".key\" \"serviceAccount\" \".npmrc\" \".pypirc\")\nfor b in \"\${BLOCKED[@]}\"; do\n  if [[ \"\$p\" == *\"\$b\"* ]]; then\n    echo \"[Hook] BLOCKED: Cannot edit sensitive file: \$p\" >&2\n    exit 2\n  fi\ndone\necho \"\$input\""
          }
        ]
      },
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\ninput=\$(cat)\ncmd=\$(echo \"\$input\" | jq -r '.tool_input.command // \"\"')\nif echo \"\$cmd\" | grep -qE 'git push.*(--force|-f)'; then\n  echo '[Hook] BLOCKED: Force push is dangerous. Use --force-with-lease if necessary.' >&2\n  exit 2\nfi\nif echo \"\$cmd\" | grep -qE 'rm -rf /|:\\(\\)\\{ :\\|:& \\};:|> /dev/sd|mkfs\\\\.|dd if='; then\n  echo '[Hook] BLOCKED: Potentially destructive command detected' >&2\n  exit 2\nfi\necho \"\$input\""
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\ninput=\$(cat)\ncmd=\$(echo \"\$input\" | jq -r '.tool_input.command')\nif echo \"\$cmd\" | grep -qE 'gh pr create'; then\n  output=\$(echo \"\$input\" | jq -r '.tool_output.output // \"\"')\n  pr_url=\$(echo \"\$output\" | grep -oE 'https://github.com/[^/]+/[^/]+/pull/[0-9]+')\n  if [ -n \"\$pr_url\" ]; then\n    echo \"[Hook] PR created: \$pr_url\" >&2\n    osascript -e \"display notification \\\\\"PR作成完了: \$pr_url\\\\\" with title \\\\\"Claude Code\\\\\" sound name \\\\\"Hero\\\\\"\" 2>/dev/null || true\n  fi\nfi\necho \"\$input\""
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PostToolUseFailure": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\nmkdir -p ~/.claude/logs ~/.claude/snapshots\necho \"[\$(date '+%Y-%m-%d %H:%M:%S')] SESSION START in \$(pwd)\" >> ~/.claude/logs/agent-\$(date '+%Y%m%d').log"
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\necho \"[\$(date '+%H:%M:%S')] SESSION END\" >> ~/.claude/logs/agent-\$(date '+%Y%m%d').log\nosascript -e 'display notification \"セッションが終了しました\" with title \"Claude Code\" subtitle \"処理完了\" sound name \"Hero\"' 2>/dev/null || true",
            "timeout": 30
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "#!/bin/bash\ninput=\$(cat)\n\nSNAPSHOT_DIR=\"\$HOME/.claude/snapshots\"\nmkdir -p \"\$SNAPSHOT_DIR\"\nSNAPSHOT_FILE=\"\$SNAPSHOT_DIR/context-\$(date '+%Y%m%d-%H%M%S').md\"\n\ncat > \"\$SNAPSHOT_FILE\" << SNAPSHOT_EOF\n# Context Snapshot\n**Date:** \$(date '+%Y-%m-%d %H:%M:%S')\n**Directory:** \$(pwd)\n\n## Recent Git Changes\n\$(git diff --stat HEAD 2>/dev/null | tail -20 || echo 'No git repo')\n\n## Modified Files (uncommitted)\n\$(git status --short 2>/dev/null | head -20 || echo 'N/A')\nSNAPSHOT_EOF\n\necho \"[Hook] Context snapshot saved: \$SNAPSHOT_FILE\" >&2\necho \"\$input\"",
            "timeout": 10
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "Notification": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "osascript -e 'display notification \"Claude Codeが許可を求めています\" with title \"Claude Code\" subtitle \"確認待ち\" sound name \"Glass\"'"
          }
        ]
      },
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "SubagentStop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "bash .claude/hooks/scripts/langfuse-logger.sh",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
SETTINGS_EOF

  ok "$SETTINGS_LOCAL を生成しました"
fi

# =============================================================================
# 5. サンドボックスプロファイルの $HOME パス更新
# =============================================================================
SANDBOX_FILE="sandbox/mugi-claw.sb"
if [ -f "$SANDBOX_FILE" ]; then
  CURRENT_HOME="$HOME"
  if grep -q '/Users/tubone24' "$SANDBOX_FILE" && [ "$CURRENT_HOME" != "/Users/tubone24" ]; then
    info "サンドボックスプロファイルのパスを $CURRENT_HOME に更新中..."
    sed -i.bak "s|/Users/tubone24|${CURRENT_HOME}|g" "$SANDBOX_FILE"
    rm -f "${SANDBOX_FILE}.bak"
    ok "サンドボックスプロファイルを更新しました"
  else
    ok "サンドボックスプロファイルのパスは正しい状態です"
  fi
else
  warn "サンドボックスプロファイルが見つかりません: $SANDBOX_FILE"
fi

# =============================================================================
# 6. スクリプト実行権限の付与
# =============================================================================
info "スクリプトに実行権限を付与中..."

chmod +x .claude/hooks/tool-approval.sh
chmod +x .claude/hooks/scripts/langfuse-logger.sh
chmod +x sandbox/start-sandboxed.sh
chmod +x scripts/guard-file-access.sh
chmod +x scripts/guard-bash.sh

ok "実行権限を付与しました"

# =============================================================================
# 7. .gitignore に settings.local.json を追加
# =============================================================================
if ! grep -q 'settings.local.json' .gitignore 2>/dev/null; then
  info ".gitignore に settings.local.json を追加中..."
  echo '.claude/settings.local.json' >> .gitignore
  ok ".gitignore を更新しました"
fi

# =============================================================================
# 8. npm install (プロジェクトルート)
# =============================================================================
info "プロジェクトの依存関係をインストール中..."
npm install
ok "プロジェクト依存関係のインストール完了"

# =============================================================================
# 9. スキルの依存関係をインストール
# =============================================================================
info "スキルの依存関係をインストール中..."

SKILL_DIRS=(
  ".claude/skills/shared/scripts"
  ".claude/skills/gmail/scripts"
  ".claude/skills/slack/scripts"
  ".claude/skills/google-calendar/scripts"
  ".claude/skills/google-maps-timeline/scripts"
  ".claude/skills/spotify/scripts"
)

for dir in "${SKILL_DIRS[@]}"; do
  if [ -f "$dir/package.json" ]; then
    info "  → $dir"
    (cd "$dir" && npm install --silent)
  fi
done

ok "スキル依存関係のインストール完了"

# =============================================================================
# 10. プロジェクトのビルド
# =============================================================================
info "プロジェクトをビルド中..."
npm run build
ok "ビルド完了"

# =============================================================================
# 完了
# =============================================================================
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  mugi-claw セットアップ完了！ 🐕${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "生成されたファイル:"
echo "  - .env                          (環境変数)"
echo "  - .claude/settings.local.json   (Claude Code ローカル設定)"
echo "  - ~/.claude/.env                (Langfuse / Slack Webhook)"
echo "  - ~/.mugi-claw/                 (アプリデータ)"
echo ""
echo "次のステップ:"
echo "  1. Chrome を --remote-debugging-port=9222 で起動"
echo "  2. npm run dev または npm start で起動"
echo ""
