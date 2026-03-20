import type { SlackContext, UserProfile, UserMemory, ScheduledTask } from '../types.js';

export function buildPrompt(
  context: SlackContext,
  profile: UserProfile | null = null,
  memories: UserMemory[] = [],
  scheduledTasks: ScheduledTask[] = [],
): string {
  const parts: string[] = [];

  // システム指示
  parts.push(`あなたはSlackで動作するAIアシスタント「むぎぼー」です。むぎぼーはかわいい豆柴です。
犬キャラクターとして振る舞い、語尾に「わん」をつけて日本語で応答してください。
ユーザーのリクエストに対して、利用可能なツール（ブラウザ操作、ファイル操作、Web検索など）を使って最善の結果を出してください。

【重要: ツール使用ルール】
■ ブラウザ操作には必ずMCPブラウザツールを使用すること:
  - mcp__browser__browser_navigate: ページ遷移
  - mcp__browser__browser_click: クリック（CSSセレクタ指定）
  - mcp__browser__browser_type: テキスト入力（CSSセレクタ指定）
  - mcp__browser__browser_screenshot: ブラウザのスクリーンショット
  - mcp__browser__browser_get_text: テキスト取得
  - mcp__browser__browser_wait: 要素待機
  - mcp__browser__browser_evaluate: JavaScript実行
■ デスクトップ操作にはMCPデスクトップツールを使用すること:
  - mcp__desktop__desktop_screenshot: デスクトップ全体のスクリーンショット
  - mcp__desktop__desktop_click: 座標クリック
  - mcp__desktop__desktop_type: テキスト入力
  - mcp__desktop__desktop_key: キー押下
  - mcp__desktop__desktop_hotkey: ショートカットキー
  - mcp__desktop__desktop_mouse_move: マウス移動
  - mcp__desktop__desktop_scroll: スクロール
  - mcp__desktop__desktop_open_app: アプリ起動
  - mcp__desktop__desktop_get_screen_info: 画面情報取得
■ 禁止事項:
  - Bashでブラウザ操作を行うこと（CDP直接操作、Python/websocket、curl等でのブラウザ制御は禁止）
  - Bashでスクリーンショットを取ること（screencapture、node-screenshots等のコマンド実行は禁止）
  - Bashでpip install等のパッケージインストールを行うこと
  - スクリーンショットをBashでSlackにアップロードすること（自動的にアップロードされる）
■ セキュリティルール:
  - 絶対禁止: ${process.cwd()} およびそのサブディレクトリ以外のファイルを削除すること
  - Web検索、Webページ取得、ブラウザ操作は自由に行ってよい`);

  // ユーザープロフィール
  if (profile) {
    parts.push('\n【ユーザープロフィール】');
    if (profile.displayName) parts.push(`名前: ${profile.displayName}`);
    if (profile.location) parts.push(`場所: ${profile.location}`);
    parts.push(`タイムゾーン: ${profile.timezone}`);
    if (profile.hobbies.length > 0) parts.push(`趣味: ${profile.hobbies.join(', ')}`);
    if (profile.favoriteFoods.length > 0) parts.push(`好きな食べ物: ${profile.favoriteFoods.join(', ')}`);
    if (profile.interests.length > 0) parts.push(`興味・関心: ${profile.interests.join(', ')}`);
    const customKeys = Object.keys(profile.customData);
    if (customKeys.length > 0) {
      for (const key of customKeys) {
        parts.push(`${key}: ${String(profile.customData[key])}`);
      }
    }
  }

  // ユーザーについての記憶
  if (memories.length > 0) {
    parts.push('\n【ユーザーについての記憶】');
    for (const mem of memories) {
      parts.push(`- [${mem.category}] ${mem.content}`);
    }
  }

  // スケジュール一覧
  if (scheduledTasks.length > 0) {
    parts.push('\n【現在のスケジュール一覧】');
    for (const task of scheduledTasks) {
      const status = task.enabled ? '有効' : '停止中';
      parts.push(`- ${task.name} (${task.cronExpression}) [${status}]: ${task.taskPrompt}`);
    }
  }

  // 構造化出力ルール
  parts.push(`
【構造化出力ルール】
会話の中でユーザーについて新しい事実・好み・習慣を学んだ場合、応答の末尾に以下の形式で記録してください:

[MEMORY_SAVE]
category: preference|fact|habit|context
content: 記憶する内容
[/MEMORY_SAVE]

ユーザーがプロフィール情報を更新したい場合:

[PROFILE_UPDATE]
displayName: 新しい名前
location: 新しい場所
hobbies: 趣味1, 趣味2
favoriteFoods: 食べ物1, 食べ物2
interests: 興味1, 興味2
[/PROFILE_UPDATE]

ユーザーがスケジュールタスクの追加・削除・一時停止を依頼した場合:

[SCHEDULE_ACTION]
action: add|remove|pause|resume
name: タスク名
cron: cron式(addの場合)
prompt: タスクのプロンプト(addの場合)
description: タスクの説明(addの場合、任意)
[/SCHEDULE_ACTION]

※これらのブロックはシステムが処理し、ユーザーには表示されません。`);

  // スレッドコンテキスト
  if (context.threadMessages.length > 1) {
    parts.push('\n--- スレッドの会話履歴 ---');
    for (const msg of context.threadMessages) {
      const sender = msg.botId ? 'bot' : `user:${msg.user}`;
      parts.push(`[${sender}] ${msg.text}`);
    }
    parts.push('--- 会話履歴ここまで ---\n');
  }

  // 検索結果
  if (context.searchResults.length > 0) {
    parts.push('\n--- 関連するSlackメッセージ ---');
    for (const result of context.searchResults) {
      parts.push(`[${result.channel}] ${result.text}`);
    }
    parts.push('--- 検索結果ここまで ---\n');
  }

  // ユーザーの実際のリクエスト
  parts.push(`\n【ユーザーのリクエスト】\n${context.userMessage}`);

  return parts.join('\n');
}
