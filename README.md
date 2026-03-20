# mugi-claw

Slack に常駐する AI アシスタント犬「むぎぼー」。@メンションで Claude Code CLI にタスクを委譲し、進捗をリアルタイムにスレッドに投稿する。Playwright + Chrome DevTools Protocol によるブラウザ操作で、Gmail / Google Drive / Google Photos などを API キー不要で直接操作できる。

**主な機能:**
- **パーソナライズ**: ユーザーごとのプロフィール・メモリ機能。会話から好みや事実を学習し、応答をパーソナライズ
- **スケジュールタスク**: node-cron で定期タスクを自動実行（Gmail確認、レポート生成など）
- **モデル切替**: Slack から `opus` / `sonnet` / `haiku` をグローバルに切り替え
- **スラッシュコマンド**: `/mugiclaw` でプロフィール・スケジュール・メモリ・モデルを管理

## アーキテクチャ

```
[Slack] @mugi-claw タスクお願い
    │
    ▼
Slack (Socket Mode)
  │
  ├── @メンション ──→ mention-handler ──→ Claude Code CLI (spawn)
  │                        │                     │
  │                        │                     ├→ stream-json でイベント受信
  │                        │                     └→ Playwright MCP でブラウザ操作
  │                        │
  │                        ├→ profile/memories 読込 (SQLite)
  │                        └→ result-parser で構造化出力を処理
  │
  ├── /mugiclaw ──→ command-handler ──→ DB操作
  │
  ├── Block Kit ──→ profile-onboarding ──→ プロフィール登録
  │
  └── Scheduler (node-cron) ──→ task-runner ──→ Claude Code CLI
                                     │
                                     └→ Notifier (DM/チャンネル通知)

SQLite (~/.mugi-claw/mugi-claw.db)
  ├── user_profile     (マルチユーザー)
  ├── user_memories    (ユーザーごとの記憶)
  ├── scheduled_tasks  (定期タスク)
  ├── task_runs        (実行履歴)
  └── settings         (グローバル設定)
```

## 前提条件

- Node.js 20 以上
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) がインストール済み・認証済み
- Google Chrome（ブラウザ操作を使う場合）

## セットアップ

### 1. 依存関係インストール

```bash
npm install
```

### 2. Slack App 作成

1. https://api.slack.com/apps にアクセス
2. **Create New App** → **From a manifest** を選択
3. ワークスペースを選択
4. `manifest.json` の内容を貼り付けて作成
5. 作成後、以下のトークンを取得:

| トークン | 取得場所 | 形式 |
|---------|---------|------|
| Bot Token | **OAuth & Permissions** → Bot User OAuth Token | `xoxb-...` |
| App Token | **Basic Information** → App-Level Tokens → `connections:write` スコープで生成 | `xapp-...` |
| Signing Secret | **Basic Information** → App Credentials | 文字列 |
| User Token (任意) | **OAuth & Permissions** → User OAuth Token | `xoxp-...` |

> **User Token について**: ワークスペース横断検索（`search.messages`）を使うには User Token が必要。アプリのインストール時にユーザー認可が求められ、認可後に User OAuth Token が表示される。不要なら設定しなくてもよい。

### 3. 環境変数設定

```bash
cp .env.example .env
```

`.env` を編集して取得したトークンを設定:

```
# 必須
SLACK_BOT_TOKEN=xoxb-your-token
SLACK_APP_TOKEN=xapp-your-token
SLACK_SIGNING_SECRET=your-signing-secret
OWNER_SLACK_USER_ID=U01XXXXXX

# 任意: 横断検索を有効にする場合
SLACK_USER_TOKEN=xoxp-your-user-token
```

### 4. 起動

#### 開発モード（ホットリロード付き）

```bash
npm run dev
```

#### 本番モード

```bash
npm run build
npm start
```

## 環境変数一覧

