import type { Logger } from 'pino';
import type { AppConfig, ScheduledTask } from '../types.js';
import type { TaskStore } from './task-store.js';
import type { SettingsStore } from '../db/settings-store.js';
import type { ProfileStore } from '../profile/profile-store.js';
import { ClaudeRunner } from '../claude/claude-runner.js';
import { buildPrompt } from '../claude/prompt-builder.js';

export class TaskRunner {
  private claudeRunner: ClaudeRunner;

  constructor(
    private config: AppConfig,
    private taskStore: TaskStore,
    private settingsStore: SettingsStore,
    private profileStore: ProfileStore,
    private logger: Logger,
  ) {
    this.claudeRunner = new ClaudeRunner(config, logger);
  }

  async run(task: ScheduledTask): Promise<{ success: boolean; result?: string; error?: string; costUsd?: number; durationMs?: number }> {
    const runId = this.taskStore.createRun(task.id);
    this.logger.info({ taskId: task.id, taskName: task.name, runId }, 'スケジュールタスク開始');

    try {
      // Build task prompt with owner profile context
      const ownerProfile = this.profileStore.getProfile(this.config.owner.slackUserId);
      const ownerMemories = this.profileStore.getMemories(this.config.owner.slackUserId, 20);

      const schedulerInstruction = [
        '【スケジュールタスク実行モード】',
        'このタスクはスケジュール実行されています。',
        'タスクの結果はシステムが自動的にSlack DMまたは指定チャンネルに通知します。',
        '以下のことは絶対にしないでください：',
        '- Slack APIを直接呼び出してメッセージを送信する',
        '- .envファイルやトークンを読み取る',
        '- DMやチャンネルへの投稿スクリプトを自作する',
        '- curl等でSlack APIにリクエストを送る',
        'タスクの結果をテキストとして出力するだけでOKです。システムが自動で通知します。',
      ].join('\n');

      const taskPrompt = buildPrompt(
        {
          channel: '',
          threadTs: '',
          userMessage: `${schedulerInstruction}\n\n${task.taskPrompt}`,
          userId: this.config.owner.slackUserId,
          threadMessages: [],
          searchResults: [],
        },
        ownerProfile,
        ownerMemories,
        [],
      );

      // Determine model
      const model = task.model ?? this.settingsStore.getModel();

      return await new Promise((resolve) => {
        const runner = this.claudeRunner.run(taskPrompt, undefined, model, undefined, { allowAllTools: true });

        // Claude CLI stream-json の result フィールドが空になるバグ対策
        let accumulatedText = '';
        runner.on('text', (ev) => {
          accumulatedText += ev.message;
        });

        runner.on('result', (ev) => {
          const resultText = ev.result || accumulatedText;
          this.taskStore.finishRun(runId, 'success', resultText, undefined, ev.cost_usd, ev.duration_ms);
          this.logger.info({ taskId: task.id, runId, cost: ev.cost_usd }, 'スケジュールタスク完了');
          resolve({ success: true, result: resultText, costUsd: ev.cost_usd, durationMs: ev.duration_ms });
        });

        runner.on('error', (err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          this.taskStore.finishRun(runId, 'error', undefined, errorMsg);
          this.logger.error({ taskId: task.id, runId, err }, 'スケジュールタスクエラー');
          resolve({ success: false, error: errorMsg });
        });
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.taskStore.finishRun(runId, 'error', undefined, errorMsg);
      this.logger.error({ taskId: task.id, runId, err }, 'スケジュールタスク例外');
      return { success: false, error: errorMsg };
    }
  }
}
