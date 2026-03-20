import type { App } from '@slack/bolt';
import type { AppConfig } from '../../types.js';
import type { Logger } from 'pino';
import { collectContext } from '../context-collector.js';
import { ThreadManager } from '../thread-manager.js';
import { buildPrompt } from '../../claude/prompt-builder.js';
import { ClaudeRunner } from '../../claude/claude-runner.js';
import { SessionManager } from '../../claude/session-manager.js';

const sessionManager = new SessionManager();

export function registerMentionHandler(app: App, config: AppConfig, logger: Logger): void {
  const claudeRunner = new ClaudeRunner(config, logger);

  app.event('app_mention', async ({ event, client }) => {
    const threadTs = event.thread_ts ?? event.ts;
    const userMessage = event.text.replace(/<@[A-Z0-9]+>/g, '').trim();

    if (!userMessage) return;

    const threadManager = new ThreadManager(client, event.channel, threadTs, logger);

    try {
      // 1. 「考え中」メッセージ投稿
      await threadManager.postThinking();

      // 2. コンテキスト収集
      const context = await collectContext(client, event.channel, threadTs, userMessage, event.user ?? 'unknown', config.slack.userToken);

      // 3. プロンプト構築
      const prompt = buildPrompt(context);

      // 4. セッション取得（あれば resume）
      const existingSession = sessionManager.getSession(threadTs);

      // 5. Claude CLI 実行
      const runner = claudeRunner.run(prompt, existingSession?.sessionId);

      // 6. ストリームイベント橋渡し
      runner.on('system_init', (ev) => {
        sessionManager.saveSession(threadTs, event.channel, ev.session_id);
      });

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
        await threadManager.postResult(ev.result);
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
