import type { KnownBlock, View } from '@slack/types';
import type { ScheduledTask, TaskRun, UserProfile, WhitelistEntry } from '../../types.js';
import type { ClaudeModel } from '../../db/settings-store.js';

export interface HomeTabData {
  profile: UserProfile | null;
  tasks: ScheduledTask[];
  recentRuns: (TaskRun & { taskName: string })[];
  currentModel: ClaudeModel;
  isOwner: boolean;
  whitelist?: WhitelistEntry[];
  logLevel?: string;
  whitelistPage?: number;
}

export const WHITELIST_PAGE_SIZE = 15;

export function buildHomeTabView(data: HomeTabData): View {
  const blocks: KnownBlock[] = [];

  blocks.push(...buildHeader());
  blocks.push({ type: 'divider' });
  blocks.push(...buildProfileSection(data.profile));
  blocks.push({ type: 'divider' });
  blocks.push(...buildScheduleSection(data.tasks));
  blocks.push({ type: 'divider' });
  blocks.push(...buildRecentRunsSection(data.recentRuns));
  blocks.push({ type: 'divider' });
  blocks.push(...buildSettingsSection(data.currentModel));

  if (data.isOwner) {
    blocks.push({ type: 'divider' });
    blocks.push(...buildAdminSection(data.whitelist ?? [], data.logLevel ?? 'info', data.whitelistPage ?? 0));
  }

  // Block Kit 100 block limit safety
  const trimmed = blocks.slice(0, 100);

  return {
    type: 'home',
    blocks: trimmed,
  };
}

function buildHeader(): KnownBlock[] {
  return [
    {
      type: 'header',
      text: { type: 'plain_text', text: 'むぎぼーダッシュボード', emoji: true },
    },
    {
      type: 'context',
      elements: [
        { type: 'mrkdwn', text: ':dog: むぎぼーがお手伝いするわん！ここから各種操作ができるわん！' },
      ],
    },
  ];
}

function buildProfileSection(profile: UserProfile | null): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*:bust_in_silhouette: プロフィール*' },
    },
  ];

  if (profile && profile.displayName) {
    const fields: { type: 'mrkdwn'; text: string }[] = [];
    fields.push({ type: 'mrkdwn', text: `*呼び名:* ${profile.displayName}` });
    if (profile.location) fields.push({ type: 'mrkdwn', text: `*場所:* ${profile.location}` });
    fields.push({ type: 'mrkdwn', text: `*TZ:* ${profile.timezone}` });
    if (profile.hobbies.length > 0) fields.push({ type: 'mrkdwn', text: `*趣味:* ${profile.hobbies.join(', ')}` });
    if (profile.interests.length > 0) fields.push({ type: 'mrkdwn', text: `*興味:* ${profile.interests.join(', ')}` });

    blocks.push({
      type: 'section',
      fields: fields.slice(0, 10), // max 10 fields
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '編集', emoji: true },
        action_id: 'home_profile_edit',
      },
    });
  } else {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: 'プロフィールが未登録わん！登録するともっとお手伝いしやすくなるわん！' },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '登録する', emoji: true },
        style: 'primary',
        action_id: 'home_profile_edit',
      },
    });
  }

  return blocks;
}

