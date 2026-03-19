---
name: gmail-send
description: Gmailでメールを送信する
---
# Gmail送信スキル

## 手順
1. `browser_navigate` で https://mail.google.com を開く
2. `browser_click` で「作成」ボタン（`div[gh="cm"]` or `div.T-I.T-I-KE`）をクリック
3. `browser_wait` で新規メール作成ウィンドウを待機
4. `browser_type` で宛先（`input[aria-label="To"]` or `textarea[name="to"]`）を入力
5. `browser_type` で件名を入力
6. `browser_type` で本文（`div[aria-label="メール本文"]` or `div[aria-label="Message Body"]`）を入力
7. `browser_click` で「送信」ボタンをクリック

## 注意事項
- 送信前に必ず内容をユーザーに確認する
- 添付ファイルはドラッグ&ドロップではなく、クリップアイコンから添付
