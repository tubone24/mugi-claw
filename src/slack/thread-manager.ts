import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename } from 'node:path';
import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import type { ProgressUpdate } from '../types.js';
import { convertMarkdown } from './markdown-converter.js';

const SLACK_MAX_LENGTH = 4000;
const UPDATE_DEBOUNCE_MS = 2000;
const STATUS_TEXT_MAX_LENGTH = 100;

export class ThreadManager {
  private statusMessageTs: string | null = null;
  private lastUpdateTime = 0;
  private pendingUpdate: NodeJS.Timeout | null = null;
  private currentStatus = '';

  constructor(
    private client: WebClient,
    private channel: string,
    private threadTs: string,
    private logger: Logger,
  ) {}

  async postThinking(): Promise<void> {
    const result = await this.client.chat.postMessage({
      channel: this.channel,
      thread_ts: this.threadTs,
      text: '\u{1F415} 考え中わん...',
    });
    this.statusMessageTs = result.ts ?? null;
  }

  async updateProgress(update: ProgressUpdate): Promise<void> {
    if (update.type === 'tool_use' && update.toolName) {
      this.currentStatus = this.getToolEmoji(update.toolName) + ' ' + update.content;
    } else if (update.type === 'text') {
      // 途中のテキストをステータスバーに表示
      const truncated = update.content.length > STATUS_TEXT_MAX_LENGTH
        ? update.content.slice(0, STATUS_TEXT_MAX_LENGTH) + '...'
        : update.content;
      this.currentStatus = '\u{1F4AC} ' + truncated;
    }

    // デバウンス（Slack API レート制限対応: update 3回/秒）
    const now = Date.now();
    if (now - this.lastUpdateTime < UPDATE_DEBOUNCE_MS) {
      if (this.pendingUpdate) clearTimeout(this.pendingUpdate);
      this.pendingUpdate = setTimeout(() => {
        void this.doStatusUpdate();
      }, UPDATE_DEBOUNCE_MS);
      return;
    }

    await this.doStatusUpdate();
  }

  async postResult(result: string): Promise<void> {
    // ペンディング更新をキャンセル
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    // ステータスメッセージを完了に更新
    if (this.statusMessageTs) {
      try {
        await this.client.chat.update({
          channel: this.channel,
          ts: this.statusMessageTs,
          text: '\u2705 完了わん！',
        });
      } catch (err) {
        this.logger.warn({ err }, 'ステータスメッセージ更新失敗');
      }
    }

    // 結果を新規メッセージで投稿（長文は分割）
    const converted = convertMarkdown(result);
    if (!converted.trim()) return; // 空結果は投稿しない

    const chunks = this.splitMessage(converted);

    for (const chunk of chunks) {
      await this.client.chat.postMessage({
        channel: this.channel,
        thread_ts: this.threadTs,
        text: chunk,
      });
    }
  }

  async postError(message: string): Promise<void> {
    if (this.pendingUpdate) {
      clearTimeout(this.pendingUpdate);
      this.pendingUpdate = null;
    }

    // ステータスメッセージをエラーに更新
    if (this.statusMessageTs) {
      try {
        await this.client.chat.update({
          channel: this.channel,
          ts: this.statusMessageTs,
          text: `\u274C エラーわん: ${message}`,
        });
      } catch (err) {
        this.logger.warn({ err }, 'エラーメッセージ更新失敗');
      }
    }
  }

  private async doStatusUpdate(): Promise<void> {
    if (!this.statusMessageTs || !this.currentStatus) return;

    try {
      await this.client.chat.update({
        channel: this.channel,
        ts: this.statusMessageTs,
        text: this.currentStatus,
      });
      this.lastUpdateTime = Date.now();
    } catch (err) {
      this.logger.warn({ err }, 'ステータス更新失敗');
    }
  }

  private getToolEmoji(toolName: string): string {
    const emojiMap: Record<string, string> = {
      browser_navigate: '\u{1F310}',
      browser_click: '\u{1F446}',
      browser_type: '\u2328\uFE0F',
      browser_screenshot: '\u{1F4F8}',
      browser_get_text: '\u{1F4C4}',
      browser_secure_input: '\u{1F510}',
      Read: '\u{1F4D6}',
      Edit: '\u270F\uFE0F',
      Write: '\u{1F4DD}',
      Bash: '\u{1F4BB}',
      Grep: '\u{1F50D}',
      Glob: '\u{1F4C2}',
    };
    return emojiMap[toolName] ?? '\u2699\uFE0F';
  }

  async uploadScreenshot(base64Data: string, filename = 'screenshot.png'): Promise<void> {
    try {
      const buffer = Buffer.from(base64Data, 'base64');
      await this.client.filesUploadV2({
        channel_id: this.channel,
        thread_ts: this.threadTs,
        file: buffer,
        filename,
      });
    } catch (err) {
      this.logger.error({ err }, 'スクリーンショットのアップロード失敗');
    }
  }

  async uploadFile(filePath: string, comment?: string): Promise<void> {
    try {
      await access(filePath);
    } catch {
      this.logger.error({ filePath }, 'ファイルが存在しないわん');
      return;
    }

    try {
      const fileStream = createReadStream(filePath);
      const filename = basename(filePath);
      await this.client.filesUploadV2({
        channel_id: this.channel,
        thread_ts: this.threadTs,
        file: fileStream,
        filename,
        initial_comment: comment,
      });
    } catch (err) {
      this.logger.error({ err, filePath }, 'ファイルのアップロード失敗');
    }
  }

  private splitMessage(text: string): string[] {
    if (text.length <= SLACK_MAX_LENGTH) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= SLACK_MAX_LENGTH) {
        chunks.push(remaining);
        break;
      }

      // 改行位置で分割を試みる
      let splitIndex = remaining.lastIndexOf('\n', SLACK_MAX_LENGTH);
      if (splitIndex === -1 || splitIndex < SLACK_MAX_LENGTH * 0.5) {
        splitIndex = SLACK_MAX_LENGTH;
      }

      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex);
    }

    return chunks;
  }
}
