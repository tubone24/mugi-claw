import type { View } from '@slack/types';
import type { WhitelistEntry } from '../../types.js';

export const WHITELIST_MODAL_CALLBACK_ID = 'home_whitelist_modal_submit';

export function buildWhitelistModal(entry?: WhitelistEntry): View {
  return {
    type: 'modal',
    callback_id: WHITELIST_MODAL_CALLBACK_ID,
    private_metadata: entry?.id != null ? JSON.stringify({ entryId: entry.id }) : '',
    title: { type: 'plain_text', text: entry ? 'ホワイトリスト編集' : 'ホワイトリスト追加' },
    submit: { type: 'plain_text', text: entry ? '更新' : '追加' },
    close: { type: 'plain_text', text: 'キャンセル' },
    blocks: [
      {
        type: 'input',
        block_id: 'wl_hostname',
        label: { type: 'plain_text', text: 'ホスト名' },
        element: {
          type: 'plain_text_input',
          action_id: 'hostname',
          placeholder: { type: 'plain_text', text: '例: api.example.com, *.googleapis.com' },
          ...(entry ? { initial_value: entry.hostname } : {}),
        },
      },
      {
        type: 'input',
        block_id: 'wl_port',
        label: { type: 'plain_text', text: 'ポート' },
        element: {
          type: 'plain_text_input',
          action_id: 'port',
          placeholder: { type: 'plain_text', text: '例: 443（省略時は全ポート許可）' },
          ...(entry?.port != null ? { initial_value: String(entry.port) } : {}),
        },
        optional: true,
      },
      {
        type: 'input',
        block_id: 'wl_purpose',
        label: { type: 'plain_text', text: '用途' },
        element: {
          type: 'plain_text_input',
          action_id: 'purpose',
          placeholder: { type: 'plain_text', text: '例: API通信用' },
          ...(entry?.purpose ? { initial_value: entry.purpose } : {}),
        },
        optional: true,
      },
    ],
  };
}
