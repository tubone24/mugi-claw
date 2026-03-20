import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import type { AppConfig, ScheduledTask } from '../types.js';
import { convertMarkdown } from './markdown-converter.js';

export class Notifier {
  constructor(
    private client: WebClient,
    private config: AppConfig,
    private logger: Logger,
  ) {}

  async notify(
    task: ScheduledTask,
    result: { success: boolean; result?: string; error?: string; costUsd?: number; durationMs?: number },
  ): Promise<void> {
    const header = result.success
      ? `*:white_check_mark: タスク完了: ${task.name}*`
      : `*:x: タスク失敗: ${task.name}*`;

    const body = result.success
      ? convertMarkdown(result.result ?? '(結果なし)')
      : `エラー: ${result.error ?? '不明なエラー'}`;

    const costInfo = result.costUsd !== undefined
      ? `\n_コスト: $${result.costUsd.toFixed(4)} | 所要時間: ${((result.durationMs ?? 0) / 1000).toFixed(1)}s_`
      : '';

    const message = `${header}\n${body}${costInfo}`;

    // Split long messages (Slack limit: 4000 chars)
    const chunks = this.splitMessage(message, 4000);

    if (task.notifyType === 'channel' && task.notifyChannel) {
      for (const chunk of chunks) {
        await this.client.chat.postMessage({
          channel: task.notifyChannel,
          text: chunk,
        });
      }
    } else {
      // DM to owner
      const dm = await this.client.conversations.open({ users: this.config.owner.slackUserId });
      const channelId = dm.channel?.id;
      if (!channelId) {
        this.logger.error('DM channel open failed for notification');
        return;
      }
      for (const chunk of chunks) {
        await this.client.chat.postMessage({
          channel: channelId,
          text: chunk,
        });
      }
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) return [text];
    const chunks: string[] = [];
    let remaining = text;
    while (remaining.length > 0) {
      if (remaining.length <= maxLength) {
        chunks.push(remaining);
        break;
      }
      let splitIndex = remaining.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
        splitIndex = maxLength;
      }
      chunks.push(remaining.slice(0, splitIndex));
      remaining = remaining.slice(splitIndex);
    }
    return chunks;
  }
}
