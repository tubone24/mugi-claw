import { loadConfig } from './config.js';
import { createSlackApp } from './slack/app.js';
import { registerMentionHandler } from './slack/handlers/mention-handler.js';
import { registerCommandHandler } from './slack/handlers/command-handler.js';
import { registerHomeTabHandler } from './slack/handlers/home-tab-handler.js';
import { ChromeLauncher } from './browser/chrome-launcher.js';
import { initDb, closeDb } from './db/database.js';
import { SettingsStore } from './db/settings-store.js';
import { ProfileStore } from './profile/profile-store.js';
import { ProfileOnboarding } from './profile/profile-onboarding.js';
import { TaskStore } from './scheduler/task-store.js';
import { ReactionTriggerStore } from './reaction/reaction-trigger-store.js';
import { registerReactionHandler } from './slack/handlers/reaction-handler.js';
import { ListStore } from './slack/list-store.js';
import { SCHEDULED_MESSAGE_MODAL_CALLBACK_ID, parseScheduledMessageModalValues } from './slack/handlers/commands/scheduled-message-modal.js';
import { TaskRunner } from './scheduler/task-runner.js';
import { Scheduler } from './scheduler/scheduler.js';
import { Notifier } from './slack/notifier.js';
import { SCHEDULE_MODAL_CALLBACK_ID, parseModalValues } from './slack/handlers/commands/schedule-modal.js';
import cron from 'node-cron';
import { ApprovalManager } from './approval/approval-manager.js';
import { ApprovalServer } from './approval/approval-server.js';
import { CredentialManager } from './credential/credential-manager.js';
import { CredentialServer } from './credential/credential-server.js';
import { registerApprovalHandlers } from './approval/register-handlers.js';
import { WhitelistStore } from './network/whitelist-store.js';
import { NetworkApprovalManager } from './network/network-approval.js';
import { ProxyServer } from './network/proxy-server.js';
import { UsageMonitor } from './usage/usage-monitor.js';
import pino from 'pino';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main() {
  logger.info('mugi-claw を起動するわん...');

  // 1. DB初期化
  initDb(config.db.path);
  logger.info('DB初期化完了');

  // 2. Store初期化
  const settingsStore = new SettingsStore();
  const profileStore = new ProfileStore();
  const taskStore = new TaskStore();
  const reactionTriggerStore = new ReactionTriggerStore();
  const listStore = new ListStore();

  // 3. Chrome CDP 起動（既に起動済みならスキップ）
  const chrome = new ChromeLauncher(config.browser.debuggingPort, config.browser.userDataDir, logger);
  try {
    await chrome.launch();
  } catch (err) {
    logger.warn({ err }, 'Chrome 起動失敗 - ブラウザ操作は無効わん');
  }

  // 4. Slack App作成
  const app = createSlackApp(config);

  // 4.5. ツール承認システム初期化
  const approvalManager = new ApprovalManager(app.client, config.owner.slackUserId, logger);
  const credentialManager = new CredentialManager(app.client, config.owner.slackUserId, config.credential.port, logger);
  const approvalServer = new ApprovalServer(approvalManager, app.client, config.approval.port, logger, credentialManager);
  await approvalServer.start();
  const credentialServer = new CredentialServer(credentialManager, config.credential.port, logger);
  await credentialServer.start();
  registerApprovalHandlers(app, approvalManager, logger);

  // 4.6. ネットワークプロキシ初期化（sandbox有効時）
  const whitelistStore = config.sandbox.enabled ? new WhitelistStore(config.network.defaultWhitelist) : null;
  let proxyServer: ProxyServer | null = null;
  if (config.sandbox.enabled && whitelistStore) {
    whitelistStore.seedDefaults();
    const networkApproval = new NetworkApprovalManager(app, config.owner.slackUserId, logger);
    proxyServer = new ProxyServer(whitelistStore, networkApproval, config.network.proxyPort, logger);
    await proxyServer.start();
    logger.info({ port: config.network.proxyPort }, 'Network proxy started');

    proxyServer.setOnDenied(async (hostname, port) => {
      const target = port === 443 ? hostname : `${hostname}:${port}`;
      try {
        const dm = await app.client.conversations.open({ users: config.owner.slackUserId });
        if (!dm.channel?.id) {
          logger.warn({ hostname, port, slackUserId: config.owner.slackUserId }, 'DM channel open failed - no channel ID');
          return;
        }
        await app.client.chat.postMessage({
          channel: dm.channel.id,
          text: `:no_entry: ネットワークアクセスがブロックされたわん\nHost: \`${target}\`\nホワイトリストに追加するには Home タブから設定してわん`,
        });
        logger.debug({ hostname, port }, 'Network denied DM sent');
      } catch (err) {
        logger.error({ err, hostname, port }, 'Failed to send denied notification DM');
        throw err; // notifyDenied のクールダウンクリアのために再throw
      }
    });
  }

  // 5. Notifier, TaskRunner, Scheduler作成
  const notifier = new Notifier(app.client, config, logger);
  const taskRunner = new TaskRunner(config, taskStore, settingsStore, profileStore, logger);
  const scheduler = new Scheduler(taskStore, taskRunner, notifier, logger);

  // 6. ProfileOnboarding作成
  const profileOnboarding = new ProfileOnboarding(app.client, profileStore, logger);

  // 6.5. UsageMonitor 初期化
  const usageMonitor = new UsageMonitor(app.client, logger);

  // 7. ハンドラー登録
  registerMentionHandler(app, config, logger, profileStore, profileOnboarding, settingsStore, taskStore, scheduler, listStore, reactionTriggerStore);
  registerCommandHandler(app, profileStore, taskStore, scheduler, reactionTriggerStore, settingsStore, listStore, logger, config.owner.slackUserId);
  registerReactionHandler(app, config, logger, reactionTriggerStore, settingsStore);
  registerHomeTabHandler(app, config, profileStore, taskStore, scheduler, settingsStore, whitelistStore, listStore, logger, usageMonitor);

  // 8. Block Kit インタラクション（プロフィールオンボーディング）
  app.action('profile_submit', async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      const message = body as unknown as { message?: { blocks?: Array<Record<string, unknown>> }; state?: { values: Record<string, Record<string, { value?: string; selected_option?: { value: string } }>> } };
      const state = message.state?.values;
      if (state) {
        profileOnboarding.handleSubmit(userId, state);
        // Send confirmation
        const dm = await client.conversations.open({ users: userId });
        if (dm.channel?.id) {
          await client.chat.postMessage({
            channel: dm.channel.id,
            text: 'プロフィールを登録したわん！ありがとうわん！ 🐕',
          });
        }
      }
    } catch (err) {
      logger.error({ err }, 'プロフィール登録処理エラー');
    }
  });

  app.action('profile_skip', async ({ ack, body, client }) => {
    await ack();
    try {
      const userId = body.user.id;
      profileOnboarding.handleSkip(userId);
      const dm = await client.conversations.open({ users: userId });
      if (dm.channel?.id) {
        await client.chat.postMessage({
          channel: dm.channel.id,
          text: 'スキップしたわん！あとからでも `/mugiclaw profile set` で設定できるわん！',
        });
      }
    } catch (err) {
      logger.error({ err }, 'プロフィールスキップ処理エラー');
    }
  });

  // 8.5. スケジュールモーダルsubmitハンドラ
  app.view(SCHEDULE_MODAL_CALLBACK_ID, async ({ ack, body, view, client }) => {
    try {
      const values = parseModalValues(view.state.values);

      // Validate cron expression
      if (!cron.validate(values.cronExpression)) {
        await ack({
          response_action: 'errors',
          errors: {
            cron_expression: '無効なcron式わん。形式: 分 時 日 月 曜日 (例: 0 9 * * *)',
          },
        });
        return;
      }

      // Validate channel selection when notify type is channel
      if (values.notifyType === 'channel' && !values.notifyChannel) {
        await ack({
          response_action: 'errors',
          errors: {
            notify_channel: 'チャンネル通知を選択した場合、チャンネルを指定してわん',
          },
        });
        return;
      }

      // Check if editing or creating
      let metadata: { taskId?: string } = {};
      if (view.private_metadata) {
        try {
          const parsed = JSON.parse(view.private_metadata);
          if (typeof parsed.taskId === 'string') {
            metadata = { taskId: parsed.taskId };
          }
        } catch {
          // Invalid metadata — treat as new creation
        }
      }
      const taskId = metadata.taskId;
      const isEdit = !!taskId;

      if (isEdit) {
        // Update existing task
        const existingTask = taskStore.getTask(taskId);
        if (!existingTask) {
          await ack({
            response_action: 'errors',
            errors: {
              task_name: 'タスクが見つからないわん',
            },
          });
          return;
        }

        // Check name uniqueness (only if name changed)
        if (values.name !== existingTask.name && taskStore.getTaskByName(values.name)) {
          await ack({
            response_action: 'errors',
            errors: {
              task_name: `タスク「${values.name}」は既に存在するわん`,
            },
          });
          return;
        }

        await ack();

        taskStore.updateTask(taskId, {
          name: values.name,
          cronExpression: values.cronExpression,
          taskPrompt: values.taskPrompt,
          notifyType: values.notifyType,
          notifyChannel: values.notifyChannel,
          mentionUsers: values.mentionUsers,
          mentionHere: values.mentionHere,
          mentionChannel: values.mentionChannel,
          model: values.model,
        });

        // Re-register cron job
        const updatedTask = taskStore.getTask(taskId);
        if (updatedTask) {
          scheduler.removeTask(updatedTask.id);
          scheduler.addTask(updatedTask);
        }

        // Send success DM
        try {
          const dm = await client.conversations.open({ users: body.user.id });
          if (dm.channel?.id) {
            await client.chat.postMessage({
              channel: dm.channel.id,
              text: `スケジュール「${values.name}」を更新したわん！ \`${values.cronExpression}\``,
            });
          }
        } catch (err) {
          logger.error({ err }, 'スケジュール更新通知失敗');
        }
      } else {
        // Create new task — check name uniqueness
        if (taskStore.getTaskByName(values.name)) {
          await ack({
            response_action: 'errors',
            errors: {
              task_name: `タスク「${values.name}」は既に存在するわん`,
            },
          });
          return;
        }

        await ack();

        const task = taskStore.createTask({
          name: values.name,
          cronExpression: values.cronExpression,
          taskPrompt: values.taskPrompt,
          notifyType: values.notifyType,
          notifyChannel: values.notifyChannel,
          mentionUsers: values.mentionUsers,
          mentionHere: values.mentionHere,
          mentionChannel: values.mentionChannel,
          model: values.model,
          createdBy: body.user.id,
        });

        scheduler.addTask(task);

        // Send success DM
        try {
          const dm = await client.conversations.open({ users: body.user.id });
          if (dm.channel?.id) {
            await client.chat.postMessage({
              channel: dm.channel.id,
              text: `スケジュール「${values.name}」を登録したわん！ \`${values.cronExpression}\``,
            });
          }
        } catch (err) {
          logger.error({ err }, 'スケジュール登録通知失敗');
        }
      }
    } catch (err) {
      logger.error({ err }, 'スケジュールモーダル処理エラー');
      // ack() may have already been called — ignore errors from double-ack
      try {
        await ack({
          response_action: 'errors',
          errors: {
            task_name: 'エラーが発生したわん。もう一度試してわん',
          },
        });
      } catch {
        // ack already called — ignore
      }
    }
  });

  // 8.6. 予約メッセージモーダルsubmitハンドラ
  app.view(SCHEDULED_MESSAGE_MODAL_CALLBACK_ID, async ({ ack, body, view, client }) => {
    try {
      const result = parseScheduledMessageModalValues(view.state.values);

      if ('error' in result) {
        await ack({
          response_action: 'errors',
          errors: { [result.field]: result.error },
        });
        return;
      }

      await ack();

      await client.chat.scheduleMessage({
        channel: result.channel,
        text: result.text,
        post_at: result.postAt,
      });

      // Send confirmation DM
      try {
        const dm = await client.conversations.open({ users: body.user.id });
        if (dm.channel?.id) {
          const scheduledDate = new Date(result.postAt * 1000).toLocaleString('ja-JP', {
            year: 'numeric', month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit',
            timeZone: 'Asia/Tokyo',
          });
          await client.chat.postMessage({
            channel: dm.channel.id,
            text: `メッセージを予約したわん！ :clock3:\n日時: ${scheduledDate}\nチャンネル: <#${result.channel}>`,
          });
        }
      } catch (err) {
        logger.error({ err }, '予約メッセージ確認DM送信失敗');
      }
    } catch (err) {
      logger.error({ err }, '予約メッセージモーダル処理エラー');
      try {
        await ack({
          response_action: 'errors',
          errors: { sm_text: 'エラーが発生したわん。もう一度試してわん' },
        });
      } catch {
        // ack already called — ignore
      }
    }
  });

  // 9. App起動
  await app.start();
  usageMonitor.start();
  logger.info('mugi-claw 起動完了わん！ 🐕');

  // 9.5. 起動通知をオーナーに送信
  try {
    const dm = await app.client.conversations.open({ users: config.owner.slackUserId });
    if (dm.channel?.id) {
      let commitInfo = '';
      try {
        const { execSync } = await import('node:child_process');
        const hash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
        const msg = execSync('git log -1 --format=%s', { encoding: 'utf-8' }).trim();
        commitInfo = `\nCommit: \`${hash}\` ${msg}`;
      } catch {
        // git情報取得失敗は無視
      }
      await app.client.chat.postMessage({
        channel: dm.channel.id,
        text: `:dog: むぎぼーが起動したわん！${commitInfo}`,
      });
    }
  } catch (err) {
    logger.warn({ err }, '起動通知の送信に失敗');
  }

  // 10. スケジューラ復元
  scheduler.initialize();

  // 11. graceful shutdown
  const shutdown = async () => {
    logger.info('mugi-claw を停止するわん...');
    usageMonitor.stop();
    scheduler.shutdown();
    if (proxyServer) await proxyServer.stop();
    await credentialServer.stop();
    await approvalServer.stop();
    await app.stop();
    closeDb();
    logger.info('mugi-claw 停止完了');
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  logger.fatal(err, 'mugi-claw 起動失敗');
  process.exit(1);
});
