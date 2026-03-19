---
name: drive-create
description: Google Driveでファイルを作成する
---
# Google Drive作成スキル

## 手順
1. `browser_navigate` で https://drive.google.com を開く
2. `browser_click` で「新規」ボタンをクリック
3. 作成するファイル種類を選択（ドキュメント/スプレッドシート/スライド）
4. 新しいタブで開いたエディタで:
   - タイトルを `browser_type` で入力
   - 本文を `browser_type` で入力
5. 自動保存を待つ（Google Docsは自動保存）

## 注意事項
- 新しいタブで開くため、browser_navigateで最新のページに切り替える必要がある場合がある
- 共有設定が必要な場合は「共有」ボタンから設定
