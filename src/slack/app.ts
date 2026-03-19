import { App } from '@slack/bolt';
import type { AppConfig } from '../types.js';

export function createSlackApp(config: AppConfig): App {
  return new App({
    token: config.slack.botToken,
    appToken: config.slack.appToken,
    socketMode: true,
    // signingSecret は Socket Mode では不要だが設定しておく
  });
}
