import type { View } from '@slack/types';

export const SETTINGS_MODAL_CALLBACK_ID = 'settings_modal_submit';

export function buildSettingsModal(options: {
  notifyOnComplete?: boolean;
  notifyOnError?: boolean;
}): View {
  return {
    type: 'modal',
    callback_id: SETTINGS_MODAL_CALLBACK_ID,
    title: { type: 'plain_text', text: '詳細設定' },
    submit: { type: 'plain_text', text: '保存' },
    close: { type: 'plain_text', text: 'キャンセル' },
    blocks: [
      {
        type: 'section',
        text: { type: 'mrkdwn', text: '*:bell: 通知設定*' },
      },
      {
        type: 'input',
        block_id: 'notify_complete',
        label: { type: 'plain_text', text: 'タスク完了通知' },
        element: {
          type: 'checkboxes',
          action_id: 'notify_complete_check',
          options: [
            {
              text: { type: 'plain_text', text: 'タスク完了時にDMで通知する' },
              value: 'notify_complete',
            },
          ],
          ...(options.notifyOnComplete
            ? {
                initial_options: [
                  {
                    text: { type: 'plain_text', text: 'タスク完了時にDMで通知する' },
                    value: 'notify_complete',
                  },
                ],
              }
            : {}),
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'notify_error',
        label: { type: 'plain_text', text: 'エラー通知' },
        element: {
          type: 'checkboxes',
          action_id: 'notify_error_check',
          options: [
            {
              text: { type: 'plain_text', text: 'タスクエラー時にDMで通知する' },
              value: 'notify_error',
            },
          ],
          ...(options.notifyOnError
            ? {
                initial_options: [
                  {
                    text: { type: 'plain_text', text: 'タスクエラー時にDMで通知する' },
                    value: 'notify_error',
                  },
                ],
              }
            : {}),
        },
        optional: true,
      },
    ],
  };
}
