import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';
import { nanoid } from 'nanoid';

export interface ApprovalContext {
  channel: string;
  threadTs: string;
}

export interface ApprovalRequest {
  requestId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  sessionId?: string;
  timestamp: number;
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (approved: boolean) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class ApprovalManager {
  private pending = new Map<string, PendingApproval>();
  private timeoutMs: number;

  constructor(
    private slackClient: WebClient,
    private ownerUserId: string,
    private logger: Logger,
    timeoutMs = 10 * 60 * 1000,
  ) {
    this.timeoutMs = timeoutMs;
  }

  async requestApproval(
    toolName: string,
    toolInput: Record<string, unknown>,
    sessionId?: string,
    context?: ApprovalContext,
  ): Promise<boolean> {
    const requestId = nanoid(12);
    const request: ApprovalRequest = { requestId, toolName, toolInput, sessionId, timestamp: Date.now() };

    // Promiseを先にセットしてからSlackメッセージを送信（レースコンディション防止）
    const promise = new Promise<boolean>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger.warn({ requestId, toolName }, '承認タイムアウト - 自動拒否');
        resolve(false);
      }, this.timeoutMs);

      this.pending.set(requestId, { request, resolve, timeoutHandle });
    });

    await this.sendApprovalMessage(request, context);

    return promise;
  }

  resolve(requestId: string, approved: boolean): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    clearTimeout(pending.timeoutHandle);
    this.pending.delete(requestId);
    pending.resolve(approved);
    return true;
  }

  private async sendApprovalMessage(request: ApprovalRequest, context?: ApprovalContext): Promise<void> {
    const inputSummary = this.summarizeInput(request.toolInput);

    // スレッドがあればスレッドに、なければオーナーDMに送信
    let channelId: string;
    let threadTs: string | undefined;

    if (context?.channel && context?.threadTs) {
      channelId = context.channel;
      threadTs = context.threadTs;
    } else {
      const dm = await this.slackClient.conversations.open({ users: this.ownerUserId });
      channelId = dm.channel?.id ?? '';
      if (!channelId) {
        this.logger.error('DM channel open failed for approval');
        return;
      }
    }

    await this.slackClient.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `ツール承認リクエスト: ${request.toolName}`,
      blocks: [
        {
          type: 'section',
          fields: [
            { type: 'mrkdwn', text: `*ツール:*\n\`${request.toolName}\`` },
          ],
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `*入力:*\n\`\`\`${inputSummary}\`\`\`` },
        },
        {
          type: 'actions',
          block_id: `approval_${request.requestId}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: '承認' },
              style: 'primary' as const,
              action_id: 'tool_approve',
              value: request.requestId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: '拒否' },
              style: 'danger' as const,
              action_id: 'tool_deny',
              value: request.requestId,
            },
          ],
        },
      ],
    });
  }

  private summarizeInput(input: Record<string, unknown>): string {
    const str = JSON.stringify(input, null, 2);
    return str.length > 500 ? str.slice(0, 497) + '...' : str;
  }
}
