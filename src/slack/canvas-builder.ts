import type { ThreadMessage } from '../types.js';

export interface CanvasDocument {
  type: 'markdown';
  markdown: string;
}

export function buildCanvasDocument(
  title: string,
  messages: ThreadMessage[],
  channelName?: string,
): CanvasDocument {
  // Build markdown with:
  // - Title as # header
  // - Channel name and date context
  // - Messages formatted with sender and timestamp
  // - Bot messages labeled as "むぎぼー"
  // - Code blocks preserved
  // - Each message as a section

  const parts: string[] = [];
  parts.push(`# ${title}`);
  parts.push('');

  if (channelName) {
    parts.push(`> チャンネル: #${channelName}`);
  }

  const date = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  parts.push(`> 作成日時: ${date}`);
  parts.push('');
  parts.push('---');
  parts.push('');

  for (const msg of messages) {
    const sender = msg.botId ? 'むぎぼー' : `<@${msg.user}>`;
    const time = formatTimestamp(msg.ts);
    parts.push(`**${sender}** (${time})`);
    parts.push('');
    parts.push(msg.text);
    parts.push('');
  }

  return {
    type: 'markdown',
    markdown: parts.join('\n'),
  };
}

export function buildSummaryCanvasDocument(
  title: string,
  summary: string,
  channelName?: string,
): CanvasDocument {
  const parts: string[] = [];
  parts.push(`# ${title}`);
  parts.push('');

  if (channelName) {
    parts.push(`> チャンネル: #${channelName}`);
  }

  const date = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric', month: 'long', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
  parts.push(`> 作成日時: ${date}`);
  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push(summary);

  return {
    type: 'markdown',
    markdown: parts.join('\n'),
  };
}

function formatTimestamp(ts: string): string {
  const unixSeconds = parseFloat(ts);
  if (isNaN(unixSeconds)) return ts;
  const date = new Date(unixSeconds * 1000);
  return date.toLocaleString('ja-JP', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
