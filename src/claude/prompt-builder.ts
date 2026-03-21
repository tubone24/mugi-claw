import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SlackContext, UserProfile, UserMemory, ScheduledTask } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = resolve(__dirname, '..', '..');

const PROMPT_FILES = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'INSTRUCTIONS.md'] as const;

function loadPromptFile(filename: string): string {
  try {
    const filePath = resolve(PROJECT_ROOT, '.claude', filename);
    return readFileSync(filePath, 'utf-8').trim();
  } catch {
    return '';
  }
}

function loadSystemPrompt(): string {
  const parts = PROMPT_FILES
    .map(loadPromptFile)
    .filter(Boolean);

  if (parts.length === 0) {
    console.error('WARNING: No prompt files loaded from .claude/ directory');
  }

  return parts.join('\n\n');
}

const systemPrompt = loadSystemPrompt();

export function buildPrompt(
  context: SlackContext,
  profile: UserProfile | null = null,
  memories: UserMemory[] = [],
  scheduledTasks: ScheduledTask[] = [],
): string {
  const parts: string[] = [];

  // System instructions from .claude/*.md
  parts.push(systemPrompt);

  // ユーザープロフィール
  if (profile) {
    parts.push('\n【ユーザープロフィール】');
    if (profile.displayName) parts.push(`名前: ${profile.displayName}`);
    if (profile.location) parts.push(`場所: ${profile.location}`);
    parts.push(`タイムゾーン: ${profile.timezone}`);
    if (profile.hobbies.length > 0) parts.push(`趣味: ${profile.hobbies.join(', ')}`);
    if (profile.favoriteFoods.length > 0) parts.push(`好きな食べ物: ${profile.favoriteFoods.join(', ')}`);
    if (profile.interests.length > 0) parts.push(`興味・関心: ${profile.interests.join(', ')}`);
    const customKeys = Object.keys(profile.customData);
    if (customKeys.length > 0) {
      for (const key of customKeys) {
        parts.push(`${key}: ${String(profile.customData[key])}`);
      }
    }
  }

  // ユーザーについての記憶
  if (memories.length > 0) {
    parts.push('\n【ユーザーについての記憶】');
    for (const mem of memories) {
      parts.push(`- [${mem.category}] ${mem.content}`);
    }
  }

  // スケジュール一覧
  if (scheduledTasks.length > 0) {
    parts.push('\n【現在のスケジュール一覧】');
    for (const task of scheduledTasks) {
      const status = task.enabled ? '有効' : '停止中';
      parts.push(`- ${task.name} (${task.cronExpression}) [${status}]: ${task.taskPrompt}`);
    }
  }

  // スレッドコンテキスト
  if (context.threadMessages.length > 1) {
    parts.push('\n--- スレッドの会話履歴 ---');
    for (const msg of context.threadMessages) {
      const sender = msg.botId ? 'bot' : `user:${msg.user}`;
      parts.push(`[${sender}] ${msg.text}`);
    }
    parts.push('--- 会話履歴ここまで ---\n');
  }

  // 検索結果
  if (context.searchResults.length > 0) {
    parts.push('\n--- 関連するSlackメッセージ ---');
    for (const result of context.searchResults) {
      parts.push(`[${result.channel}] ${result.text}`);
    }
    parts.push('--- 検索結果ここまで ---\n');
  }

  // ユーザーの実際のリクエスト
  parts.push(`\n【ユーザーのリクエスト】\n${context.userMessage}`);

  return parts.join('\n');
}
