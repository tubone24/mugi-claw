import type { App } from '@slack/bolt';
import type { BlockAction, ButtonAction } from '@slack/bolt';
import type { Logger } from 'pino';
import type { ApprovalManager } from './approval-manager.js';

export function registerApprovalHandlers(
  app: App,
  approvalManager: ApprovalManager,
  logger: Logger,
): void {
  app.action<BlockAction<ButtonAction>>('tool_approve', async ({ ack, body, respond }) => {
    await ack();
    const requestId = body.actions[0]?.value;
    if (!requestId) return;
    const userId = body.user.id;
    const resolved = approvalManager.resolve(requestId, true);
    logger.info({ requestId, userId, resolved }, 'ツール承認: 許可');

    await respond({
      replace_original: true,
      text: resolved
        ? `:white_check_mark: *承認済み* by <@${userId}> (ID: \`${requestId}\`)`
        : `:warning: このリクエストは既に処理済みです`,
    });
  });

  app.action<BlockAction<ButtonAction>>('tool_deny', async ({ ack, body, respond }) => {
    await ack();
    const requestId = body.actions[0]?.value;
    if (!requestId) return;
    const userId = body.user.id;
    const resolved = approvalManager.resolve(requestId, false);
    logger.info({ requestId, userId, resolved }, 'ツール承認: 拒否');

    await respond({
      replace_original: true,
      text: resolved
        ? `:x: *拒否* by <@${userId}> (ID: \`${requestId}\`)`
        : `:warning: このリクエストは既に処理済みです`,
    });
  });
}
