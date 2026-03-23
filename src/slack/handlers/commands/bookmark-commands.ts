import type { WebClient } from '@slack/web-api';

export async function handleBookmarkCommand(
  args: string[],
  client: WebClient,
  channelId: string,
): Promise<string> {
  const action = args[0]?.toLowerCase() ?? 'help';

  switch (action) {
    case 'list':
      return await handleList(client, channelId);
    case 'add':
      return await handleAdd(args.slice(1), client, channelId);
    case 'remove':
    case 'delete':
      return await handleRemove(args.slice(1), client, channelId);
    case 'help':
    default:
      return getBookmarkHelp();
  }
}

interface BookmarkEntry {
  id: string;
  title: string;
  link: string;
  type: string;
  created: number;
}

async function handleList(
  client: WebClient,
  channelId: string,
): Promise<string> {
  try {
    const result = await client.apiCall('bookmarks.list', {
      channel_id: channelId,
    });

    if (!result.ok) {
      return `ブックマークの取得に失敗したわん (${(result as any).error ?? 'unknown'})`;
    }

    const bookmarks = ((result as any).bookmarks ?? []) as BookmarkEntry[];
    if (bookmarks.length === 0) {
      return 'このチャンネルにブックマークはないわん';
    }

    const lines = ['*:bookmark: ブックマーク一覧わん！*', ''];
    for (const bm of bookmarks) {
      if (bm.type === 'link') {
        lines.push(`:link: *${bm.title}* — ${bm.link}`);
      } else {
        lines.push(`:bookmark: *${bm.title}* (${bm.type})`);
      }
    }

    return lines.join('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('missing_scope')) {
      return 'ブックマークの取得にはスコープ `bookmarks:read` が必要わん！Slack App の設定で追加してわん';
    }
    return `ブックマークの取得でエラーが発生したわん: ${message}`;
  }
}

async function handleAdd(
  args: string[],
  client: WebClient,
  channelId: string,
): Promise<string> {
  // Expected: <title> <url>
  if (args.length < 2) {
    return '使い方: `/mugiclaw bookmark add <タイトル> <URL>` わん\n例: `/mugiclaw bookmark add Google https://google.com`';
  }

  // Last arg is URL, everything before is title
  const url = args[args.length - 1]!;
  const title = args.slice(0, -1).join(' ');

  // Basic URL validation
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return 'URLは `http://` または `https://` で始まる必要があるわん';
  }

  try {
    const result = await client.apiCall('bookmarks.add', {
      channel_id: channelId,
      title,
      type: 'link',
      link: url,
    });

    if (result.ok) {
      return `ブックマーク「${title}」を追加したわん！ :bookmark:`;
    }

    return `ブックマークの追加に失敗したわん (${(result as any).error ?? 'unknown'})`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('missing_scope')) {
      return 'ブックマークの追加にはスコープ `bookmarks:write` が必要わん！Slack App の設定で追加してわん';
    }
    return `ブックマークの追加でエラーが発生したわん: ${message}`;
  }
}

async function handleRemove(
  args: string[],
  client: WebClient,
  channelId: string,
): Promise<string> {
  const title = args.join(' ');
  if (!title) {
    return '使い方: `/mugiclaw bookmark remove <タイトル>` わん';
  }

  try {
    // First list bookmarks to find by title
    const listResult = await client.apiCall('bookmarks.list', {
      channel_id: channelId,
    });

    if (!listResult.ok) {
      return `ブックマークの取得に失敗したわん (${(listResult as any).error ?? 'unknown'})`;
    }

    const bookmarks = ((listResult as any).bookmarks ?? []) as BookmarkEntry[];
    const target = bookmarks.find(bm => bm.title.toLowerCase() === title.toLowerCase());

    if (!target) {
      return `ブックマーク「${title}」が見つからないわん`;
    }

    const removeResult = await client.apiCall('bookmarks.remove', {
      channel_id: channelId,
      bookmark_id: target.id,
    });

    if (removeResult.ok) {
      return `ブックマーク「${title}」を削除したわん`;
    }

    return `ブックマークの削除に失敗したわん (${(removeResult as any).error ?? 'unknown'})`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('missing_scope')) {
      return 'ブックマークの操作にはスコープ `bookmarks:write` が必要わん！Slack App の設定で追加してわん';
    }
    return `ブックマークの削除でエラーが発生したわん: ${message}`;
  }
}

function getBookmarkHelp(): string {
  return `*:bookmark: ブックマークコマンドわん！*

\`/mugiclaw bookmark list\` - ブックマーク一覧
\`/mugiclaw bookmark add <タイトル> <URL>\` - ブックマーク追加
\`/mugiclaw bookmark remove <タイトル>\` - ブックマーク削除`;
}