| 変数名 | 必須 | デフォルト | 説明 |
|--------|------|----------|------|
| `SLACK_BOT_TOKEN` | Yes | - | Slack Bot Token (`xoxb-`) |
| `SLACK_APP_TOKEN` | Yes | - | Slack App-Level Token (`xapp-`) |
| `SLACK_SIGNING_SECRET` | Yes | - | Slack Signing Secret |
| `SLACK_USER_TOKEN` | No | - | Slack User Token (`xoxp-`)。横断検索に使用 |
| `OWNER_SLACK_USER_ID` | Yes | - | ボットオーナーの Slack User ID |
| `DB_PATH` | No | `~/.mugi-claw/mugi-claw.db` | SQLite データベースパス |
| `CLAUDE_CLI_PATH` | No | `claude` | Claude Code CLI のパス |
| `CLAUDE_MAX_CONCURRENT` | No | `3` | Claude CLI の最大同時実行数 (1-10) |
| `CLAUDE_MAX_TURNS` | No | `50` | Claude CLI の最大ターン数 (1-200) |
| `CHROME_DEBUGGING_PORT` | No | `9222` | Chrome CDP ポート |
| `CHROME_USER_DATA_DIR` | No | `~/.mugi-claw/chrome-profile` | Chrome ユーザーデータディレクトリ |
| `LOG_LEVEL` | No | `info` | ログレベル (`fatal`/`error`/`warn`/`info`/`debug`/`trace`) |
| `NODE_ENV` | No | `development` | 環境 (`development`/`production`/`test`) |

## ブラウザ操作（Google連携）

Gmail / Drive / Photos などの Google サービスは、API ではなくブラウザ UI を直接操作する。

### Chrome の準備

```bash
# Chrome を CDP モードで起動（初回のみ手動で Google ログインが必要）
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=~/.mugi-claw/chrome-profile
```

1. 起動した Chrome で Google アカウントにログイン
2. ログインセッションは `chrome-profile` に永続化される
3. 以降はセッションが維持されるため再ログイン不要

### 利用可能な Skills

| スキル | 説明 |
|--------|------|
| `gmail-search` | Gmail でメール検索・閲覧 |
| `gmail-send` | Gmail でメール送信 |
| `drive-read` | Google Drive ファイル閲覧 |
| `drive-create` | Google Drive ファイル作成 |
| `photos-manage` | Google Photos 写真検索・管理 |
| `web-browse` | 任意の Web サイト閲覧・操作 |

## スラッシュコマンド

| コマンド | 説明 |
|---------|------|
| `/mugiclaw help` | ヘルプ表示 |
| `/mugiclaw profile` | プロフィール表示 |
| `/mugiclaw profile set <field> <value>` | プロフィール更新 |
| `/mugiclaw schedule list` | スケジュール一覧 |
| `/mugiclaw schedule add <名前> <cron式> <プロンプト>` | スケジュール追加 |
| `/mugiclaw schedule remove <名前>` | スケジュール削除 |
| `/mugiclaw schedule pause <名前>` | 一時停止/再開 |
| `/mugiclaw run <名前>` | タスク即時実行 |
| `/mugiclaw memories` | 記憶一覧 |
| `/mugiclaw memory add <テキスト>` | 記憶追加 |
| `/mugiclaw memory forget <ID>` | 記憶削除 |
| `/mugiclaw model` | 現在のモデル表示 |
| `/mugiclaw model <opus\|sonnet\|haiku>` | モデル切替 |

### 自然言語でのスケジュール登録

メンションでも自然言語でスケジュール登録が可能:

```
@mugibow 毎朝9時にGmailを確認して未読メールを教えて
```

## データ永続化

SQLite (`~/.mugi-claw/mugi-claw.db`) で以下を永続化:

| テーブル | 説明 |
|---------|------|
| `user_profile` | ユーザーごとのプロフィール（名前、場所、趣味など） |
| `user_memories` | 会話から学習した記憶（好み、事実、習慣） |
| `scheduled_tasks` | 定期実行タスクの定義 |
| `task_runs` | タスク実行履歴 |
| `settings` | グローバル設定（Claude モデルなど） |

## Docker で起動

```bash
# ビルド & 起動
docker compose -f docker/docker-compose.yml up -d

# ログ確認
docker compose -f docker/docker-compose.yml logs -f mugi-claw
```

