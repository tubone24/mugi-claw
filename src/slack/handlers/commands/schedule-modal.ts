import type { KnownBlock, View } from '@slack/types';
import type { ScheduledTask } from '../../../types.js';

export const SCHEDULE_MODAL_CALLBACK_ID = 'schedule_modal_submit';

export function buildScheduleModal(existingTask?: ScheduledTask): View {
  const isEdit = !!existingTask;

  const blocks: KnownBlock[] = [
    {
      type: 'input',
      block_id: 'task_name',
      label: { type: 'plain_text', text: 'タスク名' },
      element: {
        type: 'plain_text_input',
        action_id: 'task_name_input',
        placeholder: { type: 'plain_text', text: '例: gmail-check' },
        ...(existingTask?.name ? { initial_value: existingTask.name } : {}),
      },
    },
    {
      type: 'input',
      block_id: 'cron_expression',
      label: { type: 'plain_text', text: 'cron式' },
      hint: { type: 'plain_text', text: '形式: 分 時 日 月 曜日 (例: 0 9 * * * = 毎朝9時)' },
      element: {
        type: 'plain_text_input',
        action_id: 'cron_input',
        placeholder: { type: 'plain_text', text: '0 9 * * *' },
        ...(existingTask?.cronExpression ? { initial_value: existingTask.cronExpression } : {}),
      },
    },
    {
      type: 'input',
      block_id: 'task_prompt',
      label: { type: 'plain_text', text: 'プロンプト' },
      element: {
        type: 'plain_text_input',
        action_id: 'prompt_input',
        multiline: true,
        placeholder: { type: 'plain_text', text: 'むぎぼーに実行してほしいタスクを書いてわん' },
        ...(existingTask?.taskPrompt ? { initial_value: existingTask.taskPrompt } : {}),
      },
    },
    {
      type: 'input',
      block_id: 'notify_type',
      label: { type: 'plain_text', text: '通知先タイプ' },
      element: {
        type: 'radio_buttons',
        action_id: 'notify_type_select',
        options: [
          { value: 'dm', text: { type: 'plain_text', text: 'DM (オーナーに直接通知)' } },
          { value: 'channel', text: { type: 'plain_text', text: 'チャンネル' } },
        ],
        initial_option: existingTask?.notifyType === 'channel'
          ? { value: 'channel', text: { type: 'plain_text', text: 'チャンネル' } }
          : { value: 'dm', text: { type: 'plain_text', text: 'DM (オーナーに直接通知)' } },
      },
    },
    {
      type: 'input',
      block_id: 'notify_channel',
      label: { type: 'plain_text', text: '通知チャンネル' },
      element: {
        type: 'channels_select',
        action_id: 'channel_select',
        placeholder: { type: 'plain_text', text: 'チャンネルを選択' },
        ...(existingTask?.notifyChannel ? { initial_channel: existingTask.notifyChannel } : {}),
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'mention_users',
      label: { type: 'plain_text', text: 'メンションユーザー' },
      element: {
        type: 'multi_users_select',
        action_id: 'mention_users_select',
        placeholder: { type: 'plain_text', text: 'メンションするユーザーを選択' },
        ...(existingTask?.mentionUsers?.length ? { initial_users: existingTask.mentionUsers } : {}),
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'special_mentions',
      label: { type: 'plain_text', text: '特殊メンション' },
      element: {
        type: 'checkboxes',
        action_id: 'special_mentions_select',
        options: [
          { value: 'here', text: { type: 'plain_text', text: '@here' } },
          { value: 'channel', text: { type: 'plain_text', text: '@channel' } },
        ],
        ...(() => {
          if (!existingTask) return {};
          const opts: Array<{ value: string; text: { type: 'plain_text'; text: string } }> = [];
          if (existingTask.mentionHere) opts.push({ value: 'here', text: { type: 'plain_text', text: '@here' } });
          if (existingTask.mentionChannel) opts.push({ value: 'channel', text: { type: 'plain_text', text: '@channel' } });
          return opts.length > 0 ? { initial_options: opts } : {};
        })(),
      },
      optional: true,
    },
    {
      type: 'input',
      block_id: 'model_select',
      label: { type: 'plain_text', text: 'モデル' },
      element: {
        type: 'static_select',
        action_id: 'model_input',
        placeholder: { type: 'plain_text', text: 'モデルを選択 (デフォルト: sonnet)' },
        options: [
          { value: 'opus', text: { type: 'plain_text', text: 'Opus (高性能)' } },
          { value: 'sonnet', text: { type: 'plain_text', text: 'Sonnet (バランス)' } },
          { value: 'haiku', text: { type: 'plain_text', text: 'Haiku (高速)' } },
        ],
        ...(existingTask?.model ? {
          initial_option: {
            value: existingTask.model,
            text: { type: 'plain_text', text: existingTask.model === 'opus' ? 'Opus (高性能)' : existingTask.model === 'haiku' ? 'Haiku (高速)' : 'Sonnet (バランス)' },
          },
        } : {}),
      },
      optional: true,
    },
  ];

  return {
    type: 'modal',
    callback_id: SCHEDULE_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: isEdit ? 'スケジュール編集' : 'スケジュール追加' },
    submit: { type: 'plain_text', text: isEdit ? '更新' : '追加' },
    close: { type: 'plain_text', text: 'キャンセル' },
    private_metadata: isEdit && existingTask ? JSON.stringify({ taskId: existingTask.id }) : '',
    blocks,
  };
}

export interface ParsedModalValues {
  name: string;
  cronExpression: string;
  taskPrompt: string;
  notifyType: 'dm' | 'channel';
  notifyChannel?: string;
  mentionUsers: string[];
  mentionHere: boolean;
  mentionChannel: boolean;
  model?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseModalValues(values: Record<string, Record<string, any>>): ParsedModalValues {
  const name = values['task_name']!['task_name_input']!.value as string;
  const cronExpression = values['cron_expression']!['cron_input']!.value as string;
  const taskPrompt = values['task_prompt']!['prompt_input']!.value as string;
  const notifyType = (values['notify_type']!['notify_type_select']!.selected_option?.value ?? 'dm') as 'dm' | 'channel';
  const notifyChannel = values['notify_channel']?.['channel_select']?.selected_channel as string | undefined;
  const mentionUsers = (values['mention_users']?.['mention_users_select']?.selected_users ?? []) as string[];
  const specialMentions = (values['special_mentions']?.['special_mentions_select']?.selected_options ?? []) as Array<{ value: string }>;
  const mentionHere = specialMentions.some((o) => o.value === 'here');
  const mentionChannel = specialMentions.some((o) => o.value === 'channel');
  const model = values['model_select']?.['model_input']?.selected_option?.value as string | undefined;

  return { name, cronExpression, taskPrompt, notifyType, notifyChannel, mentionUsers, mentionHere, mentionChannel, model };
}
