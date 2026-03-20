---
name: spotify
description: Spotify Web Player で Daily Mix を再生する
user_invocable: true
---

# Spotify スキル

## 概要
Chrome の既存セッションを利用して Spotify Web Player の Daily Mix プレイリストを再生します。
Spotify にログイン済みの Chrome セッションが必要です（OAuth 設定不要）。
このプロジェクトでは Chrome が起動済みのため、常に `--no-launch` モードで動作します。

## 使い方

### Daily Mix 一覧取得
ホームページから Daily Mix プレイリストの一覧を取得:
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/spotify/scripts && npx tsx src/index.ts list --no-launch --port 9222
```

### Daily Mix 再生
指定した Daily Mix を再生:
```bash
cd $CLAUDE_PROJECT_DIR/.claude/skills/spotify/scripts && npx tsx src/index.ts play --no-launch --port 9222 --index 1
```

## オプション
- `--index <n>`: 再生する Daily Mix の番号（1始まり）
- `--no-launch`: 既存 Chrome に接続（このプロジェクトでは常に指定）
- `--port <number>`: デバッグポート（デフォルト: 9222）

## 注意事項
- Chrome が `--remote-debugging-port=9222` で起動済みであること
- Spotify にログイン済みの Chrome セッションが必要
- Spotify Premium アカウントを推奨（フリーアカウントでは広告が挿入される）
- DOM セレクタは Spotify の更新で変わる可能性があります
- headless モードでは DRM 制約により音声再生不可
