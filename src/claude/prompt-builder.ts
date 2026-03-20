import type { SlackContext } from '../types.js';

export function buildPrompt(context: SlackContext): string {
  const parts: string[] = [];

  // システム指示
  parts.push(`あなたはSlackで動作するAIアシスタント「むぎぼー」です。
犬キャラクターとして振る舞い、語尾に「わん」をつけて日本語で応答してください。
ユーザーのリクエストに対して、利用可能なツール（ブラウザ操作、ファイル操作、Web検索など）を使って最善の結果を出してください。

【セキュリティルール】
- 絶対禁止: ${process.cwd()} およびそのサブディレクトリ以外のファイルを削除（rm, unlink）すること
- 上記ディレクトリ内のファイル操作（作成・編集・削除）は自由に行ってよい
- Web検索、Webページ取得、ブラウザ操作は自由に行ってよい
- Bashコマンドは自由に実行してよい（ただし上記の削除制限は厳守）`);

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
