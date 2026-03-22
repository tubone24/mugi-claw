import type { App } from '@slack/bolt';
import type { AppConfig, ThreadMessage } from '../../types.js';
import type { Logger } from 'pino';
import type { ReactionTriggerStore } from '../../reaction/reaction-trigger-store.js';
import type { SettingsStore } from '../../db/settings-store.js';
import type { ReactionTrigger } from '../../types.js';
import { ThreadManager } from '../thread-manager.js';
import { ClaudeRunner } from '../../claude/claude-runner.js';

// 重複処理防止用 Map（key: "channel:ts:emoji", value: timestamp）
const processedReactions = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5分

function cleanupProcessedReactions(): void {
  const now = Date.now();
  for (const [key, timestamp] of processedReactions) {
    if (now - timestamp > DEDUP_TTL_MS) {
      processedReactions.delete(key);
    }
  }
}

function buildReactionPrompt(
  trigger: ReactionTrigger,
  messages: ThreadMessage[],
  reactedTs: string,
): string {
  const lines: string[] = [];

  lines.push('【リアクショントリガー実行モード】');
  lines.push(`あなたはSlackのリアクション (:${trigger.emojiName}:) によってトリガーされました。`);
  lines.push('以下の会話コンテキストに対して、指定されたタスクを実行してください。');
  lines.push('結果は簡潔にまとめてください。');
  lines.push('');
  lines.push('--- 会話コンテキスト ---');

  for (const msg of messages) {
    const marker = msg.ts === reactedTs ? ' ← [リアクション対象]' : '';
    lines.push(`[user:${msg.user}] ${msg.text}${marker}`);
  }

  lines.push('--- 会話コンテキストここまで ---');
  lines.push('');
  lines.push('【タスク指示】');
  lines.push(trigger.promptTemplate);

  return lines.join('\n');
}

export function registerReactionHandler(
  app: App,
  config: AppConfig,
  logger: Logger,
  reactionTriggerStore: ReactionTriggerStore,
  settingsStore: SettingsStore,
): void {
  const claudeRunner = new ClaudeRunner(config, logger);

  app.event('reaction_added', async ({ event, client, context }) => {
    try {
      // 1. ボット自身のリアクション無視
      if (context.botUserId && event.user === context.botUserId) {
        return;
      }

      // 2. トリガー検索
      const trigger = reactionTriggerStore.getByEmoji(event.reaction);
      if (!trigger || !trigger.enabled) {
        return;
      }

      // 3. message アイテムのみ対応
      if (event.item.type !== 'message') {
        return;
      }

      const channel = event.item.channel;
      const messageTs = event.item.ts;

      // 4. 重複処理防止
      cleanupProcessedReactions();
      const dedupKey = `${channel}:${messageTs}:${event.reaction}`;
      if (processedReactions.has(dedupKey)) {
        logger.debug({ dedupKey }, 'リアクション重複処理スキップ');
        return;
      }
      processedReactions.set(dedupKey, Date.now());

      logger.info({ emoji: event.reaction, channel, messageTs, user: event.user }, 'リアクショントリガー発火');

      // 5. 対象メッセージ取得
      let targetMessage: { text?: string; user?: string; ts?: string; thread_ts?: string } | undefined;
      try {
        const historyResult = await client.conversations.history({
          channel,
          latest: messageTs,
          limit: 1,
          inclusive: true,
        });
        targetMessage = historyResult.messages?.[0];
      } catch (err) {
        logger.warn({ err, channel, messageTs }, '対象メッセージ取得失敗（権限不足の可能性）');
        return;
      }

      if (!targetMessage || !targetMessage.ts) {
        logger.debug({ channel, messageTs }, '対象メッセージが見つからない');
        return;
      }

      // 6. スレッド判定とコンテキスト収集
      const messages: ThreadMessage[] = [];
      const threadTs = targetMessage.thread_ts ?? targetMessage.ts;

      if (targetMessage.thread_ts) {
        // スレッド内メッセージ → スレッド全体を取得
        try {
          const repliesResult = await client.conversations.replies({
            channel,
            ts: targetMessage.thread_ts,
            limit: 50,
          });
          if (repliesResult.messages) {
            for (const msg of repliesResult.messages) {
              messages.push({
                user: msg.user ?? 'unknown',
                text: msg.text ?? '',
                ts: msg.ts ?? '',
                botId: msg.bot_id ?? undefined,
              });
            }
          }
        } catch (err) {
          logger.warn({ err }, 'スレッド取得失敗');
          // フォールバック: 対象メッセージのみ
          messages.push({
            user: targetMessage.user ?? 'unknown',
            text: targetMessage.text ?? '',
            ts: targetMessage.ts,
          });
        }
      } else {
        // トップレベルメッセージ → そのメッセージのみ
        messages.push({
          user: targetMessage.user ?? 'unknown',
          text: targetMessage.text ?? '',
          ts: targetMessage.ts,
        });
      }

      // 7. プロンプト構築
      const prompt = buildReactionPrompt(trigger, messages, messageTs);

      // 8. ThreadManager 作成 & postThinking()
      const threadManager = new ThreadManager(client, channel, threadTs, logger);
      await threadManager.postThinking();

      // 9. モデル取得
      const model = trigger.model ?? settingsStore.getModel();

      // 10. Claude CLI 実行
      const runner = claudeRunner.run(prompt, undefined, model, { channel, threadTs });

      // 11. ストリームイベント処理
      runner.on('tool_use', async (ev) => {
        await threadManager.updateProgress({
          type: 'tool_use',
          content: `${ev.tool} を実行中...`,
          toolName: ev.tool,
        });
      });

      runner.on('text', async (ev) => {
        await threadManager.updateProgress({
          type: 'text',
          content: ev.message,
        });
      });

      runner.on('result', async (ev) => {
        // 構造化出力パースはスキップ（リアクショントリガーは決められたタスク実行なので不要）
        await threadManager.postResult(ev.result);

        logger.info({
          emoji: event.reaction,
          channel,
          threadTs,
          sessionId: ev.session_id,
          cost: ev.cost_usd,
          duration: ev.duration_ms,
        }, 'リアクショントリガー処理完了');
      });

      runner.on('error', async (err) => {
        await threadManager.postError(err.message);
        logger.error({ err, emoji: event.reaction, channel, threadTs }, 'リアクショントリガー処理エラー');
      });

    } catch (err) {
      logger.error({ err, reaction: event.reaction }, 'リアクションハンドラーエラー');
    }
  });
}