function buildScheduleSection(tasks: ScheduledTask[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*:calendar: スケジュール*' },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '+ 追加', emoji: true },
        style: 'primary',
        action_id: 'home_schedule_add',
      },
    },
  ];

  if (tasks.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_スケジュールされたタスクはまだないわん_' },
    });
    return blocks;
  }

  // Show max 10 tasks
  const displayTasks = tasks.slice(0, 10);
  for (const task of displayTasks) {
    const status = task.enabled ? ':white_check_mark:' : ':pause_button:';
    const lastRun = task.lastRunAt ? `最終: ${task.lastRunAt}` : '未実行';
    const lastStatus = task.lastStatus === 'success' ? ':large_green_circle:' : task.lastStatus === 'error' ? ':red_circle:' : ':white_circle:';

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${status} *${task.name}*\n\`${task.cronExpression}\` | ${lastStatus} ${lastRun}`,
      },
      accessory: {
        type: 'overflow',
        action_id: `home_task_overflow_${task.id}`,
        options: [
          { text: { type: 'plain_text', text: ':pencil2: 編集' }, value: `edit_${task.id}` },
          { text: { type: 'plain_text', text: task.enabled ? ':pause_button: 一時停止' : ':arrow_forward: 再開' }, value: `toggle_${task.id}` },
          { text: { type: 'plain_text', text: ':arrow_forward: 今すぐ実行' }, value: `run_${task.id}` },
          { text: { type: 'plain_text', text: ':wastebasket: 削除' }, value: `delete_${task.id}` },
        ],
      },
    });
  }

  if (tasks.length > 10) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_...他 ${tasks.length - 10} 件のタスクがあるわん_` }],
    });
  }

  return blocks;
}

function buildRecentRunsSection(runs: (TaskRun & { taskName: string })[]): KnownBlock[] {
  const blocks: KnownBlock[] = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*:clock3: 最近の実行履歴*' },
    },
  ];

  if (runs.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_まだ実行履歴がないわん_' },
    });
    return blocks;
  }

  // Show max 5 runs
  const displayRuns = runs.slice(0, 5);
  const lines: string[] = [];
  for (const run of displayRuns) {
    const statusEmoji = run.status === 'success' ? ':large_green_circle:' : run.status === 'error' ? ':red_circle:' : ':hourglass:';
    const duration = run.durationMs ? `${Math.round(run.durationMs / 1000)}s` : '-';
    const cost = run.costUsd != null ? `$${run.costUsd.toFixed(4)}` : '-';
    lines.push(`${statusEmoji} *${run.taskName}* | ${run.startedAt} | ${duration} | ${cost}`);
    if (run.status === 'error' && run.errorMessage) {
      lines.push(`    :warning: ${run.errorMessage.slice(0, 100)}`);
    }
  }

  blocks.push({
    type: 'section',
    text: { type: 'mrkdwn', text: lines.join('\n') },
  });

  return blocks;
}

function buildSettingsSection(currentModel: ClaudeModel): KnownBlock[] {
  const modelOptions = [
    { text: { type: 'plain_text' as const, text: 'Opus (高性能)' }, value: 'opus' },
    { text: { type: 'plain_text' as const, text: 'Sonnet (バランス)' }, value: 'sonnet' },
    { text: { type: 'plain_text' as const, text: 'Haiku (高速)' }, value: 'haiku' },
  ];

  const initialOption = modelOptions.find(o => o.value === currentModel) ?? modelOptions[1]!;

  return [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*:gear: 設定*' },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*デフォルトモデル:*' },
      accessory: {
        type: 'static_select',
        action_id: 'home_model_select',
        initial_option: initialOption,
        options: modelOptions,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: ':wrench: 詳細設定', emoji: true },
          action_id: 'home_open_settings',
        },
      ],
    },
  ];
}

function buildAdminSection(whitelist: WhitelistEntry[], logLevel: string, page: number): KnownBlock[] {
  const logOptions = [
    { text: { type: 'plain_text' as const, text: 'debug' }, value: 'debug' },
    { text: { type: 'plain_text' as const, text: 'info' }, value: 'info' },
    { text: { type: 'plain_text' as const, text: 'warn' }, value: 'warn' },
    { text: { type: 'plain_text' as const, text: 'error' }, value: 'error' },
  ];

  const initialLog = logOptions.find(o => o.value === logLevel) ?? logOptions[1]!;

  const permanentEntries = whitelist.filter(e => e.id != null);
  const totalPages = Math.max(1, Math.ceil(permanentEntries.length / WHITELIST_PAGE_SIZE));
  const currentPage = Math.min(Math.max(0, page), totalPages - 1);
  const start = currentPage * WHITELIST_PAGE_SIZE;
  const displayEntries = permanentEntries.slice(start, start + WHITELIST_PAGE_SIZE);

  const blocks: KnownBlock[] = [
    {
      type: 'header',
      text: { type: 'plain_text', text: ':shield: 管理者設定', emoji: true },
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: '*ログレベル:*' },
      accessory: {
        type: 'static_select',
        action_id: 'home_log_level_select',
        initial_option: initialLog,
        options: logOptions,
      },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*ネットワークホワイトリスト:* ${permanentEntries.length} 件`,
      },
      accessory: {
        type: 'button',
        text: { type: 'plain_text', text: '+ 追加', emoji: true },
        style: 'primary',
        action_id: 'home_whitelist_add',
      },
    },
  ];

  if (displayEntries.length === 0) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: '_ホワイトリストは空わん_' },
    });
  } else {
    for (const entry of displayEntries) {
      const port = entry.port != null ? `:${entry.port}` : '';
      const purpose = entry.purpose ? ` - ${entry.purpose}` : '';
      const perm = entry.isPermanent ? '永続' : '一時';

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `:globe_with_meridians: \`${entry.hostname}${port}\` (${perm})${purpose}`,
        },
        accessory: {
          type: 'overflow',
          action_id: `home_wl_overflow_${entry.id}`,
          options: [
            { text: { type: 'plain_text', text: '編集' }, value: `edit_${entry.id}` },
            { text: { type: 'plain_text', text: '削除' }, value: `delete_${entry.id}` },
          ],
        },
      });
    }

    // Pagination controls
    if (totalPages > 1) {
      const paginationElements: any[] = [];

      if (currentPage > 0) {
        paginationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: ':arrow_left: 前へ', emoji: true },
          action_id: 'home_wl_page_prev',
          value: String(currentPage - 1),
        });
      }

      if (currentPage < totalPages - 1) {
        paginationElements.push({
          type: 'button',
          text: { type: 'plain_text', text: '次へ :arrow_right:', emoji: true },
          action_id: 'home_wl_page_next',
          value: String(currentPage + 1),
        });
      }

      blocks.push({
        type: 'context',
        elements: [{ type: 'mrkdwn', text: `_ページ ${currentPage + 1} / ${totalPages}_` }],
      });

      if (paginationElements.length > 0) {
        blocks.push({
          type: 'actions',
          elements: paginationElements,
        } as KnownBlock);
      }
    }
  }

  return blocks;
}
