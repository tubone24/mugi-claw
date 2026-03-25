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
import type { ReactionTriggerStore } from '../../reaction/reaction-trigger-store.js';
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
  reactionTriggerStore: ReactionTriggerStore,
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
      // Claude CLI stream-json の result フィールドが空になるバグ対策
      // (GitHub Issue #7124, #8126) - text イベントからテキストを蓄積してフォールバック
      let accumulatedText = '';

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
        accumulatedText += ev.message;
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
        // 構造化出力をパース（result が空の場合は蓄積テキストをフォールバック）
        const resultText = ev.result || accumulatedText;
        const parsed = parseClaudeResult(resultText);

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
              const targetChannel = canvasAction.channel || event.channel;
              let canvasId: string | undefined;

              // チャンネルCanvasとして作成を試みる（チャンネルメンバーに自動的に見える）
              try {
                const channelResult = await client.apiCall('conversations.canvases.create', {
                  channel_id: targetChannel,
                  document_content: doc,
                });
                if (channelResult.ok && (channelResult as any).canvas_id) {
                  canvasId = (channelResult as any).canvas_id;
                }
              } catch {
                // フォールバック
              }

              // チャンネルCanvas作成失敗時はスタンドアロンCanvasを作成
              if (!canvasId) {
                const standaloneResult = await client.apiCall('canvases.create', {
                  title: canvasAction.title,
                  document_content: doc,
                });
                if (standaloneResult.ok && (standaloneResult as any).canvas_id) {
                  canvasId = (standaloneResult as any).canvas_id;
                  // アクセス権をチャンネルメンバーに付与
                  try {
                    await client.apiCall('canvases.access.set', {
                      canvas_id: canvasId,
                      channel_ids: [targetChannel],
                      access_level: 'write',
                    });
                  } catch {
                    // アクセス権設定失敗は無視
                  }
                }
              }

              if (canvasId) {
                logger.info({ title: canvasAction.title, canvasId }, 'Canvas作成');
              } else {
                logger.warn({ title: canvasAction.title }, 'Canvas作成失敗');
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
              case 'list': {
                const listResult = await client.apiCall('bookmarks.list', { channel_id: bmAction.channel });
                const bookmarks = ((listResult as any).bookmarks ?? []) as Array<{ id: string; title: string; link: string }>;
                if (bookmarks.length > 0) {
                  const bmList = bookmarks.map(bm => `- ${bm.title}: ${bm.link}`).join('\n');
                  parsed.cleanText += `\n\n📌 ブックマーク一覧:\n${bmList}`;
                } else {
                  parsed.cleanText += '\n\nブックマークはまだ登録されていないわん。';
                }
                logger.info({ channel: bmAction.channel }, 'ブックマーク一覧取得');
                break;
              }
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
              case 'undone_item': {
                const list = listStore.getListByName(listAction.listName, userId);
                if (list && listAction.title) {
                  const item = listStore.getItemByTitle(list.id, listAction.title);
                  if (item) {
                    listStore.updateItem(item.id, { status: 'open' });
                    logger.info({ listName: listAction.listName, title: listAction.title }, 'リストアイテム未完了に戻す');
                  }
                }
                break;
              }
              case 'delete_list': {
                const list = listStore.getListByName(listAction.listName, userId);
                if (list) {
                  listStore.deleteList(list.id);
                  logger.info({ listName: listAction.listName }, 'リスト削除');
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

        // モデル操作
        for (const modelAction of parsed.modelActions) {
          try {
            switch (modelAction.action) {
              case 'show': {
                const currentModel = settingsStore.getModel();
                parsed.cleanText += `\n\n現在のモデル: ${currentModel}`;
                logger.info({ model: currentModel }, 'モデル表示');
                break;
              }
              case 'set': {
                if (modelAction.model) {
                  settingsStore.setModel(modelAction.model);
                  parsed.cleanText += `\n\nモデルを ${modelAction.model} に変更したわん！`;
                  logger.info({ model: modelAction.model }, 'モデル変更');
                }
                break;
              }
            }
          } catch (err) {
            logger.warn({ err, modelAction }, 'モデル操作失敗');
          }
        }

        // リアクショントリガー操作
        for (const reactionAction of parsed.reactionActions) {
          try {
            switch (reactionAction.action) {
              case 'list': {
                const triggers = reactionTriggerStore.getAll();
                if (triggers.length > 0) {
                  const triggerList = triggers.map(t => {
                    const status = t.enabled ? '✅' : '⏸️';
                    return `- ${status} :${t.emojiName}: → ${t.description ?? t.promptTemplate}`;
                  }).join('\n');
                  parsed.cleanText += `\n\nリアクショントリガー一覧:\n${triggerList}`;
                } else {
                  parsed.cleanText += '\n\nリアクショントリガーはまだ登録されていないわん。';
                }
                logger.info('リアクショントリガー一覧取得');
                break;
              }
              case 'add': {
                if (reactionAction.emoji && reactionAction.promptTemplate) {
                  reactionTriggerStore.create({
                    emojiName: reactionAction.emoji,
                    promptTemplate: reactionAction.promptTemplate,
                    description: reactionAction.description,
                    model: reactionAction.model,
                    createdBy: userId,
                  });
                  logger.info({ emoji: reactionAction.emoji }, 'リアクショントリガー追加');
                }
                break;
              }
              case 'remove': {
                if (reactionAction.emoji) {
                  reactionTriggerStore.deleteByEmoji(reactionAction.emoji);
                  logger.info({ emoji: reactionAction.emoji }, 'リアクショントリガー削除');
                }
                break;
              }
              case 'edit': {
                if (reactionAction.emoji) {
                  const trigger = reactionTriggerStore.getByEmoji(reactionAction.emoji);
                  if (trigger) {
                    const updateData: Partial<{ promptTemplate: string; description: string; model: string }> = {};
                    if (reactionAction.promptTemplate) updateData.promptTemplate = reactionAction.promptTemplate;
                    if (reactionAction.description) updateData.description = reactionAction.description;
                    if (reactionAction.model) updateData.model = reactionAction.model;
                    reactionTriggerStore.update(trigger.id, updateData);
                    logger.info({ emoji: reactionAction.emoji }, 'リアクショントリガー編集');
                  }
                }
                break;
              }
              case 'toggle': {
                if (reactionAction.emoji) {
                  const trigger = reactionTriggerStore.getByEmoji(reactionAction.emoji);
                  if (trigger) {
                    reactionTriggerStore.toggle(trigger.id);
                    logger.info({ emoji: reactionAction.emoji }, 'リアクショントリガートグル');
                  }
                }
                break;
              }
            }
          } catch (err) {
            logger.warn({ err, reactionAction }, 'リアクショントリガー操作失敗');
          }
        }

        // 予約メッセージ管理操作
        for (const smAction of parsed.scheduledMessageActions) {
          try {
            switch (smAction.action) {
              case 'list': {
                const result = await client.chat.scheduledMessages.list({
                  channel: smAction.channel,
                });
                const msgs = result.scheduled_messages ?? [];
                if (msgs.length > 0) {
                  const msgList = msgs.map(m => {
                    const date = new Date((m.post_at ?? 0) * 1000).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' });
                    return `- ${date}: ${m.text} (ID: ${m.id})`;
                  }).join('\n');
                  parsed.cleanText += `\n\n予約メッセージ一覧:\n${msgList}`;
                } else {
                  parsed.cleanText += '\n\n予約メッセージはないわん。';
                }
                logger.info('予約メッセージ一覧取得');
                break;
              }
              case 'cancel': {
                if (smAction.channel && smAction.messageId) {
                  await client.chat.deleteScheduledMessage({
                    channel: smAction.channel,
                    scheduled_message_id: smAction.messageId,
                  });
                  logger.info({ messageId: smAction.messageId }, '予約メッセージキャンセル');
                }
                break;
              }
            }
          } catch (err) {
            logger.warn({ err, smAction }, '予約メッセージ管理操作失敗');
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
