import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import { nanoid } from 'nanoid';

export interface CredentialField {
  selector: string;
  label: string;
  sensitive?: boolean;
}

export interface CredentialRequest {
  requestId: string;
  site: string;
  fields: CredentialField[];
  timestamp: number;
}

interface PendingCredential {
  request: CredentialRequest;
  resolve: (values: Record<string, string> | null) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class CredentialManager {
  private pending = new Map<string, PendingCredential>();

  constructor(
    private slackClient: WebClient,
    private ownerUserId: string,
    private port: number,
    private logger: Logger,
    private timeoutMs = 5 * 60 * 1000,
  ) {}

  /**
   * クレデンシャル入力をリクエストする。
   * Slack通知を送信し、ユーザーがWeb UIで入力するまでブロックする。
   * 戻り値は { selector: value } のマップ、タイムアウト時はnull。
   */
  async requestCredential(
    site: string,
    fields: CredentialField[],
    context?: { channel: string; threadTs: string },
  ): Promise<Record<string, string> | null> {
    const requestId = nanoid(12);
    const request: CredentialRequest = { requestId, site, fields, timestamp: Date.now() };

    const promise = new Promise<Record<string, string> | null>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger.warn({ requestId, site }, 'クレデンシャル入力タイムアウト');
        resolve(null);
      }, this.timeoutMs);

      this.pending.set(requestId, { request, resolve, timeoutHandle });
    });

    await this.sendNotification(request, context);

    return promise;
  }

  /**
   * Web UIから入力された値でリクエストを解決する。
   * indexedValues は { "field_0": "value", "field_1": "value" } の形式。
   * fieldsの順序に基づいてselectorにマッピングして返す。
   */
  resolve(requestId: string, indexedValues: Record<string, string>): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutHandle);
    this.pending.delete(requestId);

    // field_N → selector へのマッピング
    const values: Record<string, string> = {};
    for (let i = 0; i < pending.request.fields.length; i++) {
      const key = `field_${i}`;
      const field = pending.request.fields[i]!;
      values[field.selector] = indexedValues[key] ?? '';
    }

    pending.resolve(values);
    return true;
  }

  /**
   * Web UI表示用にペンディングリクエスト情報を取得する。
   */
  getPendingRequest(requestId: string): CredentialRequest | undefined {
    return this.pending.get(requestId)?.request;
  }

  private async sendNotification(request: CredentialRequest, context?: { channel: string; threadTs: string }): Promise<void> {
    const fieldLabels = request.fields.map(f => f.label).join(', ');
    const url = `http://localhost:${this.port}/credential/${request.requestId}`;

    let channelId: string;
    let threadTs: string | undefined;

    if (context?.channel && context?.threadTs) {
      channelId = context.channel;
      threadTs = context.threadTs;
    } else {
      const dm = await this.slackClient.conversations.open({ users: this.ownerUserId });
      channelId = dm.channel?.id ?? '';
      if (!channelId) {
        this.logger.error('DM channel open failed for credential notification');
        return;
      }
    }

    await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `\u{1f510} 認証情報の入力が必要です: ${request.site}`,
      blocks: [
        {
          type: 'section',
          text: { type: 'mrkdwn', text: '\u{1f510} *認証情報の入力が必要です*' },
        },
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*サイト:*\n${request.site}` },
            { type: 'mrkdwn', text: `*入力項目:*\n${fieldLabels}` },
          ],
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `\u{1f449} <${url}|入力フォームを開く>\n\u23f0 5分以内に入力してください`,
          },
        },
      ],
    });
  }
}
