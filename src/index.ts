import { loadConfig } from './config.js';
import { createSlackApp } from './slack/app.js';
import { registerMentionHandler } from './slack/handlers/mention-handler.js';
import { registerCommandHandler } from './slack/handlers/command-handler.js';
import { ChromeLauncher } from './browser/chrome-launcher.js';
import { initDb, closeDb } from './db/database.js';
import { SettingsStore } from './db/settings-store.js';
import { ProfileStore } from './profile/profile-store.js';
import { ProfileOnboarding } from './profile/profile-onboarding.js';
import { TaskStore } from './scheduler/task-store.js';
import { TaskRunner } from './scheduler/task-runner.js';
import { Scheduler } from './scheduler/scheduler.js';
import { Notifier } from './slack/notifier.js';
import { ApprovalManager } from './approval/approval-manager.js';
import { ApprovalServer } from './approval/approval-server.js';
import { CredentialManager } from './credential/credential-manager.js';
import { CredentialServer } from './credential/credential-server.js';
import { registerApprovalHandlers } from './approval/register-handlers.js';
import { WhitelistStore } from './network/whitelist-store.js';
import { NetworkApprovalManager } from './network/network-approval.js';
import { ProxyServer } from './network/proxy-server.js';
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
  let proxyServer: ProxyServer | null = null;
  if (config.sandbox.enabled) {
    const whitelistStore = new WhitelistStore(config.network.defaultWhitelist);
    whitelistStore.seedDefaults();
    const networkApproval = new NetworkApprovalManager(app, config.owner.slackUserId, logger);
    proxyServer = new ProxyServer(whitelistStore, networkApproval, config.network.proxyPort, logger);
    await proxyServer.start();
    logger.info({ port: config.network.proxyPort }, 'Network proxy started');
  }

  // 5. Notifier, TaskRunner, Scheduler作成
  const notifier = new Notifier(app.client, config, logger);
  const taskRunner = new TaskRunner(config, taskStore, settingsStore, profileStore, logger);
  const scheduler = new Scheduler(taskStore, taskRunner, notifier, logger);

  // 6. ProfileOnboarding作成
  const profileOnboarding = new ProfileOnboarding(app.client, profileStore, logger);

  // 7. ハンドラー登録
  registerMentionHandler(app, config, logger, profileStore, profileOnboarding, settingsStore, taskStore, scheduler);
  registerCommandHandler(app, profileStore, taskStore, scheduler, settingsStore, logger);

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

  // 9. App起動
  await app.start();
  logger.info('mugi-claw 起動完了わん！ 🐕');

  // 10. スケジューラ復元
  scheduler.initialize();

  // 11. graceful shutdown
  const shutdown = async () => {
    logger.info('mugi-claw を停止するわん...');
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
