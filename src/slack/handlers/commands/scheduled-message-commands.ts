import type { WebClient } from '@slack/web-api';
import { buildScheduledMessageModal } from './scheduled-message-modal.js';

export async function handleScheduledMessageCommand(
  args: string[],
  client: WebClient,
  options?: { triggerId?: string; userId?: string; channelId?: string },
): Promise<string> {
  const action = args[0]?.toLowerCase() ?? 'help';

  switch (action) {
    case 'list':
      return await handleList(client, options?.channelId);
    case 'add':
      return await handleAdd(args.slice(1), client, options);
    case 'cancel':
    case 'delete':
      return await handleCancel(args.slice(1), client, options?.channelId);
    case 'help':
    default:
      return getScheduledMessageHelp();
  }
}

async function handleList(
  client: WebClient,
  channelId?: string,
): Promise<string> {
  try {
    const result = await client.chat.scheduledMessages.list({
      ...(channelId ? { channel: channelId } : {}),
    });

    const messages = (result as any).scheduled_messages ?? [];
    if (messages.length === 0) {
      return '予約されたメッセージはないわん';
    }

    const lines = ['*:clock3: 予約メッセージ一覧わん！*', ''];
    for (const msg of messages) {
      const postAt = new Date(msg.post_at * 1000);
      const dateStr = postAt.toLocaleString('ja-JP', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        timeZone: 'Asia/Tokyo',
      });
      const textPreview = (msg.text ?? '').slice(0, 60) + ((msg.text ?? '').length > 60 ? '...' : '');
      const channelStr = msg.channel_id ? `<#${msg.channel_id}>` : '不明';
      lines.push(`:envelope: *${dateStr}* → ${channelStr}`);
      lines.push(`    ${textPreview}`);
      lines.push(`    ID: \`${msg.id}\``);
    }

    return lines.join('\n');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `予約メッセージの取得に失敗したわん: ${message}`;
  }
}

async function handleAdd(
  args: string[],
  client: WebClient,
  options?: { triggerId?: string; userId?: string; channelId?: string },
): Promise<string> {
  // No args → open modal
  if (args.length === 0 && options?.triggerId) {
    try {
      await client.views.open({
        trigger_id: options.triggerId,
        view: buildScheduledMessageModal(),
      });
      return ''; // Empty string signals modal was opened
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `モーダルの表示に失敗したわん: ${message}`;
    }
  }

  // Text-based: /mugiclaw msg add <channel> <YYYY-MM-DD> <HH:MM> <message>
  if (args.length < 4) {
    return '使い方: `/mugiclaw msg add <#channel> <YYYY-MM-DD> <HH:MM> <メッセージ>` わん\nまたは `/mugiclaw msg add` でモーダルを開くわん';
  }

  const channelArg = args[0]!;
  const dateStr = args[1]!;
  const timeStr = args[2]!;
  const text = args.slice(3).join(' ');

  // Parse channel ID from <#C123|channel-name> or plain ID
  const channelMatch = channelArg.match(/<#([A-Z0-9]+)(?:\|[^>]*)?>/) ?? channelArg.match(/^([A-Z0-9]+)$/);
  const channel = channelMatch?.[1];
  if (!channel) {
    return 'チャンネルの指定が正しくないわん。`<#channel>` 形式か、チャンネルIDを指定してわん';
  }

  // Parse date and time
  const postAt = parseDateTime(dateStr, timeStr);
  if (!postAt) {
    return '日時の形式が正しくないわん。`YYYY-MM-DD HH:MM` 形式で指定してわん';
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (postAt <= nowSec) {
    return '過去の日時には予約できないわん！未来の日時を指定してわん';
  }

  try {
    await client.chat.scheduleMessage({
      channel,
      text,
      post_at: postAt,
    });

    const scheduledDate = new Date(postAt * 1000).toLocaleString('ja-JP', {
      year: 'numeric', month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
      timeZone: 'Asia/Tokyo',
    });
    return `メッセージを予約したわん！ :clock3:\n日時: ${scheduledDate}\nチャンネル: <#${channel}>`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `メッセージの予約に失敗したわん: ${message}`;
  }
}

async function handleCancel(
  args: string[],
  client: WebClient,
  channelId?: string,
): Promise<string> {
  const messageId = args[0];
  if (!messageId) {
    return '使い方: `/mugiclaw msg cancel <scheduled_message_id>` わん\nIDは `/mugiclaw msg list` で確認できるわん';
  }

  if (!channelId) {
    return 'チャンネルが特定できないわん';
  }

  try {
    await client.chat.deleteScheduledMessage({
      channel: channelId,
      scheduled_message_id: messageId,
    });
    return `予約メッセージ \`${messageId}\` をキャンセルしたわん`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return `予約メッセージのキャンセルに失敗したわん: ${message}`;
  }
}

function getScheduledMessageHelp(): string {
  return `*:clock3: 予約メッセージコマンドわん！*

\`/mugiclaw msg list\` - 予約メッセージ一覧
\`/mugiclaw msg add\` - モーダルで予約作成
\`/mugiclaw msg add <#channel> <YYYY-MM-DD> <HH:MM> <メッセージ>\` - テキストで予約作成
\`/mugiclaw msg cancel <ID>\` - 予約キャンセル`;
}

/** Parse date (YYYY-MM-DD) and time (HH:MM) into Unix timestamp (seconds) in JST */
export function parseDateTime(dateStr: string, timeStr: string): number | null {
  const dateMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;

  // Parse in JST (Asia/Tokyo = UTC+9)
  const isoString = `${year}-${month}-${day}T${hour!.padStart(2, '0')}:${minute}:00+09:00`;
  const date = new Date(isoString);
  if (isNaN(date.getTime())) return null;

  return Math.floor(date.getTime() / 1000);
}
