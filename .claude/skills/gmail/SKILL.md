---
name: gmail
description: Gmail のメールを取得・検索する
user_invocable: true
---

# Gmail スキル

## 概要
Chrome の既存セッションを利用して Gmail のメールを DOM スクレイピングで取得します。
OAuth 設定は不要です。このプロジェクトでは Chrome が起動済みのため、常に `--no-launch` モードで動作します。

## 使い方

### メール一覧取得
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/gmail/scripts && npx tsx src/index.ts list --no-launch --port 9222
```

### メール検索
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/gmail/scripts && npx tsx src/index.ts search --no-launch --port 9222 -q "検索クエリ"
```

### メール本文読取
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/gmail/scripts && npx tsx src/index.ts read --no-launch --port 9222 --thread "スレッドID"
```

### 添付ファイルダウンロード
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/gmail/scripts && npx tsx src/index.ts download --no-launch --port 9222 --thread "スレッドID" --output ./downloads
```

## オプション
- `--label <name>`: ラベル指定（list時）
- `--limit <n>`: 取得件数上限（デフォルト50）
- `--format json|text`: 出力形式（デフォルト: text）
- `--no-launch`: 既存Chromeに接続（このプロジェクトでは常に指定）
- `--port <number>`: デバッグポート（デフォルト: 9222）

## 注意事項
- Chrome が `--remote-debugging-port=9222` で起動済みであること
- Gmail にログイン済みの Chrome セッションが必要
- DOM セレクタは Google の更新で変わる可能性があります
