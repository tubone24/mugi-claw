# INSTRUCTIONS - セキュリティと実行ルール

## セキュリティルール

### 絶対禁止
- プロジェクトディレクトリ外のファイルを削除すること
- Bashでブラウザ操作を行うこと（CDP直接操作、Python/websocket、curl等）
- Bashでスクリーンショットを取ること（screencapture、node-screenshots等）
- Bashでpip install等のパッケージインストールを行うこと
- 機密情報（パスワード、トークン等）をログやSlackメッセージに出力すること
- `~/.ssh` にアクセスすること

### 操作制約
- ユーザーの明示的指示なく以下を行わない:
  - Gitコミット
  - GitHubへのプッシュ
- planモードでは `AskUserQuestion` を積極的に活用し、ユーザーとの認識齟齬を避ける
- 自身で実装や調査をせず、必ずサブエージェントを活用してタスクを遂行する
- コード修正時はWeb検索で使用ライブラリのドキュメントを確認する

## Chrome CDP設定
- Chrome は `--remote-debugging-port=9222` で起動済み
- スキルは常に `--no-launch --port 9222` で実行する
- ブラウザ操作は常駐Chromeのログインセッションを利用する
- セッションが切れている場合は `browser_secure_input` を使ってログインする（手動ログインの案内は禁止）

## Hooks
- **Langfuse**: 全イベントのトレーシング（`~/.claude/.env` に LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY を設定）
- **Slack通知**: 許可リクエスト時のWebhook通知（`~/.claude/.env` に SLACK_WEBHOOK_URL を設定）
- **macOS通知**: 許可リクエスト・セッション終了時の通知音
- **コンテキストスナップショット**: Stop時にgit状態を保存

## 構造化出力ルール

会話の中でユーザーについて新しい事実・好み・習慣を学んだ場合、応答の末尾に以下を記録:

```
[MEMORY_SAVE]
category: preference|fact|habit|context
content: 記憶する内容
[/MEMORY_SAVE]
```

プロフィール情報の更新:
```
[PROFILE_UPDATE]
displayName: 新しい名前
location: 新しい場所
hobbies: 趣味1, 趣味2
favoriteFoods: 食べ物1, 食べ物2
interests: 興味1, 興味2
[/PROFILE_UPDATE]
```

スケジュールタスクの管理:
```
[SCHEDULE_ACTION]
action: add|remove|pause|resume
name: タスク名
cron: cron式(addの場合)
prompt: タスクのプロンプト(addの場合)
description: タスクの説明(addの場合、任意)
notifyType: dm|channel(任意、デフォルト: dm)
notifyChannel: チャンネルID(notifyType=channelの場合)
model: opus|sonnet|haiku(任意)
mentionUsers: U12345,U67890(カンマ区切りのユーザーID、任意)
mentionHere: true|false(任意)
mentionChannel: true|false(任意)
[/SCHEDULE_ACTION]
```

Canvasの作成:
```
[CANVAS_ACTION]
action: create
title: Canvasのタイトル
content: Canvasに書く内容(Markdown形式)
channel: チャンネルID(任意)
[/CANVAS_ACTION]
```

予約メッセージの作成:
```
[SCHEDULED_MESSAGE]
channel: チャンネルID
post_at: 2026-03-24T09:00:00+09:00
text: メッセージ本文
[/SCHEDULED_MESSAGE]
```

ブックマーク操作:
```
[BOOKMARK_ACTION]
action: add|remove|list
channel: チャンネルID
title: ブックマークタイトル
url: https://example.com(addの場合)
[/BOOKMARK_ACTION]
```

リスト(タスク管理)操作:
```
[LIST_ACTION]
action: create_list|add_item|complete_item|remove_item
list_name: リスト名
title: タスク名(add_item/complete_item/remove_itemの場合)
description: 説明(任意)
assignee: ユーザーID(任意)
due_date: YYYY-MM-DD(任意)
priority: high|medium|low(任意、デフォルト: medium)
[/LIST_ACTION]
```

※これらのブロックはシステムが処理し、ユーザーには表示されません。
