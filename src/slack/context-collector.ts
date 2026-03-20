import type { WebClient } from '@slack/web-api';
import type { SlackContext, ThreadMessage, SearchResult } from '../types.js';

export async function collectContext(
  client: WebClient,
  channel: string,
  threadTs: string,
  userMessage: string,
  userId: string,
  userToken?: string,
): Promise<SlackContext> {
  // スレッドメッセージ取得
  const threadMessages = await getThreadMessages(client, channel, threadTs);

  // 横断検索（User Tokenがあれば search.messages を使用）
  const searchResults = await searchMessages(client, userMessage, userToken);

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
  userToken?: string,
): Promise<SearchResult[]> {
  if (!userToken) {
    // User Token がないと search.messages は使えない
    return [];
  }

  try {
    // search.messages は User Token (xoxp-) が必要
    const result = await client.search.messages({
      token: userToken,
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
