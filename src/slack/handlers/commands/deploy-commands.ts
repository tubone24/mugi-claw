import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type { WebClient } from '@slack/web-api';
import type { Logger } from 'pino';

const execAsync = promisify(exec);
const EXEC_TIMEOUT = 5 * 60 * 1000; // 5分

export function handleDeployCommand(
  userId: string,
  ownerUserId: string,
  client: WebClient,
  logger: Logger,
): string {
  if (userId !== ownerUserId) {
    return ':no_entry: このコマンドはオーナーのみ実行可能わん';
  }

  void runDeploy(ownerUserId, client, logger);

  return ':rocket: デプロイを開始するわん！進捗はDMで通知するわん';
}

async function sendOwnerDm(client: WebClient, userId: string, text: string): Promise<void> {
  const dm = await client.conversations.open({ users: userId });
  if (dm.channel?.id) {
    await client.chat.postMessage({ channel: dm.channel.id, text });
  }
}

async function runDeploy(ownerUserId: string, client: WebClient, logger: Logger): Promise<void> {
  const cwd = process.cwd();

  try {
    // Step 1: git pull
    await sendOwnerDm(client, ownerUserId, ':arrow_down: `git pull` を実行中わん...');
    try {
      const { stdout } = await execAsync('git pull', { cwd, timeout: EXEC_TIMEOUT });
      await sendOwnerDm(client, ownerUserId, `:white_check_mark: git pull 完了わん\n\`\`\`${stdout.trim()}\`\`\``);
    } catch (err) {
      const error = err as { stderr?: string; message?: string };
      const detail = (error.stderr || error.message || '').slice(0, 1500);
      await sendOwnerDm(client, ownerUserId, `:x: git pull に失敗したわん\n\`\`\`${detail}\`\`\``);
      return;
    }

    // Step 2: npm run build
    await sendOwnerDm(client, ownerUserId, ':hammer: `npm run build` を実行中わん...');
    try {
      await execAsync('npm run build', { cwd, timeout: EXEC_TIMEOUT });
      await sendOwnerDm(client, ownerUserId, ':white_check_mark: ビルド完了わん');
    } catch (err) {
      const error = err as { stderr?: string; message?: string };
      const detail = (error.stderr || error.message || '').slice(0, 1500);
      await sendOwnerDm(client, ownerUserId, `:x: ビルドに失敗したわん\n\`\`\`${detail}\`\`\``);
      return;
    }

    // Step 3: 再起動
    await sendOwnerDm(client, ownerUserId, ':arrows_counterclockwise: むぎぼーを再起動するわん！すぐ戻ってくるわん！');

    // メッセージ送信完了を待ってから再起動
    await new Promise((resolve) => setTimeout(resolve, 1000));

    exec(`launchctl kickstart -k gui/$(id -u)/com.mugi-claw`);
  } catch (err) {
    logger.error({ err }, 'デプロイ処理エラー');
    try {
      await sendOwnerDm(client, ownerUserId, ':x: デプロイ中に予期しないエラーが発生したわん');
    } catch {
      // DM送信自体が失敗 — できることなし
    }
  }
}
