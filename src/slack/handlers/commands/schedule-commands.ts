import cron from 'node-cron';
import type { WebClient } from '@slack/web-api';
import type { TaskStore } from '../../../scheduler/task-store.js';
import type { Scheduler } from '../../../scheduler/scheduler.js';
import type { SettingsStore } from '../../../db/settings-store.js';
import { buildScheduleModal } from './schedule-modal.js';

export async function handleScheduleCommand(
  args: string[],
  taskStore: TaskStore,
  scheduler: Scheduler,
  _settingsStore: SettingsStore,
  options?: { triggerId?: string; client?: WebClient; userId?: string },
): Promise<string> {
  const action = args[0]?.toLowerCase() ?? 'list';

  switch (action) {
    case 'list':
      return handleList(taskStore);
    case 'add':
      return await handleAdd(args.slice(1), taskStore, scheduler, options);
    case 'edit':
      return await handleEdit(args.slice(1), taskStore, options);
    case 'remove':
    case 'delete':
      return handleRemove(args.slice(1), taskStore, scheduler);
    case 'pause':
    case 'toggle':
      return handlePause(args.slice(1), taskStore, scheduler);
    default:
      return '使い方: `/mugiclaw schedule [list|add|edit|remove|pause]` わん';
  }
}

function handleList(taskStore: TaskStore): string {
  const tasks = taskStore.getAllTasks();
  if (tasks.length === 0) {
    return 'スケジュールされたタスクはないわん';
  }

  const lines = ['*:calendar: スケジュール一覧わん！*', ''];
  for (const task of tasks) {
    const status = task.enabled ? ':white_check_mark:' : ':pause_button:';
    const lastRun = task.lastRunAt ? ` | 最終実行: ${task.lastRunAt}` : '';
    const lastStatus = task.lastStatus ? ` (${task.lastStatus})` : '';
    lines.push(`${status} *${task.name}* — \`${task.cronExpression}\`${lastRun}${lastStatus}`);
    if (task.description) {
      lines.push(`    ${task.description}`);
    }
  }

  return lines.join('\n');
}

async function handleAdd(args: string[], taskStore: TaskStore, scheduler: Scheduler, options?: { triggerId?: string; client?: WebClient; userId?: string }): Promise<string> {
  // No args → open modal
  if (args.length === 0 && options?.triggerId && options?.client) {
    await options.client.views.open({
      trigger_id: options.triggerId,
      view: buildScheduleModal(),
    });
    return '';  // Empty string signals modal was opened
  }

  // Expected: <name> <cron-expression> <prompt...>
  // Cron expression can be 5 parts (standard) or quoted
  if (args.length < 3) {
    return '使い方: `/mugiclaw schedule add <名前> <cron式(5パート)> <プロンプト>` わん\n例: `/mugiclaw schedule add gmail-check 0 9 * * * Gmailを確認して`';
  }

  const name = args[0]!;

  // Check if task already exists
  if (taskStore.getTaskByName(name)) {
    return `タスク「${name}」は既に存在するわん`;
  }

  // Try to find cron expression (5 parts: min hour dom month dow)
  const cronParts = args.slice(1, 6);
  const cronExpression = cronParts.join(' ');

  if (!cron.validate(cronExpression)) {
    // Maybe only partial parts were cron, try fewer
    const cronThree = args.slice(1, 4).join(' ');
    if (args.length >= 4 && cron.validate(cronThree + ' * *')) {
      return `無効なcron式わん: \`${cronExpression}\`\n正しい形式: \`分 時 日 月 曜日\` (例: \`0 9 * * *\` = 毎朝9時)`;
    }
    return `無効なcron式わん: \`${cronExpression}\`\n正しい形式: \`分 時 日 月 曜日\` (例: \`0 9 * * *\` = 毎朝9時)`;
  }

  const prompt = args.slice(6).join(' ');
  if (!prompt) {
    return 'プロンプトを指定してほしいわん！\n例: `/mugiclaw schedule add gmail-check 0 9 * * * Gmailを確認して未読メールを要約して`';
  }

  const task = taskStore.createTask({
    name: name,
    cronExpression: cronExpression,
    taskPrompt: prompt,
    createdBy: options?.userId,
  });

  scheduler.addTask(task);

  return `スケジュール「${name}」を登録したわん！ \`${cronExpression}\`\nプロンプト: ${prompt}`;
}

function handleRemove(args: string[], taskStore: TaskStore, scheduler: Scheduler): string {
  const name = args.join(' ');
  if (!name) {
    return '使い方: `/mugiclaw schedule remove <名前>` わん';
  }

  const task = taskStore.getTaskByName(name);
  if (!task) {
    return `タスク「${name}」が見つからないわん`;
  }

  scheduler.removeTask(task.id);
  taskStore.deleteTask(task.id);

  return `スケジュール「${name}」を削除したわん`;
}

function handlePause(args: string[], taskStore: TaskStore, scheduler: Scheduler): string {
  const name = args.join(' ');
  if (!name) {
    return '使い方: `/mugiclaw schedule pause <名前>` わん';
  }

  const task = taskStore.getTaskByName(name);
  if (!task) {
    return `タスク「${name}」が見つからないわん`;
  }

  taskStore.toggleTask(task.id);
  scheduler.toggleTask(task.id);

  const newState = task.enabled ? '一時停止' : '再開';
  return `スケジュール「${name}」を${newState}したわん`;
}

async function handleEdit(args: string[], taskStore: TaskStore, options?: { triggerId?: string; client?: WebClient }): Promise<string> {
  const name = args.join(' ');
  if (!name) {
    return '使い方: `/mugiclaw schedule edit <名前>` わん';
  }

  const task = taskStore.getTaskByName(name);
  if (!task) {
    return `タスク「${name}」が見つからないわん`;
  }

  if (!options?.triggerId || !options?.client) {
    return 'モーダルを開くにはSlashコマンドから実行してわん';
  }

  await options.client.views.open({
    trigger_id: options.triggerId,
    view: buildScheduleModal(task),
  });

  return '';  // Empty string signals modal was opened
}
