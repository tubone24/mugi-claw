import type { ProfileStore } from '../../../profile/profile-store.js';

export function handleMemoryCommand(args: string[], userId: string, profileStore: ProfileStore): string {
  const action = args[0]?.toLowerCase();

  if (action === 'add') {
    return handleAdd(args.slice(1), userId, profileStore);
  }

  if (action === 'forget' || action === 'delete') {
    return handleForget(args.slice(1), profileStore);
  }

  // Default: list memories
  return handleList(userId, profileStore);
}

function handleList(userId: string, profileStore: ProfileStore): string {
  const memories = profileStore.getMemories(userId, 30);
  if (memories.length === 0) {
    return 'まだ記憶がないわん！会話の中で覚えていくわん！';
  }

  const lines = ['*:brain: むぎぼーの記憶わん！*', ''];
  for (const mem of memories) {
    lines.push(`\`#${mem.id}\` [${mem.category}] ${mem.content} _(${mem.source})_`);
  }

  return lines.join('\n');
}

function handleAdd(args: string[], userId: string, profileStore: ProfileStore): string {
  const content = args.join(' ');
  if (!content) {
    return '使い方: `/mugiclaw memory add <テキスト>` わん';
  }

  const id = profileStore.addMemory(userId, 'fact', content, 'explicit');
  return `記憶 #${id} を保存したわん！「${content}」`;
}

function handleForget(args: string[], profileStore: ProfileStore): string {
  const idStr = args[0];
  if (!idStr) {
    return '使い方: `/mugiclaw memory forget <ID>` わん';
  }

  const id = parseInt(idStr.replace('#', ''), 10);
  if (isNaN(id)) {
    return 'IDは数字で指定してほしいわん';
  }

  const deleted = profileStore.deleteMemory(id);
  if (deleted) {
    return `記憶 #${id} を忘れたわん`;
  }
  return `記憶 #${id} が見つからないわん`;
}
