import type { WebClient } from '@slack/web-api';
import type { SlackContext, ThreadMessage, SearchResult } from '../types.js';

export async function collectContext(
  client: WebClient,
  channel: string,
  threadTs: string,
  userMessage: string,
  userId: string,
): Promise<SlackContext> {
  // スレッドメッセージ取得
  const threadMessages = await getThreadMessages(client, channel, threadTs);

  // 横断検索（キーワード抽出して検索）
  const searchResults = await searchMessages(client, userMessage);

  return {
    channel,
    threadTs,
    userMessage,
    userId,
    threadMessages,
    searchResults,
  };
}

async function getThreadMessages(
  client: WebClient,
  channel: string,
  threadTs: string,
): Promise<ThreadMessage[]> {
  try {
    const result = await client.conversations.replies({
      channel,
      ts: threadTs,
      limit: 15, // 2025年以降のレート制限対応
    });

    return (result.messages ?? []).map((msg) => ({
      user: msg.user ?? 'unknown',
      text: msg.text ?? '',
      ts: msg.ts ?? '',
      botId: msg.bot_id ?? undefined,
    }));
  } catch {
    return [];
  }
}

async function searchMessages(
  client: WebClient,
  query: string,
): Promise<SearchResult[]> {
  try {
    // search.messages は User Token が必要なため、
    // Bot Token では使えない場合がある。エラー時は空配列を返す。
    const result = await client.search.messages({
      query,
      count: 5,
      sort: 'timestamp',
      sort_dir: 'desc',
    });

    const matches = result.messages?.matches ?? [];
    return matches.map((match) => ({
      channel: match.channel?.id ?? '',
      text: match.text ?? '',
      ts: match.ts ?? '',
      permalink: match.permalink ?? '',
    }));
  } catch {
    // search.messages が使えない場合は空配列
    return [];
  }
}