Docker 構成:
- **mugi-claw**: メインアプリ（Node.js 20）
- **chrome**: Chrome リモートデバッグサーバー（Alpine Chrome）

ホストの `~/.claude/`（Claude 認証情報）と `~/.mugi-claw/`（Chrome プロファイル）をマウントする。

## macOS で常駐起動（launchd）

macOS のサービス管理機構 `launchd` を使えば、ログイン時に自動起動・クラッシュ時に自動復旧できる。

### 1. ビルド

```bash
npm run build
```

### 2. plist ファイル配置

```bash
cp launchd/com.mugi-claw.plist ~/Library/LaunchAgents/
```

> **Note**: plist 内の Node.js パスやワーキングディレクトリは環境に合わせて編集すること（`which node` で確認）。launchd はシェルの `.zshrc` を読まないため、`EnvironmentVariables` で `PATH` を明示的に指定する必要がある。Claude CLI (`~/.local/bin`) へのパスも含めること。

### 3. サービス操作

```bash
# 登録 & 起動
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mugi-claw.plist

# 停止 & 登録解除
launchctl bootout gui/$(id -u)/com.mugi-claw

# 起動
launchctl kickstart gui/$(id -u)/com.mugi-claw

# 再起動
launchctl kickstart -k gui/$(id -u)/com.mugi-claw

# 状態確認
launchctl print gui/$(id -u)/com.mugi-claw

# ログ確認
tail -f ~/.mugi-claw/launchd-stdout.log
tail -f ~/.mugi-claw/launchd-stderr.log
```

### 4. コード更新時

```bash
launchctl bootout gui/$(id -u)/com.mugi-claw
npm run build
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.mugi-claw.plist
```

## npm scripts

| コマンド | 説明 |
|---------|------|
| `npm run dev` | 開発モード起動（tsx watch） |
| `npm run build` | TypeScript ビルド |
| `npm start` | 本番モード起動 |
| `npm run typecheck` | 型チェック |
| `npm run lint` | ESLint |

## プロジェクト構成

```
src/
├── index.ts                    # エントリポイント
├── config.ts                   # 環境変数（Zod バリデーション）
├── types.ts                    # 共通型定義
├── db/
│   ├── database.ts             # SQLite シングルトン
│   ├── migrations.ts           # スキーマ定義
│   └── settings-store.ts       # グローバル設定
├── profile/
│   ├── profile-store.ts        # プロフィール・メモリ CRUD
│   └── profile-onboarding.ts   # 初回 DM 対話 (Block Kit)
├── claude/
│   ├── claude-runner.ts        # CLI spawn + 同時実行制御
│   ├── stream-parser.ts        # NDJSON ストリームパーサー
│   ├── session-manager.ts      # スレッド ↔ セッション管理
│   ├── prompt-builder.ts       # プロンプト構築
│   └── result-parser.ts        # 構造化出力パーサー
├── scheduler/
│   ├── scheduler.ts            # node-cron 管理
│   ├── task-store.ts           # タスク CRUD
│   └── task-runner.ts          # タスク実行
├── slack/
│   ├── app.ts                  # Slack Bolt + Socket Mode
│   ├── notifier.ts             # 結果通知 (DM/チャンネル)
│   ├── thread-manager.ts       # 進捗リアルタイム投稿
│   ├── context-collector.ts    # スレッド全文 + 横断検索
│   ├── markdown-converter.ts   # Markdown → Slack mrkdwn
│   └── handlers/
│       ├── mention-handler.ts  # @メンション ハンドラー
│       ├── command-handler.ts  # /mugiclaw ルーター
│       └── commands/
│           ├── profile-commands.ts
│           ├── schedule-commands.ts
│           ├── memory-commands.ts
│           └── model-commands.ts
└── browser/
    ├── chrome-launcher.ts      # Chrome CDP 起動・管理
    └── mcp-server.ts           # Playwright MCP Server
skills/                         # Claude Code Skills（手順書）
docker/                         # Docker 設定
```
