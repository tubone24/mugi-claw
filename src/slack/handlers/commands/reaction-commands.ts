import type { ReactionTriggerStore } from '../../../reaction/reaction-trigger-store.js';

export function handleReactionCommand(
  args: string[],
  userId: string,
  reactionTriggerStore: ReactionTriggerStore,
): string {
  const action = args[0]?.toLowerCase() ?? 'list';

  switch (action) {
    case 'list':
      return handleList(reactionTriggerStore);
    case 'add':
      return handleAdd(args.slice(1), userId, reactionTriggerStore);
    case 'remove':
    case 'delete':
      return handleRemove(args.slice(1), reactionTriggerStore);
    case 'edit':
      return handleEdit(args.slice(1), reactionTriggerStore);
    case 'toggle':
      return handleToggle(args.slice(1), reactionTriggerStore);
    default:
      return '使い方: `/mugiclaw reaction [list|add|remove|edit|toggle]` わん';
  }
}

function handleList(store: ReactionTriggerStore): string {
  const triggers = store.getAll();
  if (triggers.length === 0) {
    return 'リアクショントリガーは登録されていないわん';
  }

  const lines = ['*:zap: リアクショントリガー一覧わん！*', ''];
  for (const trigger of triggers) {
    const status = trigger.enabled ? ':white_check_mark:' : ':pause_button:';
    const model = trigger.model ? ` | モデル: ${trigger.model}` : '';
    lines.push(`${status} :${trigger.emojiName}: — ${trigger.promptTemplate.slice(0, 80)}${trigger.promptTemplate.length > 80 ? '...' : ''}${model}`);
    if (trigger.description) {
      lines.push(`    ${trigger.description}`);
    }
  }

  return lines.join('\n');
}

function stripColons(emoji: string): string {
  return emoji.replace(/^:/, '').replace(/:$/, '');
}

function handleAdd(args: string[], userId: string, store: ReactionTriggerStore): string {
  if (args.length < 2) {
    return '使い方: `/mugiclaw reaction add :emoji: <プロンプト>` わん\n例: `/mugiclaw reaction add :memo: この会話を要約して`';
  }

  const emojiName = stripColons(args[0]!);
  const promptTemplate = args.slice(1).join(' ');

  if (!emojiName) {
    return '絵文字を指定してほしいわん！';
  }

  if (!promptTemplate) {
    return 'プロンプトを指定してほしいわん！';
  }

  // 重複チェック
  if (store.getByEmoji(emojiName)) {
    return `リアクション :${emojiName}: は既に登録されているわん`;
  }

  const trigger = store.create({
    emojiName,
    promptTemplate,
    createdBy: userId,
  });

  return `リアクショントリガーを登録したわん！ :${trigger.emojiName}: → ${trigger.promptTemplate}`;
}

function handleRemove(args: string[], store: ReactionTriggerStore): string {
  const emoji = args[0];
  if (!emoji) {
    return '使い方: `/mugiclaw reaction remove :emoji:` わん';
  }

  const emojiName = stripColons(emoji);
  const trigger = store.getByEmoji(emojiName);
  if (!trigger) {
    return `リアクション :${emojiName}: は登録されていないわん`;
  }

  store.delete(trigger.id);
  return `リアクショントリガー :${emojiName}: を削除したわん`;
}

function handleEdit(args: string[], store: ReactionTriggerStore): string {
  if (args.length < 2) {
    return '使い方: `/mugiclaw reaction edit :emoji: <新しいプロンプト>` わん';
  }

  const emojiName = stripColons(args[0]!);
  const newPrompt = args.slice(1).join(' ');

  const trigger = store.getByEmoji(emojiName);
  if (!trigger) {
    return `リアクション :${emojiName}: は登録されていないわん`;
  }

  store.update(trigger.id, { promptTemplate: newPrompt });
  return `リアクショントリガー :${emojiName}: のプロンプトを更新したわん！\n新しいプロンプト: ${newPrompt}`;
}

function handleToggle(args: string[], store: ReactionTriggerStore): string {
  const emoji = args[0];
  if (!emoji) {
    return '使い方: `/mugiclaw reaction toggle :emoji:` わん';
  }

  const emojiName = stripColons(emoji);
  const trigger = store.getByEmoji(emojiName);
  if (!trigger) {
    return `リアクション :${emojiName}: は登録されていないわん`;
  }

  store.toggle(trigger.id);
  const newState = trigger.enabled ? '無効' : '有効';
  return `リアクショントリガー :${emojiName}: を${newState}にしたわん`;
}
