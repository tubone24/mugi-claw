import type { KnownBlock, View } from '@slack/types';

export const SCHEDULED_MESSAGE_MODAL_CALLBACK_ID = 'scheduled_message_modal_submit';

export function buildScheduledMessageModal(): View {
  const blocks: KnownBlock[] = [
    {
      type: 'input',
      block_id: 'sm_channel',
      label: { type: 'plain_text', text: '投稿先チャンネル' },
      element: {
        type: 'channels_select',
        action_id: 'channel_select',
        placeholder: { type: 'plain_text', text: 'チャンネルを選択' },
      },
    },
    {
      type: 'input',
      block_id: 'sm_date',
      label: { type: 'plain_text', text: '日付' },
      element: {
        type: 'datepicker',
        action_id: 'date_select',
        placeholder: { type: 'plain_text', text: '日付を選択' },
      },
    },
    {
      type: 'input',
      block_id: 'sm_time',
      label: { type: 'plain_text', text: '時刻' },
      element: {
        type: 'timepicker',
        action_id: 'time_select',
        placeholder: { type: 'plain_text', text: '時刻を選択' },
      },
    },
    {
      type: 'input',
      block_id: 'sm_text',
      label: { type: 'plain_text', text: 'メッセージ内容' },
      element: {
        type: 'plain_text_input',
        action_id: 'text_input',
        multiline: true,
        placeholder: { type: 'plain_text', text: '予約するメッセージの内容を入力してわん' },
      },
    },
  ];

  return {
    type: 'modal',
    callback_id: SCHEDULED_MESSAGE_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: 'メッセージ予約' },
    submit: { type: 'plain_text', text: '予約する' },
    close: { type: 'plain_text', text: 'キャンセル' },
    blocks,
  };
}

export interface ParsedScheduledMessageValues {
  channel: string;
  postAt: number;   // Unix timestamp in seconds
  text: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseScheduledMessageModalValues(values: Record<string, Record<string, any>>): ParsedScheduledMessageValues | { error: string; field: string } {
  const channel = values['sm_channel']?.['channel_select']?.selected_channel as string | undefined;
  if (!channel) {
    return { error: 'チャンネルを選択してわん', field: 'sm_channel' };
  }

  const dateStr = values['sm_date']?.['date_select']?.selected_date as string | undefined;
  if (!dateStr) {
    return { error: '日付を選択してわん', field: 'sm_date' };
  }

  const timeStr = values['sm_time']?.['time_select']?.selected_time as string | undefined;
  if (!timeStr) {
    return { error: '時刻を選択してわん', field: 'sm_time' };
  }

  const text = values['sm_text']?.['text_input']?.value as string | undefined;
  if (!text) {
    return { error: 'メッセージ内容を入力してわん', field: 'sm_text' };
  }

  // Parse date + time → Unix timestamp (JST)
  // datepicker returns YYYY-MM-DD, timepicker returns HH:MM
  const isoString = `${dateStr}T${timeStr}:00+09:00`;
  const date = new Date(isoString);
  if (isNaN(date.getTime())) {
    return { error: '日時が無効わん', field: 'sm_date' };
  }

  const postAt = Math.floor(date.getTime() / 1000);
  const now = Math.floor(Date.now() / 1000);
  if (postAt <= now) {
    return { error: '過去の日時には予約できないわん！未来の日時を指定してわん', field: 'sm_date' };
  }

  return { channel, postAt, text };
}
