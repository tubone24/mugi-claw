import { loadConfig } from './config.js';
import { createSlackApp } from './slack/app.js';
import { registerMentionHandler } from './slack/handlers/mention-handler.js';
import pino from 'pino';

const config = loadConfig();
const logger = pino({ level: config.logLevel });

async function main() {
  logger.info('mugi-claw を起動するわん...');

  const app = createSlackApp(config);
  registerMentionHandler(app, config, logger);

  await app.start();
  logger.info('mugi-claw 起動完了わん！ 🐕');
}

main().catch((err) => {
  logger.fatal(err, 'mugi-claw 起動失敗');
  process.exit(1);
});
