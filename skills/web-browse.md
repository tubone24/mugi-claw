---
name: web-browse
description: 汎用Webブラウジング。任意のWebサイトを閲覧・操作する
---
# 汎用Webブラウジングスキル

## 手順
1. `browser_navigate` で対象URLを開く
2. `browser_wait` でページ読み込みを待機
3. `browser_get_text` でページ内容を取得
4. 必要に応じて:
   - `browser_click` でリンクやボタンをクリック
   - `browser_type` でフォームに入力
   - `browser_screenshot` で視覚的な内容を確認
   - `browser_evaluate` でJavaScriptを実行

## Tips
- SPAの場合は `browser_wait` で要素の出現を待つ
- ページネーションがある場合は「次へ」ボタンを `browser_click`
- ログインが必要なサイトはユーザーに事前ログインを依頼
- CAPTCHAが出た場合はユーザーに手動解決を依頼
