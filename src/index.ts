import { loadConfig } from './config.js';
import { createSlackApp } from './slack/app.js';
import { registerMentionHandler } from './slack/handlers/mention-handler.js';
import { ChromeLauncher } from './browser/chrome-launcher.js';
import pino from 'pino';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main() {
  logger.info('mugi-claw を起動するわん...');

  // Chrome CDP 起動（既に起動済みならスキップ）
  const chrome = new ChromeLauncher(config.browser.debuggingPort, config.browser.userDataDir, logger);
  try {
    await chrome.launch();
  } catch (err) {
    logger.warn({ err }, 'Chrome 起動失敗 - ブラウザ操作は無効わん');
  }

  const app = createSlackApp(config);
  registerMentionHandler(app, config, logger);

  await app.start();
  logger.info('mugi-claw 起動完了わん！ 🐕');

  // graceful shutdown
  const shutdown = async () => {
    logger.info('mugi-claw を停止するわん...');
    await app.stop();
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
