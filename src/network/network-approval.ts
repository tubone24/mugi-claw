import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import { nanoid } from 'nanoid';

export interface NetworkApprovalResult {
  approved: boolean;
  permanent: boolean;
}

interface PendingNetworkApproval {
  requestId: string;
  hostname: string;
  port: number;
  resolve: (result: NetworkApprovalResult) => void;
  timeoutHandle: NodeJS.Timeout;
}

export class NetworkApprovalManager {
  private pending = new Map<string, PendingNetworkApproval>();
  private timeoutMs: number;

  constructor(
    private app: App,
    private ownerUserId: string,
    private logger: Logger,
    timeoutMs = 10 * 60 * 1000,
  ) {
    this.timeoutMs = timeoutMs;
    this.registerHandlers();
  }

  async requestNetworkApproval(
    hostname: string,
    port: number,
    sessionContext: { channel: string; threadTs: string },
  ): Promise<NetworkApprovalResult> {
    const requestId = nanoid(12);

    const promise = new Promise<NetworkApprovalResult>((resolve) => {
      const timeoutHandle = setTimeout(() => {
        this.pending.delete(requestId);
        this.logger.warn({ requestId, hostname, port }, 'Network approval timeout - auto deny');
        resolve({ approved: false, permanent: false });
      }, this.timeoutMs);

      this.pending.set(requestId, { requestId, hostname, port, resolve, timeoutHandle });
    });

    await this.sendApprovalMessage(requestId, hostname, port, sessionContext);

    return promise;
  }

  resolve(requestId: string, action: 'once' | 'permanent' | 'deny'): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;

    clearTimeout(pending.timeoutHandle);
    this.pending.delete(requestId);

    switch (action) {
      case 'once':
        pending.resolve({ approved: true, permanent: false });
        break;
      case 'permanent':
        pending.resolve({ approved: true, permanent: true });
        break;
      case 'deny':
        pending.resolve({ approved: false, permanent: false });
        break;
    }

    return true;
  }

  private async sendApprovalMessage(
    requestId: string,
    hostname: string,
    port: number,
    context: { channel: string; threadTs: string },
  ): Promise<void> {
    const target = port === 443 ? hostname : `${hostname}:${port}`;

    let channelId: string;
    let threadTs: string | undefined;

    if (context.channel && context.threadTs) {
      channelId = context.channel;
      threadTs = context.threadTs;
    } else {
      const dm = await this.app.client.conversations.open({ users: this.ownerUserId });
      channelId = dm.channel?.id ?? '';
      if (!channelId) {
        this.logger.error('DM channel open failed for network approval');
        return;
      }
    }

    await this.app.client.chat.postMessage({
      channel: channelId,
      thread_ts: threadTs,
      text: `Network access request: ${target}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `:globe_with_meridians: *Network Access Request*\nHost: \`${target}\``,
          },
        },
        {
          type: 'actions',
          block_id: `net_approval_${requestId}`,
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Allow Once' },
              style: 'primary' as const,
              action_id: 'network_approve_once',
              value: requestId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Allow Permanently' },
              action_id: 'network_approve_permanent',
              value: requestId,
            },
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Deny' },
              style: 'danger' as const,
              action_id: 'network_deny',
              value: requestId,
            },
          ],
        },
      ],
    });
  }

  private registerHandlers(): void {
    type BlockAction = import('@slack/bolt').BlockAction<import('@slack/bolt').ButtonAction>;

    this.app.action<BlockAction>('network_approve_once', async ({ ack, body, respond }) => {
      await ack();
      const requestId = body.actions[0]?.value;
      if (!requestId) return;
      const userId = body.user.id;
      if (userId !== this.ownerUserId) {
        await respond({
          replace_original: false,
          text: 'オーナーのみが承認できます。',
        });
        return;
      }
      const resolved = this.resolve(requestId, 'once');
      this.logger.info({ requestId, userId, resolved }, 'Network approval: allow once');

      await respond({
        replace_original: true,
        text: resolved
          ? `:white_check_mark: *Allowed once* by <@${userId}> (ID: \`${requestId}\`)`
          : `:warning: This request has already been processed`,
      });
    });

    this.app.action<BlockAction>('network_approve_permanent', async ({ ack, body, respond }) => {
      await ack();
      const requestId = body.actions[0]?.value;
      if (!requestId) return;
      const userId = body.user.id;
      if (userId !== this.ownerUserId) {
        await respond({
          replace_original: false,
          text: 'オーナーのみが承認できます。',
        });
        return;
      }
      const resolved = this.resolve(requestId, 'permanent');
      this.logger.info({ requestId, userId, resolved }, 'Network approval: allow permanently');

      await respond({
        replace_original: true,
        text: resolved
          ? `:white_check_mark: *Allowed permanently* by <@${userId}> (ID: \`${requestId}\`)`
          : `:warning: This request has already been processed`,
      });
    });

    this.app.action<BlockAction>('network_deny', async ({ ack, body, respond }) => {
      await ack();
      const requestId = body.actions[0]?.value;
      if (!requestId) return;
      const userId = body.user.id;
      if (userId !== this.ownerUserId) {
        await respond({
          replace_original: false,
          text: 'オーナーのみが承認できます。',
        });
        return;
      }
      const resolved = this.resolve(requestId, 'deny');
      this.logger.info({ requestId, userId, resolved }, 'Network approval: deny');

      await respond({
        replace_original: true,
        text: resolved
          ? `:x: *Denied* by <@${userId}> (ID: \`${requestId}\`)`
          : `:warning: This request has already been processed`,
      });
    });
  }
}
