---
name: slack
description: Slack のメッセージを取得・検索する
user_invocable: true
---

# Slack スキル

## 概要
Chrome の既存セッションを利用して Slack のメッセージを DOM スクレイピングで取得します。
OAuth 設定は不要です。ワークスペースURLはハードコードせず、ブラウザの現在のURLから自動検出します。
このプロジェクトでは Chrome が起動済みのため、常に `--no-launch` モードで動作します。

## 使い方

### チャンネル一覧取得
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/slack/scripts && npx tsx src/index.ts channels --no-launch --port 9222
```

### メッセージ取得
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/slack/scripts && npx tsx src/index.ts messages --no-launch --port 9222 --channel "チャンネル名"
```

### メッセージ検索
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/slack/scripts && npx tsx src/index.ts search --no-launch --port 9222 -q "検索クエリ"
```

### スレッド読み取り
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/slack/scripts && npx tsx src/index.ts thread --no-launch --port 9222 --channel "チャンネル名" --ts "タイムスタンプ"
```

## オプション
- `--limit <n>`: 取得件数上限（デフォルト50）
- `--format json|text`: 出力形式（デフォルト: text）
- `--no-launch`: 既存Chromeに接続（このプロジェクトでは常に指定）
- `--port <number>`: デバッグポート（デフォルト: 9222）

## 検索の実装詳細

Slack はSPA（シングルページアプリケーション）であるため、検索はURL遷移ではなくDOM操作で行います。

### 検索フロー
1. まずチャンネルページに遷移する（クリーンな状態が必要）
2. `button[data-qa="top_nav_search"]` をクリックして検索ダイアログを開く
3. 既存テキストを `document.execCommand("selectAll")` + Backspace でクリアする
4. `page.keyboard.type()` でクエリを入力する
5. Enter を押して検索を実行する
6. `/search` URLへの遷移を待つ
7. `[data-qa="search_result"]` セレクタで結果を取得する

### 重要なポイント
- `page.goto()` で検索URLに直接遷移しても、SPAのためチャンネルにリダイレクトされる。必ずDOM操作で検索すること
- ワークスペースURLはハードコードしない。ブラウザの現在のページURLからチームIDを自動検出する
- Slack検索は日付フィルタをサポート: `after:YYYY-MM-DD before:YYYY-MM-DD`

## 注意事項
- Chrome が `--remote-debugging-port=9222` で起動済みであること
- Slack にログイン済みの Chrome セッションが必要
- DOM セレクタは Slack の更新で変わる可能性があります
