import type { SlackChannel, SlackMessage } from "./slack-fetcher.js";
import type { SlackThread } from "./slack-reader.js";

export type OutputFormat = "json" | "text";

// ─── formatChannels ──────────────────────────────────────────────

/**
 * チャンネル一覧をフォーマットする。
 */
export function formatChannels(
  channels: SlackChannel[],
  format: OutputFormat
): string {
  if (channels.length === 0) {
    return format === "json" ? "[]" : "チャンネルが見つかりませんでした。";
  }

  if (format === "json") {
    return JSON.stringify(channels, null, 2);
  }

  const lines: string[] = [];
  for (const ch of channels) {
    const typeIndicator = getChannelTypeIndicator(ch.type);
    const unreadMark = ch.unread ? " *" : "";
    lines.push(`${typeIndicator} ${ch.name}${unreadMark}  (${ch.id})`);
  }
  return lines.join("\n");
}

/**
 * チャンネルタイプの表示インジケータを返す。
 */
function getChannelTypeIndicator(type: SlackChannel["type"]): string {
  switch (type) {
    case "channel":
      return "[#channel]";
    case "dm":
      return "[DM]      ";
    case "group":
      return "[Group]   ";
    default:
      return "[?]       ";
  }
}

// ─── formatMessages ──────────────────────────────────────────────

/**
 * メッセージ一覧をフォーマットする。
 */
export function formatMessages(
  messages: SlackMessage[],
  channelName: string,
  format: OutputFormat
): string {
  if (messages.length === 0) {
    return format === "json"
      ? "[]"
      : `${channelName} にメッセージが見つかりませんでした。`;
  }

  if (format === "json") {
    return JSON.stringify(messages, null, 2);
  }

  const lines: string[] = [];
  lines.push(`--- ${channelName} ---`);
  lines.push("");

  for (const msg of messages) {
    const timestamp = formatTimestamp(msg.ts);
    const replyInfo =
      msg.replyCount !== undefined && msg.replyCount > 0
        ? ` (${msg.replyCount} replies)`
        : "";
    const textLines = msg.text.split("\n");
    lines.push(`[${timestamp}] ${msg.user}: ${textLines[0]}${replyInfo}`);

    // 複数行メッセージの 2 行目以降はインデント
    for (let i = 1; i < textLines.length; i++) {
      lines.push(`    ${textLines[i]}`);
    }
  }

  return lines.join("\n");
}

// ─── formatThread ────────────────────────────────────────────────

/**
 * スレッドをフォーマットする。
 */
export function formatThread(
  thread: SlackThread,
  format: OutputFormat
): string {
  if (!thread.parent.ts && !thread.parent.text) {
    return format === "json"
      ? JSON.stringify(thread, null, 2)
      : "スレッドが見つかりませんでした。";
  }

  if (format === "json") {
    return JSON.stringify(thread, null, 2);
  }

  const lines: string[] = [];

  // 親メッセージ
  const parentTs = formatTimestamp(thread.parent.ts);
  const parentTextLines = thread.parent.text.split("\n");
  lines.push(`[${parentTs}] ${thread.parent.user}: ${parentTextLines[0]}`);
  for (let i = 1; i < parentTextLines.length; i++) {
    lines.push(`    ${parentTextLines[i]}`);
  }

  if (thread.replies.length > 0) {
    lines.push("");
    lines.push(`  --- ${thread.replies.length} 件の返信 ---`);
    lines.push("");

    for (const reply of thread.replies) {
      const replyTs = formatTimestamp(reply.ts);
      const replyTextLines = reply.text.split("\n");
      lines.push(`  [${replyTs}] ${reply.user}: ${replyTextLines[0]}`);
      for (let i = 1; i < replyTextLines.length; i++) {
        lines.push(`      ${replyTextLines[i]}`);
      }
    }
  } else {
    lines.push("");
    lines.push("  (返信なし)");
  }

  return lines.join("\n");
}

// ─── ユーティリティ ──────────────────────────────────────────────

/**
 * Slack タイムスタンプ (例: "1234567890.123456") を読みやすい形式に変換する。
 */
function formatTimestamp(ts: string): string {
  if (!ts) return "----/--/-- --:--";

  // ts は "epoch.microseconds" 形式
  const epochSeconds = parseFloat(ts);
  if (isNaN(epochSeconds)) return ts;

  const date = new Date(epochSeconds * 1000);
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");

  return `${y}/${mo}/${d} ${h}:${mi}`;
}
