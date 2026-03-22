import type { App } from '@slack/bolt';
import type { Logger } from 'pino';
import type { ProfileStore } from '../../profile/profile-store.js';
import type { TaskStore } from '../../scheduler/task-store.js';
import type { Scheduler } from '../../scheduler/scheduler.js';
import type { SettingsStore } from '../../db/settings-store.js';
import { handleProfileCommand } from './commands/profile-commands.js';
import { handleScheduleCommand } from './commands/schedule-commands.js';
import { handleMemoryCommand } from './commands/memory-commands.js';
import { handleModelCommand } from './commands/model-commands.js';
import { handleReactionCommand } from './commands/reaction-commands.js';
import type { ReactionTriggerStore } from '../../reaction/reaction-trigger-store.js';

export function registerCommandHandler(
  app: App,
  profileStore: ProfileStore,
  taskStore: TaskStore,
  scheduler: Scheduler,
  reactionTriggerStore: ReactionTriggerStore,
  settingsStore: SettingsStore,
  logger: Logger,
): void {
  app.command('/mugiclaw', async ({ command, ack, respond, client }) => {
    await ack();

    const args = command.text.trim().split(/\s+/);
    const subcommand = args[0]?.toLowerCase() ?? 'help';
    const subArgs = args.slice(1);

    try {
      switch (subcommand) {
        case 'profile':
          await respond(handleProfileCommand(subArgs, command.user_id, profileStore));
          break;
        case 'schedule': {
          const result = await handleScheduleCommand(subArgs, taskStore, scheduler, settingsStore, {
            triggerId: command.trigger_id,
            client,
            userId: command.user_id,
          });
          if (result) {
            await respond(result);
          }
          break;
        }
        case 'run': {
          const taskName = subArgs.join(' ');
          if (!taskName) {
            await respond('使い方: `/mugiclaw run <タスク名>` わん');
            break;
          }
          const task = taskStore.getTaskByName(taskName);
          if (!task) {
            await respond(`タスク「${taskName}」が見つからないわん`);
            break;
          }
          await respond(`タスク「${taskName}」を実行するわん！`);
          void scheduler.runNow(task.id);
          break;
        }
        case 'memories':
        case 'memory':
          await respond(handleMemoryCommand(subArgs, command.user_id, profileStore));
          break;
        case 'model':
          await respond(handleModelCommand(subArgs, settingsStore));
          break;
        case 'reaction':
          await respond(handleReactionCommand(subArgs, command.user_id, reactionTriggerStore));
          break;
        case 'help':
        default:
          await respond(getHelpText());
          break;
      }
    } catch (err) {
      logger.error({ err, command: command.text }, 'コマンド実行エラー');
      await respond('エラーが発生したわん... もう一度試してほしいわん');
    }
  });
}

function getHelpText(): string {
  return `*:dog: むぎぼーコマンド一覧わん！*

*プロフィール*
\`/mugiclaw profile\` - プロフィール表示
\`/mugiclaw profile set <field> <value>\` - プロフィール更新

*スケジュール*
\`/mugiclaw schedule list\` - スケジュール一覧
\`/mugiclaw schedule add\` - スケジュール追加（モーダル）
\`/mugiclaw schedule add <名前> <cron式> <プロンプト>\` - テキストで追加
\`/mugiclaw schedule edit <名前>\` - スケジュール編集
\`/mugiclaw schedule remove <名前>\` - スケジュール削除
\`/mugiclaw schedule pause <名前>\` - 一時停止/再開

*タスク実行*
\`/mugiclaw run <名前>\` - タスク即時実行

*メモリ*
\`/mugiclaw memories\` - 記憶一覧
\`/mugiclaw memory add <テキスト>\` - 記憶追加
\`/mugiclaw memory forget <ID>\` - 記憶削除

*モデル*
\`/mugiclaw model\` - 現在のモデル表示
\`/mugiclaw model <opus|sonnet|haiku>\` - モデル切替

*リアクショントリガー*
\`/mugiclaw reaction list\` - トリガー一覧
\`/mugiclaw reaction add :emoji: <プロンプト>\` - トリガー追加
\`/mugiclaw reaction remove :emoji:\` - トリガー削除
\`/mugiclaw reaction edit :emoji: <新プロンプト>\` - プロンプト編集
\`/mugiclaw reaction toggle :emoji:\` - 有効/無効切替`;
}
