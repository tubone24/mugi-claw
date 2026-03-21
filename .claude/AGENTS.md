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
