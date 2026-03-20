import type { App } from '@slack/bolt';
import type { AppConfig } from '../../types.js';
import type { Logger } from 'pino';
import { mkdir, writeFile } from 'node:fs/promises';
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
      let prompt = buildPrompt(context);

      // 3.5. 添付ファイル受信
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

      // 4. セッション取得（あれば resume）
      const existingSession = sessionManager.getSession(threadTs);

      // 5. Claude CLI 実行
      const runner = claudeRunner.run(prompt, existingSession?.sessionId);

      // 6. ストリームイベント橋渡し
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
        await threadManager.postResult(ev.result);

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
