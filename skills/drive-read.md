---
name: drive-read
description: Google Driveのファイルを閲覧する
---
# Google Drive閲覧スキル

## 手順
1. `browser_navigate` で https://drive.google.com を開く
2. 検索バーに `browser_type` でファイル名やキーワードを入力して検索
3. `browser_get_text` で検索結果一覧を取得
4. `browser_click` で目的のファイルを開く
5. ファイル種類に応じて内容を取得:
   - ドキュメント: `browser_get_text` でテキスト取得
   - スプレッドシート: `browser_get_text` でセル内容を取得
   - PDF: `browser_screenshot` でスクリーンショット取得

## 注意事項
- 共有ドライブにアクセスする場合は左メニューから「共有ドライブ」を選択
- ファイルが見つからない場合は検索クエリを変えて再試行
