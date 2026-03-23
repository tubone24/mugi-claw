import type { App } from '@slack/bolt';
import type { AppConfig } from '../../types.js';
import type { Logger } from 'pino';
import { mkdir, writeFile } from 'node:fs/promises';
import { sanitizeFileName } from '../../security/input-sanitizer.js';
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
import type { ListStore } from '../list-store.js';
import { buildSummaryCanvasDocument } from '../canvas-builder.js';

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
  listStore: ListStore,
): void {
  const claudeRunner = new ClaudeRunner(config, logger);

  app.event('app_mention', async ({ event, client }) => {
    const threadTs = event.thread_ts ?? event.ts;

    // ボットループ防止: 他のボットからのメンションを無視
    if (event.bot_id || (event as unknown as Record<string, unknown>).subtype === 'bot_message') {
      logger.debug({ botId: event.bot_id, threadTs }, 'ボットメッセージを無視');
      return;
    }

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

      // 3.5. リスト情報読み込み
      const userLists = listStore.getListsByUser(userId).map(list => ({
        list,
        items: listStore.getItems(list.id),
      }));

      // 4. プロンプト構築
      let prompt = buildPrompt(context, profile, memories, tasks, userLists);

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
                const tmpPath = `${tmpDir}/${sanitizeFileName(file.name ?? 'file')}`;
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
        logger.info({ tools: ev.tools, mcpServers: ev.mcp_servers }, 'Claude CLI 利用可能ツール');
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

      // desktop_screenshotはMCPサーバー内で直接Slackにアップロードされる

      runner.on('text', async (ev) => {
        await threadManager.updateProgress({
          type: 'text',
          content: ev.message,
        });
      });

      runner.on('retry', async (ev) => {
        await threadManager.updateProgress({
          type: 'text',
          content: `🔄 リトライ中... (${ev.attempt}/${ev.maxRetries})`,
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

        // Canvas操作
        for (const canvasAction of parsed.canvasActions) {
          try {
            if (canvasAction.action === 'create') {
              const doc = buildSummaryCanvasDocument(canvasAction.title, canvasAction.content);
              const canvasResult = await client.apiCall('canvases.create', {
                title: canvasAction.title,
                document_content: doc,
              });
              if (canvasResult.ok) {
                logger.info({ title: canvasAction.title, canvasId: (canvasResult as any).canvas_id }, 'Canvas作成');
              } else {
                logger.warn({ error: (canvasResult as any).error }, 'Canvas作成失敗');
              }
            }
          } catch (err) {
            logger.warn({ err, canvasAction }, 'Canvas操作失敗');
          }
        }

        // 予約メッセージ操作
        for (const sm of parsed.scheduledMessages) {
          try {
            // ISO 8601 → Unix timestamp
            let postAt: number;
            if (/^\d+$/.test(sm.postAt)) {
              postAt = parseInt(sm.postAt, 10);
            } else {
              postAt = Math.floor(new Date(sm.postAt).getTime() / 1000);
            }
            if (isNaN(postAt) || postAt <= Math.floor(Date.now() / 1000)) {
              logger.warn({ postAt: sm.postAt }, '予約メッセージの日時が無効または過去');
              continue;
            }
            await client.chat.scheduleMessage({
              channel: sm.channel,
              text: sm.text,
              post_at: postAt,
            });
            logger.info({ channel: sm.channel, postAt }, '予約メッセージ作成');
          } catch (err) {
            logger.warn({ err, sm }, '予約メッセージ操作失敗');
          }
        }

        // ブックマーク操作
        for (const bmAction of parsed.bookmarkActions) {
          try {
            switch (bmAction.action) {
              case 'add':
                if (bmAction.title && bmAction.url) {
                  await client.apiCall('bookmarks.add', {
                    channel_id: bmAction.channel,
                    title: bmAction.title,
                    type: 'link',
                    link: bmAction.url,
                  });
                  logger.info({ title: bmAction.title, channel: bmAction.channel }, 'ブックマーク追加');
                }
                break;
              case 'remove':
                if (bmAction.title) {
                  const listResult = await client.apiCall('bookmarks.list', { channel_id: bmAction.channel });
                  const bookmarks = ((listResult as any).bookmarks ?? []) as Array<{ id: string; title: string }>;
                  const target = bookmarks.find(bm => bm.title === bmAction.title);
                  if (target) {
                    await client.apiCall('bookmarks.remove', {
                      channel_id: bmAction.channel,
                      bookmark_id: target.id,
                    });
                    logger.info({ title: bmAction.title }, 'ブックマーク削除');
                  }
                }
                break;
            }
          } catch (err) {
            logger.warn({ err, bmAction }, 'ブックマーク操作失敗');
          }
        }

        // リスト操作
        for (const listAction of parsed.listActions) {
          try {
            switch (listAction.action) {
              case 'create_list': {
                if (!listStore.getListByName(listAction.listName, userId)) {
                  listStore.createList({ name: listAction.listName, createdBy: userId });
                  logger.info({ listName: listAction.listName }, 'リスト作成');
                }
                break;
              }
              case 'add_item': {
                const list = listStore.getListByName(listAction.listName, userId);
                if (list && listAction.title) {
                  listStore.createItem({
                    listId: list.id,
                    title: listAction.title,
                    description: listAction.description,
                    assignee: listAction.assignee,
                    dueDate: listAction.dueDate,
                    priority: listAction.priority,
                    createdBy: userId,
                  });
                  logger.info({ listName: listAction.listName, title: listAction.title }, 'リストアイテム追加');
                }
                break;
              }
              case 'complete_item': {
                const list = listStore.getListByName(listAction.listName, userId);
                if (list && listAction.title) {
                  const item = listStore.getItemByTitle(list.id, listAction.title);
                  if (item) {
                    listStore.updateItem(item.id, { status: 'done' });
                    logger.info({ listName: listAction.listName, title: listAction.title }, 'リストアイテム完了');
                  }
                }
                break;
              }
              case 'remove_item': {
                const list = listStore.getListByName(listAction.listName, userId);
                if (list && listAction.title) {
                  const item = listStore.getItemByTitle(list.id, listAction.title);
                  if (item) {
                    listStore.deleteItem(item.id);
                    logger.info({ listName: listAction.listName, title: listAction.title }, 'リストアイテム削除');
                  }
                }
                break;
              }
            }
          } catch (err) {
            logger.warn({ err, listAction }, 'リスト操作失敗');
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
                    mentionUsers: action.mentionUsers,
                    mentionHere: action.mentionHere,
                    mentionChannel: action.mentionChannel,
                    createdBy: userId,
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
