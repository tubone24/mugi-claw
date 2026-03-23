import type { WebClient } from '@slack/web-api';
import { buildCanvasDocument } from '../../canvas-builder.js';
import type { ThreadMessage } from '../../../types.js';

export async function handleCanvasCommand(
  args: string[],
  client: WebClient,
  channelId: string,
  userId: string,
): Promise<string> {
  const action = args[0]?.toLowerCase() ?? 'help';

  switch (action) {
    case 'create':
      return await handleCreate(args.slice(1), client, channelId, userId);
    case 'help':
    default:
      return getCanvasHelp();
  }
}

async function handleCreate(
  args: string[],
  client: WebClient,
  channelId: string,
  _userId: string,
): Promise<string> {
  const title = args.join(' ') || 'スレッドまとめ';

  try {
    // Get recent channel messages for context
    const history = await client.conversations.history({
      channel: channelId,
      limit: 50,
    });

    const messages: ThreadMessage[] = (history.messages ?? [])
      .reverse()
      .map(msg => ({
        user: (msg as any).user ?? 'unknown',
        text: (msg as any).text ?? '',
        ts: (msg as any).ts ?? '',
        botId: (msg as any).bot_id,
      }));

    if (messages.length === 0) {
      return 'まとめるメッセージが見つからなかったわん';
    }

    // Get channel info for name
    let channelName: string | undefined;
    try {
      const info = await client.conversations.info({ channel: channelId });
      channelName = (info.channel as any)?.name;
    } catch {
      // ignore - channel name is optional
    }

    const doc = buildCanvasDocument(title, messages, channelName);

    // チャンネルCanvasとして作成を試みる（チャンネルメンバーに自動的に見える）
    let canvasId: string | undefined;
    let usedChannelCanvas = false;

    try {
      const channelResult = await client.apiCall('conversations.canvases.create', {
        channel_id: channelId,
        document_content: doc,
      });
      if (channelResult.ok && (channelResult as any).canvas_id) {
        canvasId = (channelResult as any).canvas_id;
        usedChannelCanvas = true;
      }
    } catch {
      // チャンネルCanvasが既に存在する場合など、フォールバック
    }

    // チャンネルCanvas作成失敗時はスタンドアロンCanvasを作成
    if (!canvasId) {
      const result = await client.apiCall('canvases.create', {
        title,
        document_content: doc,
      });

      if (result.ok && (result as any).canvas_id) {
        canvasId = (result as any).canvas_id;

        // アクセス権をチャンネルメンバーに付与
        try {
          await client.apiCall('canvases.access.set', {
            canvas_id: canvasId,
            channel_ids: [channelId],
            access_level: 'write',
          });
        } catch {
          // アクセス権設定失敗は無視（Canvasは作成済み）
        }
      }
    }

    if (canvasId) {
      const note = usedChannelCanvas
        ? 'チャンネルのCanvasタブから確認できるわん'
        : 'Canvasアプリから確認できるわん';
      return `Canvas「${title}」を作成したわん！ :page_facing_up:\n${note}`;
    }

    return 'Canvas の作成に失敗したわん...';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('missing_scope')) {
      return 'Canvas の作成にはスコープ `canvases:write` が必要わん！Slack App の設定で追加してわん';
    }
    return `Canvas の作成でエラーが発生したわん: ${message}`;
  }
}

function getCanvasHelp(): string {
  return `*:page_facing_up: Canvas コマンドわん！*

\`/mugiclaw canvas create <タイトル>\` - チャンネルの会話をCanvasにまとめる
\`/mugiclaw canvas help\` - このヘルプを表示`;
}
