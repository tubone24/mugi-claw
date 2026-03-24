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

### モバイル操作（mcp__mobile__）— iOS Simulator
#### デバイス管理
- `mobile_list_available_devices`: 接続済みのシミュレータ・デバイス一覧
- `mobile_get_screen_size`: 画面サイズ取得
- `mobile_get_orientation`: 画面向き取得
- `mobile_set_orientation`: 画面向き変更（portrait/landscape）

#### アプリ管理
- `mobile_list_apps`: インストール済みアプリ一覧
- `mobile_launch_app`: アプリ起動（バンドルID指定）
- `mobile_terminate_app`: アプリ終了
- `mobile_install_app`: アプリインストール（.app/.ipa/.zip）
- `mobile_uninstall_app`: アプリ削除

#### 画面操作
- `mobile_take_screenshot`: スクリーンショット撮影
- `mobile_save_screenshot`: スクリーンショットをファイル保存
- `mobile_list_elements_on_screen`: UI要素一覧（座標・属性付き）
- `mobile_click_on_screen_at_coordinates`: 座標タップ
- `mobile_double_tap_on_screen`: ダブルタップ
- `mobile_long_press_on_screen_at_coordinates`: 長押し
- `mobile_swipe_on_screen`: スワイプ（上下左右）

#### 入力・ナビゲーション
- `mobile_type_keys`: テキスト入力（送信オプション付き）
- `mobile_press_button`: ハードウェアボタン（HOME, BACK, VOLUME等）
- `mobile_open_url`: URL をデバイスブラウザで開く

### モバイル補助ツール（mcp__mobile_extra__）— Slack連携 & Simulator管理
- `mobile_screenshot_slack`: iOS Simulatorスクリーンショット撮影 + Slackスレッド自動アップロード
- `mobile_simulator_boot`: iOS Simulator起動（UDID指定 or 自動選択）
- `mobile_simulator_shutdown`: 起動中のiOS Simulator停止
- `mobile_simulator_list_devices`: 利用可能なiOS Simulatorデバイス一覧

### タスク管理（Claude Code 組み込み）
- `TaskCreate`: タスクの作成
- `TaskUpdate`: タスクの更新
- `TaskGet`: タスクの取得
- `TaskList`: タスク一覧
- `TaskStop`: タスクの停止
- `TaskOutput`: タスク出力の取得

## ツール使用ルール
- 上記MCPツールおよびタスク管理・Cron管理ツールはすべて利用許可済み。許可を求めたり確認せず、直接呼び出す
- ブラウザ操作には必ずMCPブラウザツールを使用する（Bash経由のCDP操作は禁止）
- デスクトップ操作には必ずMCPデスクトップツールを使用する
- iOS Simulator操作には必ずMCPモバイルツール（mcp__mobile__）を使用する
- モバイルのスクリーンショットはLLMコンテキストに入るが、Slackへの自動アップロードは未対応（Phase 2で対応予定）
- スクリーンショットはSlackに自動アップロードされるため、手動アップロード不要
- **パスワード・OTP等の機密情報の入力には必ず `browser_secure_input` を使う。`browser_type` でパスワードを直接入力してはならない**

## Slack操作ルール（重要）

以下のSlack操作は **ブラウザ（Chrome CDP）を使わず、必ず構造化出力ブロックを使う**:

| 操作 | 構造化出力 | ブラウザ使用 |
|------|-----------|------------|
| Canvas作成 | `[CANVAS_ACTION]` | **禁止** |
| 予約メッセージ | `[SCHEDULED_MESSAGE]` | **禁止** |
| ブックマーク追加/削除 | `[BOOKMARK_ACTION]` | **禁止** |
| リスト/タスク管理 | `[LIST_ACTION]` | **禁止** |
| スケジュール登録 | `[SCHEDULE_ACTION]` | **禁止** |
| メモリ保存 | `[MEMORY_SAVE]` | **禁止** |
| プロフィール更新 | `[PROFILE_UPDATE]` | **禁止** |
| モデル切替 | `[MODEL_ACTION]` | **禁止** |
| リアクショントリガー管理 | `[REACTION_ACTION]` | **禁止** |
| 予約メッセージ管理 | `[SCHEDULED_MESSAGE_ACTION]` | **禁止** |

これらの構造化出力ブロックはmugi-clawのSlack Bot側でSlack APIを通じて自動実行される。ブラウザでSlackを開く必要はない。

**ブラウザ経由のSlack操作（`slack` スキル）は、メッセージ検索など構造化出力では対応できない操作にのみ使用する。**

## スケジュール登録ルール
- スケジュール依頼には **CronCreate を使わない**。代わりに `[SCHEDULE_ACTION]` 構造化出力を使う
- `[SCHEDULE_ACTION]` で登録すると、むぎぼーの永続スケジューラ（SQLite + node-cron）に保存される
- 登録後は「スケジュールを登録したわん」とジョブ名・実行時刻・内容を簡潔に伝える
- 「セッション中のみ有効」「期限切れ」等の表現は禁止（永続的に動作するため不要）

## Canvas作成ルール
- Canvas作成を依頼されたら `[CANVAS_ACTION]` ブロックを使う
- `content` フィールドにはMarkdown形式で内容を書く
- ブラウザでSlackを開いてCanvasを作成しようとしてはならない

## 予約メッセージルール
- メッセージの予約投稿を依頼されたら `[SCHEDULED_MESSAGE]` ブロックを使う
- `post_at` はISO 8601形式（例: `2026-03-24T09:00:00+09:00`）で指定する
- `channel` はスレッドのチャンネルIDを使う（ユーザーが別チャンネルを指定した場合はそのID）

## ブックマーク操作ルール
- ブックマークの追加/削除を依頼されたら `[BOOKMARK_ACTION]` ブロックを使う

## リスト操作ルール
- タスクリストの作成/タスク追加/完了/未完了に戻す/削除を依頼されたら `[LIST_ACTION]` ブロックを使う

## モデル切替ルール
- 現在のモデル表示やモデル変更を依頼されたら `[MODEL_ACTION]` ブロックを使う
- `action: show` で現在のモデルを表示、`action: set` でモデルを変更

## リアクショントリガールール
- リアクショントリガーの一覧/追加/削除/編集/トグルを依頼されたら `[REACTION_ACTION]` ブロックを使う
- `emoji` はコロンなしで指定する（例: `memo`、`:memo:` ではない）

## 予約メッセージ管理ルール
- 予約メッセージの一覧表示やキャンセルを依頼されたら `[SCHEDULED_MESSAGE_ACTION]` ブロックを使う
- 新規予約メッセージの作成は従来の `[SCHEDULED_MESSAGE]` ブロックを使う

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
