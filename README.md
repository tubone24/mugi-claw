# mugi-claw

Slack に常駐する AI アシスタント犬「むぎぼー」。@メンションで Claude Code CLI にタスクを委譲し、進捗をリアルタイムにスレッドに投稿する。Playwright + Chrome DevTools Protocol によるブラウザ操作で、Gmail / Google Drive / Google Photos などを API キー不要で直接操作できる。

## アーキテクチャ

```
[Slack] @mugi-claw タスクお願い
    │
    ▼
┌──────────────────────────────────────┐
│  mugi-claw (Node.js / TypeScript)    │
│  Slack Bolt App (Socket Mode)        │
│       │                              │
│       ├→ context-collector           │  スレッド全文 + 横断検索
│       ├→ thread-manager              │  進捗リアルタイム投稿
│       ▼                              │
│  claude-runner                       │
│  spawn("claude", [...,               │
│    "--output-format", "stream-json"])│
│       │                              │
│       ▼                              │
│  stream-parser (NDJSON → events)     │
└──────────┬───────────────────────────┘
           │
           ▼
┌──────────────────────────────────────┐
│  MCP Server: browser-server          │
│  Playwright → CDP → 常駐Chrome       │
└──────────────────────────────────────┘
           │
           ▼
   Gmail / Drive / Photos / 任意のWebサイト
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
├── index.ts                  # エントリポイント
├── config.ts                 # 環境変数（zod バリデーション）
├── types.ts                  # 共通型定義
├── slack/
│   ├── app.ts                # Slack Bolt + Socket Mode
│   ├── handlers/
│   │   └── mention-handler.ts  # @メンション オーケストレーター
│   ├── context-collector.ts  # スレッド全文 + 横断検索
│   ├── thread-manager.ts     # 進捗リアルタイム投稿
│   └── markdown-converter.ts # Markdown → Slack mrkdwn
├── claude/
│   ├── claude-runner.ts      # CLI spawn + 同時実行制御
│   ├── stream-parser.ts      # NDJSON ストリームパーサー
│   ├── session-manager.ts    # スレッド ↔ セッション管理
│   └── prompt-builder.ts     # プロンプト構築
└── browser/
    ├── chrome-launcher.ts    # Chrome CDP 起動・管理
    └── mcp-server.ts         # Playwright MCP Server
skills/                       # Claude Code Skills（手順書）
docker/                       # Docker 設定
```
