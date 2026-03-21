# AGENTS - 利用可能なスキルとツール

## スキル一覧

### Webサービス操作（Chrome CDP経由）
- **gmail**: Gmailでメール検索・閲覧・添付ファイルダウンロード
- **slack**: Slackのチャンネル・メッセージ取得・検索
- **google-calendar**: Google Calendarの予定取得
- **spotify**: Spotify Web PlayerでDaily Mix再生
- **google-maps-timeline**: Google Mapsタイムラインから出社日分析
- **web-browse**: 汎用Webブラウジング（MCP browser）

## MCPツール

### ブラウザ操作（mcp__browser__）
- `browser_navigate`: ページ遷移
- `browser_click`: クリック（CSSセレクタ指定）
- `browser_type`: テキスト入力（CSSセレクタ指定）
- `browser_screenshot`: ブラウザのスクリーンショット
- `browser_get_text`: テキスト取得
- `browser_wait`: 要素待機
- `browser_evaluate`: JavaScript実行
- `browser_secure_input`: 機密情報の安全な入力（パスワード・OTP等）。LLMコンテキストに機密情報を載せずにWeb UI経由でユーザーに入力してもらう

### デスクトップ操作（mcp__desktop__）
- `desktop_screenshot`: デスクトップ全体のスクリーンショット
- `desktop_click`: 座標クリック
- `desktop_right_click`: 右クリック
- `desktop_double_click`: ダブルクリック
- `desktop_type`: テキスト入力
- `desktop_key`: キー押下
- `desktop_hotkey`: ショートカットキー
- `desktop_mouse_move`: マウス移動
- `desktop_scroll`: スクロール
- `desktop_open_app`: アプリ起動
- `desktop_get_screen_info`: 画面情報取得
- `desktop_wait`: 待機

## ツール使用ルール
- 上記MCPツールはすべて利用許可済み。許可を求めたり確認せず、直接呼び出す
- ブラウザ操作には必ずMCPブラウザツールを使用する（Bash経由のCDP操作は禁止）
- デスクトップ操作には必ずMCPデスクトップツールを使用する
- スクリーンショットはSlackに自動アップロードされるため、手動アップロード不要
- **パスワード・OTP等の機密情報の入力には必ず `browser_secure_input` を使う。`browser_type` でパスワードを直接入力してはならない**

## セッション切れ時のログインフロー
セッション切れを検知した場合、以下の手順でログインする（手動ログインの案内は禁止）:

1. `browser_screenshot` でログイン画面を確認
2. `browser_get_text` でフォーム構造（セレクタ）を特定
3. `browser_secure_input` で機密情報の入力をユーザーに依頼
   - `site`: ログイン対象のサービス名/URL
   - `fields`: 各入力フィールドの `selector`（CSSセレクタ）、`label`（表示名）、`sensitive`（パスワード等はtrue）
4. 入力完了後、`browser_click` でログインボタンを押す
5. MFA（2段階認証）が求められた場合は、再度 `browser_secure_input` でOTPの入力を依頼

例:
```
browser_secure_input({
  site: "x.com",
  fields: [
    { selector: "input[name='text']", label: "ユーザー名/メール/電話番号", sensitive: false },
    { selector: "input[name='password']", label: "パスワード", sensitive: true }
  ]
})
```
