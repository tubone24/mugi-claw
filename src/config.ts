import { z } from 'zod';
import type { AppConfig } from './types.js';

const envSchema = z.object({
  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  SLACK_APP_TOKEN: z.string().startsWith('xapp-'),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_USER_TOKEN: z.string().startsWith('xoxp-').optional(),
  CLAUDE_CLI_PATH: z.string().default('claude'),
  CLAUDE_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(3),
  CLAUDE_MAX_TURNS: z.coerce.number().int().min(1).max(200).default(50),
  APPROVAL_PORT: z.coerce.number().int().default(3456),
  CREDENTIAL_PORT: z.coerce.number().int().default(3457),
  CHROME_DEBUGGING_PORT: z.coerce.number().int().default(9222),
  CHROME_USER_DATA_DIR: z.string().default('~/.mugi-claw/chrome-profile'),
  DB_PATH: z.string().default('~/.mugi-claw/mugi-claw.db'),
  OWNER_SLACK_USER_ID: z.string().min(1),
  PROXY_PORT: z.coerce.number().int().default(18080),
  SANDBOX_ENABLED: z.string().default('false'),
  SANDBOX_PROFILE: z.string().default('sandbox/mugi-claw.sb'),
  DEFAULT_WHITELIST: z.string().default('registry.npmjs.org,github.com,raw.githubusercontent.com,api.anthropic.com,platform.claude.com,cloud.langfuse.com,*.datadoghq.com,slack.com'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export function loadConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  return {
    slack: {
      botToken: env.SLACK_BOT_TOKEN,
      appToken: env.SLACK_APP_TOKEN,
      signingSecret: env.SLACK_SIGNING_SECRET,
      userToken: env.SLACK_USER_TOKEN,
    },
    claude: {
      cliPath: env.CLAUDE_CLI_PATH,
      maxConcurrent: env.CLAUDE_MAX_CONCURRENT,
      maxTurns: env.CLAUDE_MAX_TURNS,
    },
    browser: {
      debuggingPort: env.CHROME_DEBUGGING_PORT,
      userDataDir: env.CHROME_USER_DATA_DIR,
    },
    db: {
      path: env.DB_PATH,
    },
    approval: {
      port: env.APPROVAL_PORT,
    },
    credential: {
      port: env.CREDENTIAL_PORT,
    },
    network: {
      proxyPort: env.PROXY_PORT,
      defaultWhitelist: env.DEFAULT_WHITELIST.split(','),
    },
    sandbox: {
      enabled: env.SANDBOX_ENABLED === 'true',
      profile: env.SANDBOX_PROFILE,
    },
    owner: {
      slackUserId: env.OWNER_SLACK_USER_ID,
    },
    logLevel: env.LOG_LEVEL,
  };
}
