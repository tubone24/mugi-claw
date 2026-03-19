---
name: photos-manage
description: Google Photosで写真を検索・管理する
---
# Google Photos操作スキル

## 手順
1. `browser_navigate` で https://photos.google.com を開く
2. 検索: 上部の検索バーに `browser_type` でキーワードを入力
3. `browser_get_text` + `browser_screenshot` で検索結果を確認
4. `browser_click` で個別の写真を開いて詳細を確認
5. アルバム操作: 左メニューの「アルバム」から操作

## 注意事項
- 写真の内容確認には `browser_screenshot` が必要
- 大量の写真がある場合はスクロールして追加読み込みが必要
