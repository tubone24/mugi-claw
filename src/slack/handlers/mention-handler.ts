import type { App } from '@slack/bolt';
import type { AppConfig } from '../../types.js';
import type { Logger } from 'pino';
import { mkdir, writeFile } from 'node:fs/promises';
import { collectContext } from '../context-collector.js';
import { ThreadManager } from '../thread-manager.js';
import { buildPrompt } from '../../claude/prompt-builder.js';
import { ClaudeRunner } from '../../claude/claude-runner.js';
import { SessionManager } from '../../claude/session-manager.js';
import { parseClaudeResult } from '../../claude/result-parser.js';
import type { ProfileStore } from '../../profile/profile-store.js';
import type { ProfileOnboarding } from '../../profile/profile-onboarding.js';
import type { SettingsStore } from '../../db/settings-store.js';
import type { TaskStore } from '../../scheduler/task-store.js';
import type { Scheduler } from '../../scheduler/scheduler.js';

const sessionManager = new SessionManager();

export function registerMentionHandler(
  app: App,
  config: AppConfig,
  logger: Logger,
  profileStore: ProfileStore,
  profileOnboarding: ProfileOnboarding,
  settingsStore: SettingsStore,
  taskStore: TaskStore,
  scheduler: Scheduler,
): void {
  const claudeRunner = new ClaudeRunner(config, logger);

  app.event('app_mention', async ({ event, client }) => {
    const threadTs = event.thread_ts ?? event.ts;
    const userMessage = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();
    const userId = event.user ?? 'unknown';

    if (!userMessage) return;

    const threadManager = new ThreadManager(client, event.channel, threadTs, logger);

    try {
      // 0. プロフィールチェック（初回ユーザーにはオンボーディングDMを送信）
      await profileOnboarding.checkAndOnboard(userId);

      // 1. 「考え中」メッセージ投稿
      await threadManager.postThinking();

      // 2. コンテキスト収集
      const context = await collectContext(client, event.channel, threadTs, userMessage, userId, config.slack.userToken);

      // 3. プロフィール・メモリ・スケジュール読み込み
      const profile = profileStore.getProfile(userId);
      const memories = profileStore.getMemories(userId, 30);
      const tasks = taskStore.getAllTasks();

      // 4. プロンプト構築
      let prompt = buildPrompt(context, profile, memories, tasks);

      // 4.5. 添付ファイル受信
      const files = (event as unknown as Record<string, unknown>)['files'] as Array<{
        url_private_download?: string;
        name?: string;
        filetype?: string;
        mimetype?: string;
      }> | undefined;

      if (files && files.length > 0) {
        const fileInfos: string[] = [];
        for (const file of files) {
          if (file.url_private_download) {
            try {
              const res = await fetch(file.url_private_download, {
                headers: { Authorization: `Bearer ${config.slack.botToken}` },
              });
              if (res.ok) {
                const tmpDir = '/tmp/mugi-claw';
                await mkdir(tmpDir, { recursive: true });
                const tmpPath = `${tmpDir}/${file.name ?? 'file'}`;
                const buffer = Buffer.from(await res.arrayBuffer());
                await writeFile(tmpPath, buffer);
                fileInfos.push(`添付ファイル: ${file.name} (${file.filetype}) → ${tmpPath}`);
              }
            } catch (err) {
              logger.warn({ err, fileName: file.name }, '添付ファイルダウンロード失敗');
            }
          }
        }
        if (fileInfos.length > 0) {
          prompt += '\n\n--- 添付ファイル ---\n' + fileInfos.join('\n');
        }
      }

      // 5. セッション取得（あれば resume）
      const existingSession = sessionManager.getSession(threadTs);

      // 6. モデル取得
      const model = settingsStore.getModel();

      // 7. Claude CLI 実行
      const runner = claudeRunner.run(prompt, existingSession?.sessionId, model, { channel: event.channel, threadTs: threadTs });

      // 8. ストリームイベント橋渡し
      const writtenFiles: string[] = [];

      runner.on('system_init', (ev) => {
        sessionManager.saveSession(threadTs, event.channel, ev.session_id);
      });

      runner.on('tool_use', async (ev) => {
        await threadManager.updateProgress({
          type: 'tool_use',
          content: `${ev.tool} を実行中...`,
          toolName: ev.tool,
        });

        // Write ツールのファイルパスを記録
        if (ev.tool === 'Write' && ev.input['file_path']) {
          writtenFiles.push(ev.input['file_path'] as string);
        }
      });

      runner.on('tool_result', async (ev) => {
        // スクリーンショットのtool_resultを検出してSlackにアップロード
        if (ev.tool.toLowerCase().includes('screenshot') && ev.success && ev.output) {
          try {
            await threadManager.uploadScreenshot(ev.output, `screenshot_${Date.now()}.png`);
          } catch (err) {
            logger.warn({ err }, 'スクリーンショットアップロード失敗');
          }
        }
      });

      runner.on('text', async (ev) => {
        await threadManager.updateProgress({
          type: 'text',
          content: ev.message,
        });
      });

      runner.on('result', async (ev) => {
        // 構造化出力をパース
        const parsed = parseClaudeResult(ev.result);

        // メモリ保存
        for (const mem of parsed.newMemories) {
          try {
            const category = (['preference', 'fact', 'habit', 'context'].includes(mem.category)
              ? mem.category
              : 'fact') as 'preference' | 'fact' | 'habit' | 'context';
            profileStore.addMemory(userId, category, mem.content, 'conversation');
            logger.info({ userId, category, content: mem.content }, 'メモリ保存');
          } catch (err) {
            logger.warn({ err }, 'メモリ保存失敗');
          }
        }

        // プロフィール更新
        if (Object.keys(parsed.profileUpdates).length > 0) {
          try {
            const updates: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(parsed.profileUpdates)) {
              if (['hobbies', 'favoriteFoods', 'interests'].includes(key)) {
                updates[key] = value.split(/[,、]/).map(s => s.trim()).filter(Boolean);
              } else {
                updates[key] = value;
              }
            }
            profileStore.upsertProfile(userId, updates);
            logger.info({ userId, updates: Object.keys(updates) }, 'プロフィール更新');
          } catch (err) {
            logger.warn({ err }, 'プロフィール更新失敗');
          }
        }

        // スケジュール操作
        for (const action of parsed.scheduleActions) {
          try {
            switch (action.action) {
              case 'add': {
                if (action.name && action.cron && action.prompt) {
                  const task = taskStore.createTask({
                    name: action.name,
                    cronExpression: action.cron,
                    taskPrompt: action.prompt,
                    description: action.description,
                    notifyType: action.notifyType,
                    notifyChannel: action.notifyChannel,
                    model: action.model,
                  });
                  scheduler.addTask(task);
                  logger.info({ taskName: action.name }, 'スケジュール追加');
                }
                break;
              }
              case 'remove': {
                const task = taskStore.getTaskByName(action.name);
                if (task) {
                  scheduler.removeTask(task.id);
                  taskStore.deleteTask(task.id);
                  logger.info({ taskName: action.name }, 'スケジュール削除');
                }
                break;
              }
              case 'pause':
              case 'resume': {
                const task = taskStore.getTaskByName(action.name);
                if (task) {
                  taskStore.toggleTask(task.id);
                  scheduler.toggleTask(task.id);
                  logger.info({ taskName: action.name, action: action.action }, 'スケジュールトグル');
                }
                break;
              }
            }
          } catch (err) {
            logger.warn({ err, action }, 'スケジュール操作失敗');
          }
        }

        // クリーンテキストを投稿
        await threadManager.postResult(parsed.cleanText);

        // 書き込まれたファイルをアップロード
        for (const filePath of writtenFiles) {
          try {
            await threadManager.uploadFile(filePath);
          } catch (err) {
            logger.warn({ err, filePath }, 'ファイルアップロード失敗');
          }
        }

        logger.info({
          threadTs,
          sessionId: ev.session_id,
          cost: ev.cost_usd,
          duration: ev.duration_ms,
          turns: ev.num_turns,
        }, 'Claude処理完了');
      });

      runner.on('error', async (err) => {
        await threadManager.postError(err.message);
        logger.error({ err, threadTs }, 'Claude処理エラー');
      });

    } catch (err) {
      await threadManager.postError('予期しないエラーが発生したわん...');
      logger.error({ err, threadTs }, 'メンションハンドラーエラー');
    }
  });
}
