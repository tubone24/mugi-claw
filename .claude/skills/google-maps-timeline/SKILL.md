---
name: google-maps-timeline
description: Google Maps タイムラインのエクスポートJSONを解析して出社日をリストアップする
user_invocable: true
---

# Google Maps タイムライン 出社日リスト

モバイルアプリからエクスポートした `Timeline.json` を解析して、当月の出社日を表形式で出力します。

## コマンド

```bash
# 当月の出社日（semanticType自動検出）
npx tsx "$CLAUDE_PROJECT_DIR/.claude/skills/google-maps-timeline/scripts/src/index.ts" attendance --file /path/to/Timeline.json

# 月指定
npx tsx "$CLAUDE_PROJECT_DIR/.claude/skills/google-maps-timeline/scripts/src/index.ts" attendance --file /path/to/Timeline.json --month 2026-02

# 座標＋半径で会社を指定（推奨）
npx tsx "$CLAUDE_PROJECT_DIR/.claude/skills/google-maps-timeline/scripts/src/index.ts" attendance --file /path/to/Timeline.json --lat 35.681 --lng 139.767 --radius 300

# JSON出力
npx tsx "$CLAUDE_PROJECT_DIR/.claude/skills/google-maps-timeline/scripts/src/index.ts" attendance --file /path/to/Timeline.json --format json
```

## オプション

- `--file <path>` : Timeline.jsonのパス（必須）
- `--month <YYYY-MM>` : 対象月（デフォルト: 当月）
- `--lat <number>` : 会社の緯度（座標指定時）
- `--lng <number>` : 会社の経度（座標指定時）
- `--radius <meters>` : 許容半径メートル（デフォルト: 200）
- `--format json|table` : 出力形式（デフォルト: table）

## 判定ロジック

1. **semanticType優先**: `TYPE_WORK` または `INFERRED_WORK` が設定されたvisitを職場訪問とみなす
2. **座標指定時**: `--lat`/`--lng`/`--radius` を指定した場合、その範囲内のvisitを職場訪問とみなす
3. 1日に複数回の職場訪問があっても出社1回とカウント

## Timeline.json の取得方法

- Android: Googleマップアプリ > プロフィールアイコン > タイムライン > 設定（歯車アイコン）> エクスポート
- iOS: Googleマップアプリ > プロフィールアイコン > タイムライン > 設定（歯車アイコン）> エクスポート
