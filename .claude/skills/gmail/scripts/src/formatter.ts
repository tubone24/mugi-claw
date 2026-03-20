import type { GmailMessage } from "./gmail-fetcher.js";
import type { GmailThread } from "./gmail-reader.js";
import type { DownloadResult } from "./gmail-downloader.js";

export type OutputFormat = "json" | "text";

export function formatMailList(
  messages: GmailMessage[],
  format: OutputFormat
): string {
  if (messages.length === 0) {
    return format === "json" ? "[]" : "メールはありません。";
  }

  if (format === "json") {
    return JSON.stringify(messages, null, 2);
  }

  const lines: string[] = [];
  lines.push(`メール一覧 (${messages.length} 件)`);
  lines.push("─".repeat(60));

  for (const msg of messages) {
    const unreadMark = msg.unread ? "[未読] " : "";
    lines.push(`${unreadMark}${msg.subject}`);
    lines.push(`  差出人: ${msg.from}`);
    lines.push(`  日時: ${msg.date}`);
    if (msg.snippet) {
      lines.push(`  概要: ${msg.snippet}`);
    }
    lines.push(`  スレッドID: ${msg.threadId}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatThread(
  thread: GmailThread,
  format: OutputFormat
): string {
  if (format === "json") {
    return JSON.stringify(thread, null, 2);
  }

  const lines: string[] = [];
  lines.push(`件名: ${thread.subject}`);
  lines.push("═".repeat(60));

  for (let i = 0; i < thread.messages.length; i++) {
    const msg = thread.messages[i];
    lines.push(`[メッセージ ${i + 1}]`);
    lines.push(`  差出人: ${msg.from}`);
    if (msg.to) lines.push(`  宛先: ${msg.to}`);
    lines.push(`  日時: ${msg.date}`);
    lines.push("─".repeat(40));
    lines.push(msg.body);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function formatDownloadResults(
  results: DownloadResult[],
  format: OutputFormat
): string {
  if (results.length === 0) {
    return format === "json" ? "[]" : "ダウンロードしたファイルはありません。";
  }

  if (format === "json") {
    return JSON.stringify(results, null, 2);
  }

  const lines: string[] = [];
  lines.push(`ダウンロード完了 (${results.length} 件)`);
  for (const r of results) {
    lines.push(`  ${r.filename} → ${r.path}`);
  }

  return lines.join("\n").trimEnd();
}
