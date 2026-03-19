---
name: gmail-search
description: Gmailでメールを検索・閲覧する
---
# Gmail検索スキル

## 手順
1. `browser_navigate` で https://mail.google.com を開く
2. `browser_wait` で検索バー（`input[aria-label="メールを検索"]` または `input[aria-label="Search mail"]`）を待機
3. `browser_type` で検索クエリを入力
4. キーボードのEnterを送信（`browser_evaluate` で `document.querySelector('input[aria-label="メールを検索"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}))`）
5. `browser_wait` で検索結果を待機
6. `browser_get_text` で検索結果一覧のテキストを取得
7. 必要に応じて個別メールを `browser_click` で開いて `browser_get_text` で本文を取得

## 注意事項
- ログインセッションが切れている場合は、ユーザーに手動ログインを依頼する
- 日本語UIと英語UIの両方に対応するセレクタを使う
- 検索結果が多い場合は最初の10件に絞る
